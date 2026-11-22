/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { AGENTS } from '../swarm/agents';
import { STAGES, STAGE_ORDER } from '../stages';
import { CAPABILITIES as ENGINE_CAPABILITIES } from '../engine/contract.generated';
import { demoResults } from './welcomeDemo';
import AppIcon from './AppIcon';
import { ThinkingOrb } from 'thinking-orbs';
import type { OrbState } from 'thinking-orbs';

// The front page, shown once the agents' welcome ends. A dark, quiet page in
// the manner of a modern AI lab's site: a centred headline with a typed word,
// live panels, a product grid, a developer section, big numbers and two plans.
// Every number on it is computed (the 20-row demo in welcomeDemo.ts) or counted
// from the code (agents, steps, engine analyses); nothing is made up.
// "Try for free" opens the studio.

const REPO = 'https://github.com/thedeepakreddy/DataScienceStudio';
const ENGINE_COUNT = Object.keys(ENGINE_CAPABILITIES).length;
const AGENT_COUNT = Object.keys(AGENTS).length;
const AREA_LABEL: Record<string, string> = {
  stats: 'Statistics', data: 'Data preparation', text: 'Text', causal: 'Causal inference', connect: 'Connectors',
  ml: 'Machine learning', timeseries: 'Time series', experiments: 'Experiments', bayes: 'Bayesian', optimize: 'Optimisation',
  unsupervised: 'Segmentation', survival: 'Survival', mlops: 'MLOps',
};
/** The engine's analyses grouped by area, largest first, with their real titles. */
const ENGINE_AREAS = Object.values(ENGINE_CAPABILITIES as Record<string, { area: string; title: string }>)
  .reduce<Array<{ area: string; label: string; items: string[] }>>((acc, c) => {
    const g = acc.find(x => x.area === c.area) ?? (acc.push({ area: c.area, label: AREA_LABEL[c.area] ?? c.area, items: [] }), acc[acc.length - 1]);
    g.items.push(c.title);
    return acc;
  }, []).sort((a, b) => b.items.length - a.items.length);

/** The real deployment (README → Deploy, docs/DEPLOY_ENGINE.md). */
const PLATFORM = [
  { where: 'Your browser', name: 'The studio', what: 'Your work is saved in your browser: datasets, versions, runs, dashboards and models. Export it or clear it whenever you like.', stack: 'React 19 · TypeScript · IndexedDB' },
  { where: 'Render', name: 'The web server', what: 'Serves the studio, routes AI requests and wakes the engine when it sleeps. It keeps no data.', stack: 'Node.js · Express' },
  { where: 'Google Cloud Run · us-central1', name: 'The engine', what: 'Runs every analysis and model, scales to zero when idle, and is woken on demand. A scheduler runs saved pipelines every 15 minutes.', stack: 'Python 3.13 · FastAPI · Docker' },
  { where: 'Google Cloud Storage', name: 'Large files', what: 'Files of several GB go straight to storage and are kept as compressed Parquet: a 265 MB CSV is stored as 26 MB.', stack: 'Parquet · DuckDB' },
  { where: 'AI routing', name: 'ARC, then Gemini', what: 'Plans and narration go to ARC first, then Gemini, or to your own keys. AI writes words, plans and code; never the numbers.', stack: 'ARC · Gemini · your own keys' },
];

const WORDS = ['clean', 'test', 'model', 'forecast', 'explain', 'report'];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const LP_SANS = '"Geist", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
const LP_MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const still = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const C = {
  bg: '#0a0a0a',
  card: '#141414',
  line: 'rgba(255,255,255,0.07)',
  pill: '#1d1d1d',
  text: '#f5f5f5',
  mute: '#8b8b8b',
  dim: '#5c5c5c',
  green: '#7ee787',
  red: '#ff7b72',
  blue: '#79c0ff',
  amber: '#ffa657',
};

