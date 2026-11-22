/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// A visitor's own API keys - optional: an ARC key (their own ARC workspace, which
// picks a model and falls back across their provider keys) and/or a Gemini key.
// They live only in this browser (localStorage) and are sent with this visitor's AI
// requests, with the visitor's choice of which AI to use first: the studio's keys
// saved on the server, or their own. The server never stores them.

const STORAGE_KEY = 'userGeminiApiKey';
const ARC_STORAGE_KEY = 'userArcApiKey';
const SOURCE_KEY = 'aiSource';
export const AI_KEY_CHANGED_EVENT = 'studio:ai-key-changed';
export const AI_KEY_HEADER = 'X-Gemini-Api-Key';
export const ARC_KEY_HEADER = 'X-Arc-Api-Key';
export const AI_SOURCE_HEADER = 'X-AI-Source';

/** Which AI is used first: the studio's (keys saved on the server) or the visitor's own keys. */
export type AiSource = 'studio' | 'mine';

/**
 * Tidies a pasted key: drops spaces and line breaks (including invisible
 * ones), surrounding quotes and a leading "GEMINI_API_KEY=".
 */
export function cleanGeminiKey(raw: string): string {
  return raw
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
    .replace(/^(?:export)?(?:GEMINI_API_KEY|GOOGLE_API_KEY|ARC_API_KEY|API_KEY|key)[:=]/i, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}

/**
 * Same rule the server applies. Classic keys look like "AIza…"; newer AI
 * Studio keys can contain dots (e.g. "AQ.…").
 */
export const looksLikeGeminiKey = (key: string) => {
  const k = cleanGeminiKey(key);
  // Something that starts like an ARC key must be a whole one.
  if (/^ARC_/.test(k)) return isArcKey(k);
  return /^[A-Za-z0-9._~+/=-]{20,300}$/.test(k);
};

/** ARC API key shape: ARC_DEE_<key id>_PAK_<secret>. */
export const isArcKey = (key: string) => /^ARC_DEE_[0-9A-Za-z]{17}_PAK_[0-9A-Za-z]{43}$/.test(cleanGeminiKey(key));

/** Which service a key belongs to. */
export const keyKind = (key: string): 'arc' | 'gemini' => (isArcKey(key) ? 'arc' : 'gemini');

/** Where visitors get an ARC key: sign up, add provider keys, create an app, issue a key. */
export const ARC_DASHBOARD_URL = 'https://arc-ai.run.place/dashboard';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked - it just won't persist */ }
};

/** The visitor's own keys. An ARC key saved by an older version (in the Gemini slot) counts as the ARC key. */
export function getUserKeys(): { arc: string | null; gemini: string | null } {
  const g = read(STORAGE_KEY);
  const a = read(ARC_STORAGE_KEY);
  const gemini = g && looksLikeGeminiKey(g) && !isArcKey(g) ? cleanGeminiKey(g) : null;
  const legacyArc = g && isArcKey(g) ? cleanGeminiKey(g) : null;
  const arc = a && isArcKey(a) ? cleanGeminiKey(a) : legacyArc;
  return { arc, gemini };
}

/** Any key of the visitor's own (for "do they have a key?"). */
export function getUserGeminiKey(): string | null {
  const { arc, gemini } = getUserKeys();
  return gemini ?? arc;
}

/** Saves (or removes, with null) the visitor's key of that kind; the kind is read from the key when not given. */
export function setUserKey(kind: 'arc' | 'gemini', key: string | null): void {
  if (kind === 'arc') {
    write(ARC_STORAGE_KEY, key ? cleanGeminiKey(key) : null);
    const g = read(STORAGE_KEY);
    if (g && isArcKey(g)) write(STORAGE_KEY, null); // the old single slot held it
  } else write(STORAGE_KEY, key ? cleanGeminiKey(key) : null);
  window.dispatchEvent(new Event(AI_KEY_CHANGED_EVENT));
}

/** Older callers: one key, placed by its shape. */
export function setUserGeminiKey(key: string | null): void {
  if (key) setUserKey(keyKind(key), key);
  else { setUserKey('gemini', null); setUserKey('arc', null); }
}

export function getAiSource(): AiSource {
  return read(SOURCE_KEY) === 'mine' ? 'mine' : 'studio';
}
export function setAiSource(source: AiSource): void {
  write(SOURCE_KEY, source === 'mine' ? 'mine' : null);
  window.dispatchEvent(new Event(AI_KEY_CHANGED_EVENT));
}

/** Headers for this app's own API requests: the visitor's keys and which AI they want first. */
export function aiKeyHeaders(): Record<string, string> {
  const { arc, gemini } = getUserKeys();
  return {
    ...(gemini ? { [AI_KEY_HEADER]: gemini } : {}),
    ...(arc ? { [ARC_KEY_HEADER]: arc } : {}),
    ...(getAiSource() === 'mine' && (arc || gemini) ? { [AI_SOURCE_HEADER]: 'mine' } : {}),
  };
}

/** Show only the last few characters, e.g. "••••••••AbC9". */
export const maskKey = (key: string) => `••••••••${key.slice(-4)}`;
