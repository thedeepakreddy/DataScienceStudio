#!/usr/bin/env bash
# Deploys the studio (the web app and its Node server) to Google Cloud Run, in the
# same project and region as the engine, and points it at the engine.
#
# Deploy the engine first (scripts/deploy_engine_cloudrun.sh). Then, in Google Cloud
# Shell (already logged in to gcloud), from the repository root:
#   git pull && PROJECT_ID=<project> bash scripts/deploy_studio_cloudrun.sh
#
# Safe to run again: every step reuses what already exists, and settings you changed
# in the console are kept. API keys are read with hidden prompts and stored in Secret
# Manager; they never appear on screen. Press Enter at a prompt to keep the saved key
# (or to skip a key you don't use).
#
# Optional settings, passed the same way as PROJECT_ID (kept on reruns if left out):
#   ARC_BASE_URL, ARC_USER_URL, ARC_MODEL, GEMINI_MODEL_TIER
set -euo pipefail

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-askdeepakai-studio}"
ENGINE_SERVICE="${ENGINE_SERVICE:-askdeepakai-engine}"
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f Dockerfile ] && [ -f server.ts ] || die "Run this from the repository root."

# ---------------------------------------------------------------- project
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Your projects:"; gcloud projects list --format="value(projectId)" | sed 's/^/  /'
  read -rp "Project ID (the one the engine runs in): " PROJECT_ID
fi
gcloud config set project "$PROJECT_ID" >/dev/null
say "Project $PROJECT_ID, region $REGION"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com --quiet

# ---------------------------------------------------------------- engine
ENGINE_URL=$(gcloud run services describe "$ENGINE_SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)
[ -n "$ENGINE_URL" ] || die "No engine service '$ENGINE_SERVICE' in $REGION. Run scripts/deploy_engine_cloudrun.sh first."
gcloud secrets describe engine-token >/dev/null 2>&1 || die "No engine-token secret. Run scripts/deploy_engine_cloudrun.sh first."
echo "  engine: $ENGINE_URL"

# ---------------------------------------------------------------- service account
SA="askdeepakai-studio@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  say "Creating the studio's service account"
  gcloud iam service-accounts create askdeepakai-studio --display-name="AskDeepakAI studio"
  sleep 10  # IAM is eventually consistent
fi

# ---------------------------------------------------------------- secrets
# The studio's server reads these keys. Each is stored in Secret Manager and only the
# studio's service account can read it.
SECRETS="ENGINE_TOKEN=engine-token:latest"
grant() { gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null; }
grant engine-token

ask_secret() {  # ask_secret ENV_NAME secret-name "description"
  local env="$1" name="$2" what="$3" value exists=0
  gcloud secrets describe "$name" >/dev/null 2>&1 && exists=1
  if [ "$exists" = 1 ]; then
    read -rsp "$what — saved already; paste a new one or press Enter to keep it: " value; echo
  else
    read -rsp "$what — paste it, or press Enter to skip: " value; echo
  fi
  if [ -n "$value" ]; then
    if [ "$exists" = 1 ]; then
      printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    else
      printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
      exists=1
    fi
    echo "  saved $env"
  fi
  value=""
  if [ "$exists" = 1 ]; then
    grant "$name"
    SECRETS="$SECRETS,$env=$name:latest"
  fi
}
say "AI keys (stored in Secret Manager; nothing is shown)"
ask_secret ARC_API_KEY studio-arc-api-key "The studio's ARC key (ARC_API_KEY, recommended)"
ask_secret GEMINI_API_KEY studio-gemini-api-key "A Gemini key (GEMINI_API_KEY, optional fallback)"

# ---------------------------------------------------------------- settings
# KEEP_AWAKE=0: on Cloud Run the studio scales to zero when idle and starts in seconds.
# Pinging it would keep an instance running all month and use up the free allowance.
ENV_VARS="NODE_ENV=production,ML_SERVICE_URL=${ENGINE_URL},KEEP_AWAKE=0"
for key in ARC_BASE_URL ARC_USER_URL ARC_MODEL GEMINI_MODEL_TIER; do
  if [ -n "${!key:-}" ]; then ENV_VARS="$ENV_VARS,$key=${!key}"; fi
done

# ---------------------------------------------------------------- deploy
# - One instance (--max-instances 1): long requests run as background jobs whose
#   results are kept in the server's memory, and the browser collects them with short
#   polls, so every poll must reach the same instance. It also caps the bill.
# - --no-cpu-throttling: those background jobs keep running between polls. Billing is
#   per instance lifetime; with --min-instances 0 an idle studio shuts down after
#   about 15 minutes and costs nothing until the next visitor.
# - --timeout 3600: a long engine run can hold one request open for up to an hour.
say "Building and deploying the studio (Cloud Build; about 5 minutes)"
gcloud config set builds/timeout 3600 >/dev/null
gcloud run deploy "$SERVICE" --source . --region "$REGION" --service-account "$SA" \
  --cpu 1 --memory 1Gi --min-instances 0 --max-instances 1 --concurrency 80 --timeout 3600 \
  --no-cpu-throttling --cpu-boost --allow-unauthenticated --quiet \
  --update-env-vars "$ENV_VARS" \
  --update-secrets "$SECRETS"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')

say "Checking the studio at $URL"
# Not /healthz: Cloud Run's front end keeps paths ending in "z" for itself and answers 404.
curl -fsS -o /dev/null "$URL/" && echo "  studio page ✓" || die "The studio didn't answer at $URL. See: gcloud run services logs read $SERVICE --region $REGION"
curl -fsS "$URL/api/ai/status" >/dev/null && echo "  /api/ai/status ✓"
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/engine/info")
echo "  /api/engine/info -> $code (200 means the studio reaches the engine; the first call can take a minute while the engine wakes)"

# ---------------------------------------------------------------- bucket CORS
# Large files go from the browser straight to the engine's bucket, so the bucket must
# accept uploads from the studio's address. Origins already allowed are kept.
BUCKET="gs://${PROJECT_ID}-engine"
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  EXISTING=$(gcloud storage buckets describe "$BUCKET" --format=json 2>/dev/null || echo '{}')
  python3 - "$EXISTING" "$URL" "https://${SERVICE}-${NUMBER}.${REGION}.run.app" > /tmp/studio-cors.json <<'EOF'
import json, sys
desc = json.loads(sys.argv[1] or "{}")
rules = desc.get("cors_config") or desc.get("cors") or []
origins = [o for r in rules for o in r.get("origin", [])]
for o in sys.argv[2:]:
    if o not in origins:
        origins.append(o)
print(json.dumps([{"origin": origins, "method": ["PUT"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]))
EOF
  gcloud storage buckets update "$BUCKET" --cors-file=/tmp/studio-cors.json >/dev/null && echo "  bucket accepts direct uploads from $URL"
fi

say "Done"
echo "  Studio:  $URL"
echo "  Engine:  $ENGINE_URL"
echo
echo "  If the GitHub 'Keep awake' workflow pings this address (repository variable KEEP_AWAKE_URLS),"
echo "  remove it there: on Cloud Run a ping every 10 minutes keeps an instance running all month."
echo "  Your own domain: Cloud Run → $SERVICE → Integrations / Domain mappings."