/** The typed word in the headline, on its underline. */
function TypedWord() {
  const [text, setText] = useState(still() ? WORDS[0] : '');
  useEffect(() => {
    if (still()) return;
    let i = 0, k = 0, deleting = false, alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      const word = WORDS[i];
      if (!deleting) {
        k++;
        setText(word.slice(0, k));
        if (k === word.length) { deleting = true; timer = setTimeout(tick, 1700); return; }
        timer = setTimeout(tick, 95);
      } else {
        k--;
        setText(word.slice(0, k));
        if (k === 0) { deleting = false; i = (i + 1) % WORDS.length; timer = setTimeout(tick, 280); return; }
        timer = setTimeout(tick, 45);
      }
    };
    timer = setTimeout(tick, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return (
    <span className="relative inline-block align-baseline text-left" style={{ minWidth: '3.4em' }}>
      <span>{text}</span><span className="lp-caret" aria-hidden="true" />
      <span aria-hidden="true" className="absolute left-0 right-0" style={{ bottom: '-0.04em', height: 3, borderRadius: 2, background: '#4a4a4a' }} />
    </span>
  );
}

/** Lines that appear one after another, then start over: a panel at work. */
function useSequence(count: number, stepMs: number, holdMs: number) {
  const [n, setN] = useState(still() ? count : 0);
  useEffect(() => {
    if (still()) return;
    let k = 0, alive = true;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      if (!alive) return;
      k = k >= count ? 0 : k + 1;
      setN(k);
      t = setTimeout(next, k >= count ? holdMs : k === 0 ? 400 : stepMs);
    };
    t = setTimeout(next, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [count, stepMs, holdMs]);
  return n;
}

/** The Ask AI orb's real states, as the studio uses them (Orb.tsx). */
const ORB_STATES: Array<[OrbState, string]> = [
  ['breathing', 'Waiting for your goal'],
  ['weaving', 'Turning your goal into a plan'],
  ['working', 'Running an analysis'],
  ['solving', 'Training a model'],
  ['composing', 'Writing the report'],
];

function AskOrb() {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (still()) return;
    const t = setInterval(() => setK(i => (i + 1) % ORB_STATES.length), 3200);
    return () => clearInterval(t);
  }, []);
  const [state, caption] = ORB_STATES[k];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <div className="absolute rounded-full" style={{ width: '58%', height: '58%', background: 'radial-gradient(circle, rgba(5,5,8,1) 0%, rgba(5,5,8,0.92) 50%, rgba(5,5,8,0) 74%)' }} />
      <div style={{ transform: 'scale(2.6)', filter: 'drop-shadow(0 0 14px rgba(255,255,255,0.25))' }}>
        <ThinkingOrb state={state} size={64} theme="dark" aria-label={caption} />
      </div>
      <p key={k} className="lp-in absolute bottom-[22%] text-[12.5px] tracking-wide" style={{ color: 'rgba(255,255,255,0.62)' }}>{caption}</p>
    </div>
  );
}

/** A light inside a glass sphere: points in a slowly turning ball, with a coloured rim. */
function LiquidSphere({ size = 300 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const R = size / 2;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pts = Array.from({ length: 900 }, () => {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.cbrt(rnd()) * 0.98;
      const s = Math.sqrt(1 - u * u);
      return { x: r * s * Math.cos(th), y: r * u, z: r * s * Math.sin(th), b: 0.35 + rnd() * 0.65, hue: rnd() };
    });
    const tint = (h: number) => (h < 0.06 ? '255,120,120' : h < 0.12 ? '120,170,255' : h < 0.16 ? '140,255,170' : '255,255,255');
    let a = 0, raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
      const bg = ctx.createRadialGradient(R * 0.8, R * 0.7, R * 0.1, R, R, R);
      bg.addColorStop(0, '#11121a'); bg.addColorStop(0.75, '#050507'); bg.addColorStop(1, '#0d0d14');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
      const ca = Math.cos(a), sa = Math.sin(a), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
      for (const p of pts) {
        const x = p.x * ca + p.z * sa, z0 = -p.x * sa + p.z * ca;
        const y = p.y * ct - z0 * st, z = p.y * st + z0 * ct;
        const persp = 1 + z * 0.12;
        const px = R + x * R * 0.9 * persp, py = R + y * R * 0.9 * persp;
        const alpha = Math.max(0.06, Math.min(0.85, (z + 1.1) / 2.3)) * p.b;
        const rad = Math.max(0.45, 1.25 * persp * p.b * (p.b > 0.93 ? 1.8 : 1));
        ctx.fillStyle = `rgba(${tint(p.hue)},${alpha})`;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
      }
      // A soft highlight, like light caught in glass.
      const hl = ctx.createRadialGradient(R * 1.5, R * 0.55, 0, R * 1.5, R * 0.55, R * 0.35);
      hl.addColorStop(0, 'rgba(255,255,255,0.55)'); hl.addColorStop(0.15, 'rgba(255,240,210,0.18)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl; ctx.fillRect(0, 0, size, size);
      ctx.restore();
      if (!still()) { a += 0.0026; raf = requestAnimationFrame(draw); }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} className="absolute inset-0" aria-hidden="true" />
      {/* The rim: a thin ring of split colour, as glass bends light at its edge. */}
      <div aria-hidden="true" className="absolute inset-0 rounded-full pointer-events-none lp-rim" />
      <AskOrb />
      <div aria-hidden="true" className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: 'inset 0 0 40px rgba(255,255,255,0.06), inset 0 0 2px rgba(255,255,255,0.35)' }} />
    </div>
  );
}

function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; key?: React.Key }) {
  return <div className={`relative overflow-hidden rounded-[22px] ${className}`} style={{ background: C.card, ...style }}>{children}</div>;
}

function CardFoot({ label, onExplore }: { label: string; onExplore: () => void }) {
  return (
    <div className="absolute left-0 right-0 bottom-0 px-6 pb-5 pt-10 flex items-end justify-between" style={{ background: `linear-gradient(to top, ${C.card} 55%, transparent)` }}>
      <span className="text-[17px]" style={{ color: C.text }}>{label}</span>
      <button type="button" onClick={onExplore} className="lp-link text-[17px] inline-flex items-center gap-1.5">Explore <ArrowRight className="w-4 h-4" /></button>
    </div>
  );
}

const PY = (cap: string) => `import requests

ENGINE = "https://your-engine.run.app/v2"

# Upload a file; the engine keeps it as a dataset.
ds = requests.post(f"{ENGINE}/datasets/upload",
                   files={"file": open("customers.csv", "rb")}).json()

# Run any of the ${ENGINE_COUNT} analyses on it.
run = requests.post(f"{ENGINE}/run/${cap}", json={
    "dataset_id": ds["id"],
    "params": {"target": "churned"},
}).json()
print(run["status"], run["runId"])`;

const TS = (cap: string) => `import { createEngineClient } from './engine/client';

const engine = createEngineClient('https://your-engine.run.app/v2');

// Upload a file; the engine keeps it as a dataset.
const ds = await engine.datasets.upload(file, 'customers');

// Run any of the ${ENGINE_COUNT} analyses and wait for the result.
const result = await engine.runAndWait('${cap}',
  { target: 'churned' }, { datasetId: ds.id });
console.log(result.manifest);`;

const CURL = (cap: string) => `# Upload a file
curl -F file=@customers.csv \\
  https://your-engine.run.app/v2/datasets/upload

# Run an analysis on it
curl -X POST https://your-engine.run.app/v2/run/${cap} \\
  -H 'Content-Type: application/json' \\
  -d '{"dataset_id": "ds_…", "params": {"target": "churned"}}'`;

/** Colours Python, TypeScript and shell the way an editor would. */
function highlight(code: string): React.ReactNode[] {
  const re = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|\b(import|from|const|await|print|curl|json|files|let|return)\b|\b(\w+)(?==)/gm;
  const out: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const color = m[1] ? C.dim : m[2] ? C.blue : m[3] ? C.red : C.amber;
    out.push(<span key={k++} style={{ color }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

function CodeWindow() {
  const [tab, setTab] = useState<'Python' | 'TypeScript' | 'cURL'>('Python');
  const [copied, setCopied] = useState(false);
  const code = (tab === 'Python' ? PY : tab === 'TypeScript' ? TS : CURL)('models.automl');
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      <div className="relative p-6 sm:p-10 lp-grain-panel">
        <div className="relative rounded-[16px] overflow-hidden" style={{ background: '#0d0d0d', border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.line}` }}>
            <span className="flex gap-2" aria-hidden="true">{['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />)}</span>
            <button type="button" onClick={copy} className="lp-link text-[13px] inline-flex items-center gap-1.5">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="px-5 py-5 text-[12.5px] sm:text-[13.5px] leading-[1.75] overflow-x-auto" style={{ color: '#e6e6e6', fontFamily: LP_MONO }}><code>{highlight(code)}</code></pre>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-1" role="tablist">
        {(['Python', 'TypeScript', 'cURL'] as const).map(t => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className="px-4 py-2 rounded-full text-[15px] transition-colors" style={{ background: tab === t ? C.pill : 'transparent', color: tab === t ? C.text : C.mute }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

export default function Landing({ onStart }: { onStart: () => void }) {
  const demo = useMemo(() => demoResults(), []);
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const start = useCallback(() => { setLeaving(true); setTimeout(onStart, 380); }, [onStart]);
  const goTo = (id: string) => scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const monthly = demo.byPlan.find(g => g.plan === 'Monthly')!;
  const yearly = demo.byPlan.find(g => g.plan === 'Yearly')!;
  const maxRate = Math.max(...demo.byPlan.map(g => g.rate), 0.01);

  // Panel 1: a conversation with the team (the answers are this sample's numbers).
  const chat: Array<{ me: boolean; text: string }> = [
    { me: true, text: 'Why do customers leave?' },
    { me: false, text: `Monthly plans churn at ${pct(monthly.rate)}, yearly at ${pct(yearly.rate)} (${monthly.n + yearly.n} customers).` },
    { me: true, text: 'Are tenure and charges related?' },
    { me: false, text: `Yes: r = ${demo.r.toFixed(2)} across all 20 rows.` },
    { me: true, text: 'Can we predict who leaves?' },
    { me: false, text: `${pct(demo.model.accuracy)} right on ${demo.model.testRows} customers the model never saw.` },
  ];
  const chatN = useSequence(chat.length, 1300, 2600);

  // Panel 2: the engine at work.
  const log: Array<{ kind: 'cmd' | 'tool' | 'done' | 'diff-' | 'diff+'; text: string; tail?: string }> = [
    { kind: 'cmd', text: 'Find why customers leave and build a dashboard.' },
    { kind: 'tool', text: 'quality.check', tail: `${demo.fills.length} blanks found` },
    ...demo.fills.map(f => ({ kind: 'diff+' as const, text: `${f.col}[${f.row}] = ${f.value}`, tail: 'median' })),
    { kind: 'tool', text: 'stats.correlation', tail: `r = ${demo.r.toFixed(2)}` },
    { kind: 'tool', text: 'models.train', tail: `${pct(demo.model.accuracy)} on held-out rows` },
    { kind: 'done', text: 'Verifier recomputed 3 results', tail: '[done]' },
  ];
  const logN = useSequence(log.length, 900, 2600);

  // Panel 3: a request to the Dashboard Designer.
  const botN = useSequence(3, 1400, 3200);

  const navItems: Array<[string, string]> = [['Studio', 'lp-steps'], ['Agents', 'lp-products'], ['Engine', 'lp-engine'], ['Developers', 'lp-developers'], ['Platform', 'lp-platform']];

  return (
    <div ref={scroller} role="dialog" aria-modal="true" aria-label="Data Science Studio" data-landing
      className="fixed inset-0 z-[10000] overflow-y-auto overflow-x-hidden"
      style={{ background: C.bg, color: C.text, opacity: leaving ? 0 : 1, transition: 'opacity 380ms ease', fontFamily: LP_SANS, colorScheme: 'dark', fontFeatureSettings: '"ss01", "cv11"', WebkitFontSmoothing: 'antialiased' }}>

      {/* Header */}
      <header className="sticky top-0 z-20" style={{ background: 'rgba(10,10,10,0.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: `1px solid ${C.line}` }}>
        <div className="mx-auto max-w-[1400px] h-[68px] px-4 sm:px-6 lg:px-8 flex items-center gap-6 lg:gap-10">
          <button type="button" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5 shrink-0" aria-label="Back to the top">
            <AppIcon size={30} />
            <span className="hidden sm:inline text-[16px] font-medium tracking-tight">Data Science Studio</span>
          </button>
          <nav className="hidden lg:flex items-center gap-8 text-[15.5px]" aria-label="Sections">
            {navItems.map(([label, id]) => <button key={id} type="button" className="lp-nav" onClick={() => goTo(id)}>{label}</button>)}
            <a className="lp-nav" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <a href={REPO} target="_blank" rel="noreferrer" className="hidden md:inline-flex h-11 items-center px-5 rounded-full text-[15.5px] lp-dark-btn">View source</a>
            <div className="relative flex items-stretch h-11 rounded-full bg-white text-black text-[15.5px]">
              <button type="button" onClick={start} className="px-5 rounded-l-full hover:bg-black/5 transition-colors" data-landing-start>Try for free</button>
              <span className="w-px my-0 bg-black/15" aria-hidden="true" />
              <button type="button" onClick={() => setMenu(m => !m)} aria-label="More ways to start" aria-expanded={menu} className="px-3 rounded-r-full hover:bg-black/5 transition-colors"><ChevronDown className="w-4 h-4" /></button>
              {menu && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-64 rounded-2xl p-1.5 text-[14.5px] shadow-2xl" style={{ background: '#181818', color: C.text, border: `1px solid ${C.line}` }} role="menu">
                  <button type="button" role="menuitem" onClick={start} className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-white/5">Open the studio<span className="block text-[12.5px]" style={{ color: C.mute }}>Import a file or try a sample</span></button>
                  <a role="menuitem" href={REPO} target="_blank" rel="noreferrer" className="block px-3.5 py-2.5 rounded-xl hover:bg-white/5">Run it yourself<span className="block text-[12.5px]" style={{ color: C.mute }}>Source code, Docker and deploy guide</span></a>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-20 sm:pt-28 text-center">
        <button type="button" onClick={start} className="inline-flex items-center gap-2 sm:gap-3 h-11 pl-2 pr-2 rounded-full text-[13.5px] sm:text-[15px] lp-badge max-w-full">
          <span className="px-2.5 py-0.5 rounded-full text-[13px]" style={{ background: 'rgba(255,120,40,0.12)', color: '#ff7a2f' }}>New</span>
          <span className="whitespace-nowrap">Tableau and Power BI import</span>
          <span className="hidden md:inline" style={{ color: C.mute }}>· open a workbook as a dashboard</span>
          <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.pill }}><ArrowUpRight className="w-3.5 h-3.5" /></span>
        </button>
        <h1 className="mt-10 mx-auto max-w-[1100px] font-medium leading-[1.02]" style={{ fontSize: 'clamp(34px, 6.2vw, 92px)', letterSpacing: '-0.045em' }}>
          A data science team<br /><span className="sm:whitespace-nowrap">for everything you <TypedWord />.</span>
        </h1>
        <p className="mt-8 mx-auto max-w-[860px] text-[17px] sm:text-[21px] leading-relaxed" style={{ color: '#d6d6d6' }}>
          Clean, explore, test, model, dashboard and report. {AGENT_COUNT} agents do the work on your page; every number comes from a real engine.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <button type="button" onClick={start} className="h-[60px] px-8 rounded-full bg-white text-black text-[17px] inline-flex items-center gap-2 hover:bg-white/90 transition-colors">Try for free <ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => goTo('lp-developers')} className="h-[60px] px-8 rounded-full text-[17px] lp-dark-btn">View the engine</button>
        </div>
      </section>

      {/* Three live panels */}
      <section id="lp-products" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-24 grid grid-cols-1 md:grid-cols-3 gap-5 scroll-mt-24">
        <Card className="h-[420px]">
          <div className="px-6 pt-6 flex flex-col gap-3 h-full justify-end pb-20">
            {chat.slice(0, chatN).slice(-5).map((m, i) => (
              <div key={`${chatN}-${i}`} className={`lp-in max-w-[85%] px-4 py-2.5 rounded-[18px] text-[14px] leading-snug ${m.me ? 'self-end' : 'self-start'}`}
                style={{ background: m.me ? '#222' : '#1b1b1b', color: m.me ? C.text : '#d9d9d9' }}>{m.text}</div>
            ))}
          </div>
          <CardFoot label="Agents" onExplore={start} />
        </Card>

        <Card className="h-[420px]" style={{ background: '#101010' }}>
          <div className="flex items-center gap-3 px-5 py-3.5 text-[13px]" style={{ borderBottom: `1px solid ${C.line}`, fontFamily: LP_MONO }}>
            <span className="flex gap-1.5" aria-hidden="true">{['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}</span>
            <span style={{ color: C.mute }}>customers.csv</span>
            <span className="ml-auto flex items-center gap-2" style={{ color: C.mute }}>
              <span className="w-16 h-2 rounded-sm overflow-hidden" style={{ background: '#2a2a2a' }}><span className="block h-full bg-white/80 transition-[width] duration-500" style={{ width: pct(logN / log.length) }} /></span>
              {pct(logN / log.length)}
            </span>
          </div>
          <div className="px-5 py-4 space-y-2 text-[13px] leading-relaxed" style={{ fontFamily: LP_MONO }}>
            {log.slice(0, logN).map((l, i) => (
              <div key={i} className="lp-in flex gap-2">
                {l.kind === 'cmd' && <><span style={{ color: '#8b9cff' }}>❯</span><span style={{ color: C.text }}>{l.text}</span></>}
                {l.kind === 'tool' && <><span style={{ color: C.green }}>▸</span><span style={{ color: C.green }}>{l.text}</span><span style={{ color: C.dim }}>{l.tail}</span></>}
                {l.kind === 'diff+' && <span className="flex-1 px-2 rounded-sm" style={{ background: 'rgba(46,160,67,0.18)', color: '#d2f5d8' }}>+ {l.text} <span style={{ color: C.dim }}>{l.tail}</span></span>}
                {l.kind === 'done' && <><span style={{ color: '#c49bff' }}>◆</span><span style={{ color: C.mute }}>{l.text}</span><span className="ml-auto" style={{ color: C.green }}>{l.tail}</span></>}
              </div>
            ))}
            {logN < log.length && <div className="flex gap-2" style={{ color: C.mute }}><span className="lp-dots">⋮</span>Working…</div>}
          </div>
          <CardFoot label="Engine" onExplore={() => goTo('lp-developers')} />
        </Card>

        <Card className="h-[420px]">
          <div className="px-6 pt-8 flex flex-col gap-4">
            {botN >= 1 && <div className="lp-in self-end max-w-[88%] px-5 py-3 rounded-[20px] text-[16px] leading-snug" style={{ background: '#ecebe8', color: '#111' }}>build a churn dashboard for monday's review?</div>}
            {botN >= 2 && <div className="lp-in self-start max-w-[92%] px-5 py-3 rounded-[20px] text-[16px] leading-snug" style={{ background: '#1d1d1d', color: '#e8e8e8' }}>
              Churn rate by plan, from your rows:
              <div className="mt-3 space-y-1.5">
                {demo.byPlan.map(g => (
                  <div key={g.plan} className="flex items-center gap-2 text-[13px]" style={{ color: C.mute }}>
                    <span className="w-16">{g.plan}</span>
                    <span className="h-2.5 rounded-sm" style={{ width: `${(g.rate / maxRate) * 55}%`, background: 'var(--agent-dashboard-designer, #b18cff)' }} />
                    <span className="tabular-nums" style={{ color: C.text }}>{pct(g.rate)}</span>
                  </div>
                ))}
              </div>
            </div>}
            {botN >= 3 && <p className="lp-in text-center text-[15px]" style={{ color: C.mute }}>Pinned to <span style={{ color: C.text }}>Dashboard</span> · {AGENTS.dashboard_designer.name}</p>}
          </div>
          <CardFoot label="Dashboard" onExplore={start} />
        </Card>
      </section>

      {/* Second row: the cleaned table and the sphere */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="h-[480px] p-2">
          <div className="h-full rounded-[18px] overflow-hidden grid grid-cols-[1.6fr_1fr] gap-2">
            <div className="rounded-[16px] p-5 overflow-hidden" style={{ background: '#0e0e0e' }}>
              <p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim }}>customers.csv · 20 rows</p>
              <table className="mt-4 w-full text-[13px] tabular-nums" style={{ fontFamily: LP_MONO }}>
                <thead><tr style={{ color: C.dim }}>{['id', 'plan', 'tenure', 'charges'].map(h => <th key={h} className="text-left font-normal pb-2">{h}</th>)}</tr></thead>
                <tbody>
                  {demo.rows.slice(0, 9).map((r, i) => {
                    const filled = (c: 'tenure' | 'charges') => demo.fills.some(f => f.row === i && f.col === c);
                    return (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td className="py-1.5" style={{ color: C.dim }}>{r.id}</td>
                        <td style={{ color: '#cfcfcf' }}>{r.plan}</td>
                        {(['tenure', 'charges'] as const).map(c => <td key={c} style={{ color: filled(c) ? C.green : '#cfcfcf' }}>{String(r[c])}{filled(c) && <span style={{ color: C.dim }}> ←</span>}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded-[16px] p-5 flex flex-col" style={{ background: '#0e0e0e' }}>
              <p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim }}>Filled</p>
              {demo.fills.map(f => <p key={`${f.row}${f.col}`} className="mt-3 text-[15px]"><span style={{ color: C.green }}>{f.value}</span> <span style={{ color: C.mute }}>{f.col}, row {f.row + 1}</span></p>)}
              <p className="mt-auto text-[13px] leading-relaxed" style={{ color: C.mute }}>Each blank took its column’s median, and every change is a version you can undo.</p>
            </div>
          </div>
          <CardFoot label="Clean" onExplore={start} />
        </Card>

        <Card className="h-[480px] flex items-center justify-center">
          <div className="-mt-6"><LiquidSphere size={330} /></div>
          <CardFoot label="Ask AI" onExplore={start} />
        </Card>
      </section>

      {/* For developers */}
      <section id="lp-developers" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center scroll-mt-24">
        <div>
          <p className="text-[17px]" style={{ color: C.mute }}>For developers</p>
          <h2 className="mt-5 font-medium leading-[1.04]" style={{ fontSize: 'clamp(40px, 5.2vw, 76px)', letterSpacing: '-0.045em' }}>One engine.<br />Every method.</h2>
          <p className="mt-6 max-w-[620px] text-[18px] sm:text-[20px] leading-relaxed" style={{ color: '#d6d6d6' }}>
            Statistics, causal inference, machine learning, forecasting and reports, behind one API. The studio uses the same calls you can make yourself.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <button type="button" onClick={start} className="h-[56px] px-7 rounded-full bg-white text-black text-[17px] hover:bg-white/90 transition-colors">Try for free</button>
            <a href={`${REPO}/blob/main/docs/ENGINE_CAPABILITIES.md`} target="_blank" rel="noreferrer" className="h-[56px] px-7 rounded-full text-[17px] inline-flex items-center lp-dark-btn">Read the docs</a>
          </div>
          <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
            {[[String(ENGINE_COUNT), 'Engine analyses'], [String(AGENT_COUNT), 'Specialist agents'], [String(STAGE_ORDER.length), 'Steps, in order']].map(([v, l]) => (
              <div key={l}><dt className="text-[19px]">{v}</dt><dd className="mt-1 text-[16px]" style={{ color: C.dim }}>{l}</dd></div>
            ))}
          </dl>
        </div>
        <CodeWindow />
      </section>


      {/* The engine, area by area (counted from its contract) */}
      <section id="lp-engine" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 scroll-mt-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-10 items-end">
          <div>
            <p className="text-[17px]" style={{ color: C.mute }}>The engine</p>
            <h2 className="mt-5 font-medium leading-[1.04]" style={{ fontSize: 'clamp(38px, 4.8vw, 68px)', letterSpacing: '-0.045em' }}>{ENGINE_COUNT} analyses,<br />{ENGINE_AREAS.length} disciplines.</h2>
          </div>
          <p className="text-[18px] sm:text-[20px] leading-relaxed" style={{ color: '#d6d6d6' }}>
            A Python service built on scikit-learn, XGBoost, LightGBM, CatBoost, statsmodels, SciPy, SHAP, Optuna and DuckDB. Every analysis checks its inputs, records its parameters and seed, and can be reproduced as a notebook.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-[22px] overflow-hidden" style={{ background: C.line }}>
          {ENGINE_AREAS.map(a => (
            <div key={a.area} className="p-7" style={{ background: C.card }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[20px] tracking-tight">{a.label}</span>
                <span className="text-[14px] tabular-nums" style={{ color: C.dim, fontFamily: LP_MONO }}>{String(a.items.length).padStart(2, '0')}</span>
              </div>
              <ul className="mt-4 space-y-1.5 text-[14.5px] leading-snug" style={{ color: C.mute }}>
                {a.items.slice(0, 4).map(t => <li key={t}>{t}</li>)}
                {a.items.length > 4 && <li style={{ color: C.dim }}>and {a.items.length - 4} more</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Where it runs */}
      <section id="lp-platform" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 scroll-mt-24">
        <p className="text-[17px]" style={{ color: C.mute }}>Where it runs</p>
        <h2 className="mt-5 max-w-[900px] font-medium leading-[1.04]" style={{ fontSize: 'clamp(38px, 4.8vw, 68px)', letterSpacing: '-0.045em' }}>Your browser, Render and Google Cloud.</h2>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
          {PLATFORM.map(p => (
            <div key={p.name} className="rounded-[22px] p-7 flex flex-col min-h-[300px]" style={{ background: C.card }}>
              <span className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim, fontFamily: LP_MONO }}>{p.where}</span>
              <span className="mt-4 text-[24px] tracking-tight">{p.name}</span>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: C.mute }}>{p.what}</p>
              <p className="mt-auto pt-6 text-[13px] leading-relaxed" style={{ color: C.dim, fontFamily: LP_MONO }}>{p.stack}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Big numbers */}
      <section id="lp-numbers" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 scroll-mt-24">
        <div style={{ borderTop: `1px solid ${C.line}` }} className="grid grid-cols-1 md:grid-cols-3">
          {[[String(ENGINE_COUNT), 'analyses run on a real engine: tests, models, forecasts, causal methods and more'],
            [String(AGENT_COUNT), 'specialists who plan, do and check the work, step by step'],
            ['0', 'numbers written by AI: it writes words, plans and code, never metrics']].map(([v, l], i) => (
            <div key={l} className={`pt-14 pb-6 ${i ? 'md:pl-16' : ''} ${i < 2 ? 'md:border-r' : ''}`} style={{ borderColor: C.line }}>
              <p className="font-medium leading-none" style={{ fontSize: 'clamp(64px, 8vw, 110px)', letterSpacing: '-0.05em' }}>{v}</p>
              <p className="mt-6 max-w-[340px] text-[17px] leading-relaxed" style={{ color: C.mute }}>{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The seven steps */}
      <section id="lp-steps" className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 scroll-mt-24">
        <h2 className="font-medium leading-[1.05]" style={{ fontSize: 'clamp(36px, 4.4vw, 60px)', letterSpacing: '-0.04em' }}>Seven steps, in order.</h2>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STAGE_ORDER.map((s, i) => {
            const st = STAGES[s];
            const Icon = st.icon;
            return (
              <button key={s} type="button" onClick={start} className="lp-step text-left rounded-[22px] p-6 flex flex-col min-h-[220px]" style={{ background: C.card }}>
                <span className="flex items-center justify-between"><span className="text-[13px] tabular-nums" style={{ color: C.dim }}>0{i + 1}</span><Icon className="w-5 h-5" style={{ color: C.mute }} /></span>
                <span className="mt-auto pt-8 block min-h-[118px]">
                  <span className="block text-[22px] tracking-tight">{st.label}</span>
                  <span className="block mt-2 text-[14.5px] leading-relaxed" style={{ color: C.mute }}>{st.description}</span>
                </span>
              </button>
            );
          })}
          <button type="button" onClick={start} className="lp-step rounded-[22px] p-6 flex flex-col min-h-[220px] text-left bg-white text-black">
            <span className="text-[13px] opacity-60">Start</span>
            <span className="mt-auto pt-8 block min-h-[118px]">
              <span className="text-[22px] tracking-tight inline-flex items-center gap-2">Open the studio <ArrowRight className="w-5 h-5" /></span>
              <span className="block mt-2 text-[14.5px] opacity-60">Import a file, or try a sample.</span>
            </span>
          </button>
        </div>
      </section>

      {/* Two ways to use it */}
      <section className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 grid grid-cols-1 lg:grid-cols-2 gap-10">
        {([
          { title: 'Start in your browser', sub: 'Free, with nothing to install:', items: ['Every step, from import to report', `${AGENT_COUNT} agents that work on your page`, 'Your work saved and versioned in your browser', 'Your own Gemini or ARC key, if you like'], cta: 'Try for free', primary: true },
          { title: 'Run it your way', sub: 'Open source, on your own machines:', items: ['The full source on GitHub', 'One command with Docker', 'The engine on Cloud Run, the studio anywhere', 'Notebooks that reproduce every run'], cta: 'View on GitHub', primary: false },
        ]).map(p => (
          <Card key={p.title} className="p-8 sm:p-16 flex flex-col">
            <h3 className="text-[30px] sm:text-[38px] tracking-tight">{p.title}</h3>
            <p className="mt-3 text-[18px] sm:text-[20px]" style={{ color: '#d6d6d6' }}>{p.sub}</p>
            <div className="my-9 h-px" style={{ background: C.line }} />
            <ul className="space-y-4 text-[17px] sm:text-[19px]">
              {p.items.map(t => <li key={t} className="flex items-start gap-4"><Check className="w-5 h-5 mt-1 shrink-0" style={{ color: C.dim }} />{t}</li>)}
            </ul>
            <div className="mt-14">
              {p.primary
                ? <button type="button" onClick={start} className="w-full h-[62px] rounded-full bg-white text-black text-[17px] hover:bg-white/90 transition-colors">{p.cta}</button>
                : <a href={REPO} target="_blank" rel="noreferrer" className="w-full h-[62px] rounded-full text-[17px] inline-flex items-center justify-center lp-outline-btn">{p.cta}</a>}
            </div>
          </Card>
        ))}
      </section>

      {/* Footer */}
      <footer className="mt-40" style={{ borderTop: `1px solid ${C.line}`, background: '#0b0b0b' }}>
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-16 grid grid-cols-1 lg:grid-cols-[1fr_2.2fr] gap-12">
          <div className="lg:border-r lg:border-dashed pr-8" style={{ borderColor: C.line }}>
            <div className="flex items-center gap-2.5"><AppIcon size={28} /><span className="text-[17px] font-medium tracking-tight">Data Science Studio</span></div>
            <p className="mt-4 text-[14px]" style={{ color: C.mute }}>© {new Date().getFullYear()} AskDeepakAI · Deepak Reddy</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-[16px]">
            <div>
              <p>Studio</p>
              <ul className="mt-4 space-y-3">{STAGE_ORDER.map(s => <li key={s}><button type="button" onClick={start} className="lp-foot">{STAGES[s].label}</button></li>)}</ul>
            </div>
            <div>
              <p>Agents</p>
              <ul className="mt-4 space-y-3">{(['orchestrator', 'data_engineer', 'statistician', 'ml_engineer', 'dashboard_designer', 'verifier'] as const).map(r => <li key={r}><span className="lp-foot">{AGENTS[r].name}</span></li>)}</ul>
            </div>
            <div>
              <p>Engine</p>
              <ul className="mt-4 space-y-3">
                <li><a className="lp-foot" href={`${REPO}/blob/main/docs/ENGINE_CAPABILITIES.md`} target="_blank" rel="noreferrer">Analyses</a></li>
                <li><button type="button" className="lp-foot" onClick={() => goTo('lp-developers')}>API</button></li>
                <li><a className="lp-foot" href={`${REPO}#deploy`} target="_blank" rel="noreferrer">Deploy</a></li>
              </ul>
            </div>
            <div>
              <p>Project</p>
              <ul className="mt-4 space-y-3">
                <li><a className="lp-foot" href={REPO} target="_blank" rel="noreferrer">GitHub</a></li>
                <li><a className="lp-foot" href={`${REPO}#readme`} target="_blank" rel="noreferrer">README</a></li>
                <li><a className="lp-foot" href="https://github.com/thedeepakreddy" target="_blank" rel="noreferrer">Deepak Reddy</a></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
