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
import { ChatPanel, CleanPanel, CountUp, DashboardPanel, EnginePanel, Reveal, useInView } from './landingPanels';
import { CursorGlyph } from './AgentCursor';
import type { AgentRole } from '../swarm/agents';
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
const LP_SANS = '"Geist", "Inter", -apple-system, BlinkMacSystemFont, sans-serif';
const LP_MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const still = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const C = {
  bg: '#0a0a0a',
  card: 'rgba(20,20,20,0.82)',
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
  return <div className={`relative overflow-hidden rounded-[22px] lp-glass ${className}`} style={{ background: C.card, ...style }}>{children}</div>;
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
  // The code types itself out the first time it is seen; a tab change shows it whole.
  const [ref, seen] = useInView<HTMLDivElement>(0.3, true);
  const [shown, setShown] = useState(still() ? Infinity : 0);
  useEffect(() => {
    if (!seen || still()) return;
    let n = 0, raf = 0, last = performance.now();
    const tick = (t: number) => {
      n += Math.max(1, Math.round((t - last) / 9)); last = t;
      setShown(n);
      if (n < 2000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div ref={ref}>
      <div className="relative p-6 sm:p-10 lp-grain-panel">
        <div className="relative rounded-[16px] overflow-hidden" style={{ background: '#0d0d0d', border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.line}` }}>
            <span className="flex gap-2" aria-hidden="true">{['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />)}</span>
            <button type="button" onClick={copy} data-cur="copy" className="lp-link text-[13px] inline-flex items-center gap-1.5">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <pre className="px-5 py-5 text-[12.5px] sm:text-[13.5px] leading-[1.75] overflow-x-auto" style={{ color: '#e6e6e6', fontFamily: LP_MONO }}><code>{highlight(code.slice(0, shown))}{shown < code.length && <span className="lp-caret" style={{ height: '1em' }} />}</code></pre>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-1" role="tablist">
        {(['Python', 'TypeScript', 'cURL'] as const).map(t => (
          <button key={t} type="button" role="tab" data-cur={`tab-${t}`} aria-selected={tab === t} onClick={() => { setTab(t); setShown(Infinity); }}
            className="px-4 py-2 rounded-full text-[15px] transition-colors" style={{ background: tab === t ? C.pill : 'transparent', color: tab === t ? C.text : C.mute }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Text as separate letters (words kept together), for the scroll motion to move. */
function Split({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={className} aria-label={text}>
      {text.split(' ').map((w, wi, arr) => (
        <span key={wi} className="inline-block whitespace-nowrap" aria-hidden="true">
          {[...w].map((ch, ci) => <span key={ci} className="lp-char">{ch}</span>)}
          {wi < arr.length - 1 && <span className="lp-char">&nbsp;</span>}
        </span>
      ))}
    </span>
  );
}

/** A band of words that runs sideways; the scroll motion speeds it up and turns it. */
function Marquee() {
  const a = [...STAGE_ORDER.map(s => STAGES[s].label), `${ENGINE_COUNT} analyses`, `${AGENT_COUNT} agents`];
  const row = (items: string[], dir: 1 | -1, outline: boolean) => (
    <div data-marquee={dir} data-skew className="overflow-hidden whitespace-nowrap py-2">
      <div className="inline-flex will-change-transform">
        {[0, 1].map(k => (
          <span key={k} className="inline-flex items-center" aria-hidden={k === 1}>
            {items.map(t => (
              <span key={t} className="inline-flex items-center">
                <span className={`px-6 sm:px-10 font-medium ${outline ? 'lp-outline-text' : ''}`} style={{ fontSize: 'clamp(48px, 9vw, 132px)', letterSpacing: '-0.04em', lineHeight: 1.05 }}>{t}</span>
                <span className="w-3 h-3 sm:w-4 sm:h-4 rounded-full" style={{ background: outline ? 'transparent' : '#f5f5f5', border: '2px solid #f5f5f5' }} />
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <section aria-label="What the studio does" className="mt-32 -rotate-2 scale-[1.04]">
      {row(a, 1, false)}
      {row([...a].reverse(), -1, true)}
    </section>
  );
}

const PAGE_CURSORS: AgentRole[] = ['orchestrator', 'statistician', 'ml_engineer', 'verifier', 'data_engineer'];

/** The agents' cursors on the page itself; the scroll motion sends them to each section. */
function PageCursors() {
  return (
    <div aria-hidden="true" className="fixed inset-0 z-[35] pointer-events-none overflow-hidden">
      {PAGE_CURSORS.map(role => (
        <div key={role} data-page-cursor={role} className="fixed left-0 top-0 will-change-transform" style={{ transform: 'translate3d(-120px,-120px,0)' }}>
          <CursorGlyph color={AGENTS[role].color} variant="solid" size={22} />
          <span className="agent-tag" style={{ left: 15, top: 18 }}><span className="font-semibold">{AGENTS[role].name}</span><span className="opacity-80" data-say /></span>
        </div>
      ))}
    </div>
  );
}

export default function Landing({ onStart }: { onStart: () => void }) {
  const demo = useMemo(() => demoResults(), []);
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // The 3D field and the scroll choreography load on their own (three.js and GSAP).
  useEffect(() => {
    const root = scroller.current, cv = canvas.current;
    if (!root || !cv) return;
    let cancelled = false, cleanup = () => {};
    const css = getComputedStyle(document.documentElement);
    const colors = Object.values(AGENTS).map(a => css.getPropertyValue(a.color.replace(/^var\((--[^,)]+).*$/, '$1')).trim()).filter(Boolean);
    Promise.all([import('./landingScene'), import('./landingMotion')]).then(([{ createDataField }, { initLandingMotion }]) => {
      if (cancelled) return;
      const calm = still();
      let field: import('./landingScene').DataField | null = null;
      try { field = createDataField(cv, { count: window.innerWidth < 768 ? 2600 : 6000, r: demo.r, agentColors: colors, still: calm }); } catch { field = null; }
      const onResize = () => field?.resize();
      const onMove = (e: PointerEvent) => field?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      const onLeave = () => field?.setPointer(null, null);
      window.addEventListener('resize', onResize);
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerleave', onLeave);
      const stopMotion = calm ? () => {} : initLandingMotion(root, field, { cursors: window.innerWidth >= 900 });
      cleanup = () => { stopMotion(); window.removeEventListener('resize', onResize); root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave); field?.dispose(); };
    }).catch(() => undefined);
    return () => { cancelled = true; cleanup(); };
    // Set up once for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = useCallback(() => { setLeaving(true); setTimeout(onStart, 380); }, [onStart]);
  const goTo = (id: string) => scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems: Array<[string, string]> = [['Studio', 'lp-steps'], ['Agents', 'lp-products'], ['Engine', 'lp-engine'], ['Developers', 'lp-developers'], ['Platform', 'lp-platform']];

  return (
    <div ref={scroller} role="dialog" aria-modal="true" aria-label="Data Science Studio" data-landing
      className="fixed inset-0 z-[10000] overflow-y-auto overflow-x-hidden"
      style={{ background: C.bg, color: C.text, opacity: leaving ? 0 : 1, transition: 'opacity 380ms ease', fontFamily: LP_SANS, colorScheme: 'dark', fontFeatureSettings: '"ss01", "cv11"', WebkitFontSmoothing: 'antialiased' }}>

      {/* The 3D data field behind everything, and the agents' cursors above it. */}
      <canvas ref={canvas} aria-hidden="true" className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }} />
      <PageCursors />

      {/* Header */}
      <header className="sticky top-0 z-30" style={{ background: 'rgba(10,10,10,0.82)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: `1px solid ${C.line}` }}>
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
      <section data-hero data-cursor-scene="hero" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 pt-20 sm:pt-28 text-center min-h-[86vh]">
        <button type="button" onClick={start} data-hero-fade style={{ animationDelay: '80ms' }} className="lp-rise inline-flex items-center gap-2 sm:gap-3 h-11 pl-2 pr-2 rounded-full text-[13.5px] sm:text-[15px] lp-badge max-w-full">
          <span className="px-2.5 py-0.5 rounded-full text-[13px]" style={{ background: 'rgba(255,120,40,0.12)', color: '#ff7a2f' }}>New</span>
          <span className="whitespace-nowrap">Tableau and Power BI import</span>
          <span className="hidden md:inline" style={{ color: C.mute }}>· open a workbook as a dashboard</span>
          <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: C.pill }}><ArrowUpRight className="w-3.5 h-3.5" /></span>
        </button>
        <h1 className="mt-10 mx-auto max-w-[1100px] font-medium leading-[1.02]" style={{ fontSize: 'clamp(34px, 6.2vw, 92px)', letterSpacing: '-0.045em' }}>
          <span className="lp-rise block" data-split style={{ animationDelay: '200ms' }}><Split text="A data science team" /></span>
          <span className="lp-rise block sm:whitespace-nowrap" data-split style={{ animationDelay: '340ms' }}><Split text="for everything you" /> <span data-cur="typed"><TypedWord /></span>.</span>
        </h1>
        <p data-hero-fade className="lp-rise mt-8 mx-auto max-w-[860px] text-[17px] sm:text-[21px] leading-relaxed" style={{ color: '#d6d6d6', animationDelay: '480ms' }}>
          Clean, explore, test, model, dashboard and report. {AGENT_COUNT} agents do the work on your page; every number comes from a real engine.
        </p>
        <div data-hero-fade className="lp-rise mt-10 flex flex-wrap items-center justify-center gap-4" style={{ animationDelay: '600ms' }}>
          <button type="button" onClick={start} data-cur="try" className="h-[60px] px-8 rounded-full bg-white text-black text-[17px] inline-flex items-center gap-2 hover:bg-white/90 transition-colors">Try for free <ChevronRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => goTo('lp-developers')} className="h-[60px] px-8 rounded-full text-[17px] lp-dark-btn">View the engine</button>
        </div>
      </section>

      {/* Live panels: the agents at work */}
      <section id="lp-products" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 -mt-[14vh] grid grid-cols-1 md:grid-cols-3 gap-5 scroll-mt-24" style={{ perspective: 1400 }}>
        <div data-tilt><ChatPanel demo={demo} onExplore={start} /></div>
        <div data-tilt><EnginePanel demo={demo} onExplore={() => goTo('lp-engine')} /></div>
        <div data-tilt><DashboardPanel demo={demo} onExplore={start} /></div>
      </section>

      <section className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5" style={{ perspective: 1400 }}>
        <div data-tilt><CleanPanel demo={demo} onExplore={start} /></div>
        <div data-tilt>
          <Card className="h-[480px] flex items-center justify-center">
            <div className="-mt-6"><LiquidSphere size={330} /></div>
            <CardFoot label="Ask AI" onExplore={start} />
          </Card>
        </div>
      </section>

      <div className="relative z-10"><Marquee /></div>

      {/* For developers */}
      <section id="lp-developers" data-scene="1" data-cursor-scene="dev" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center scroll-mt-24">
        <Reveal>
          <p className="text-[17px]" style={{ color: C.mute }}>For developers</p>
          <h2 data-skew className="mt-5 font-medium leading-[1.04]" style={{ fontSize: 'clamp(40px, 5.2vw, 76px)', letterSpacing: '-0.045em' }}>One engine.<br />Every method.</h2>
          <p className="mt-6 max-w-[620px] text-[18px] sm:text-[20px] leading-relaxed" style={{ color: '#d6d6d6' }}>
            Statistics, causal inference, machine learning, forecasting and reports, behind one API. The studio uses the same calls you can make yourself.
          </p>
          <div className="mt-9 flex flex-wrap gap-4">
            <button type="button" onClick={start} className="h-[56px] px-7 rounded-full bg-white text-black text-[17px] hover:bg-white/90 transition-colors">Try for free</button>
            <a href={`${REPO}/blob/main/docs/ENGINE_CAPABILITIES.md`} target="_blank" rel="noreferrer" className="h-[56px] px-7 rounded-full text-[17px] inline-flex items-center lp-dark-btn">Read the docs</a>
          </div>
          <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
            {([[ENGINE_COUNT, 'Engine analyses'], [AGENT_COUNT, 'Specialist agents'], [STAGE_ORDER.length, 'Steps, in order']] as const).map(([v, l]) => (
              <div key={l}><dt className="text-[19px]"><CountUp to={v} /></dt><dd className="mt-1 text-[16px]" style={{ color: C.dim }}>{l}</dd></div>
            ))}
          </dl>
        </Reveal>
        <div data-from="right"><CodeWindow /></div>
      </section>


      {/* The engine, area by area (counted from its contract) */}
      <section id="lp-engine" data-scene="2" data-cursor-scene="engine" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 scroll-mt-24">
        <Reveal className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-10 items-end">
          <div>
            <p className="text-[17px]" style={{ color: C.mute }}>The engine</p>
            <h2 className="mt-5 font-medium leading-[1.04]" style={{ fontSize: 'clamp(38px, 4.8vw, 68px)', letterSpacing: '-0.045em' }}><CountUp to={ENGINE_COUNT} /> analyses,<br />{ENGINE_AREAS.length} disciplines.</h2>
          </div>
          <p className="text-[18px] sm:text-[20px] leading-relaxed" style={{ color: '#d6d6d6' }}>
            A Python service built on scikit-learn, XGBoost, LightGBM, CatBoost, statsmodels, SciPy, SHAP, Optuna and DuckDB. Every analysis checks its inputs, records its parameters and seed, and can be reproduced as a notebook.
          </p>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ENGINE_AREAS.map(a => (
            <div key={a.area} data-burst data-area={a.label} data-count={a.items.length} className="p-7 lp-area lp-glass rounded-[18px]" style={{ background: C.card }}>
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
      <section id="lp-platform" data-cursor-scene="platform" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-36 scroll-mt-24">
        <Reveal>
          <p className="text-[17px]" style={{ color: C.mute }}>Where it runs</p>
          <h2 className="mt-5 max-w-[900px] font-medium leading-[1.04]" style={{ fontSize: 'clamp(38px, 4.8vw, 68px)', letterSpacing: '-0.045em' }}>Your browser, Render and Google Cloud.</h2>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5" style={{ perspective: 1200 }}>
          {PLATFORM.map(p => (
            <div key={p.name} data-flip data-platform={`${p.name} · ${p.where}`} className="lp-tile lp-glass rounded-[22px] p-7 flex flex-col min-h-[300px]" style={{ background: C.card }}>
              <span className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim, fontFamily: LP_MONO }}>{p.where}</span>
              <span className="mt-4 text-[24px] tracking-tight">{p.name}</span>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: C.mute }}>{p.what}</p>
              <p className="mt-auto pt-6 text-[13px] leading-relaxed" style={{ color: C.dim, fontFamily: LP_MONO }}>{p.stack}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Big numbers */}
      <section id="lp-numbers" data-cursor-scene="numbers" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 scroll-mt-24">
        <div style={{ borderTop: `1px solid ${C.line}` }} className="grid grid-cols-1 md:grid-cols-3">
          {([[ENGINE_COUNT, 'analyses run on a real engine: tests, models, forecasts, causal methods and more'],
            [AGENT_COUNT, 'specialists who plan, do and check the work, step by step'],
            [0, 'numbers written by AI: it writes words, plans and code, never metrics']] as const).map(([v, l], i) => (
            <Reveal key={l} className={`pt-14 pb-6 ${i ? 'md:pl-16' : ''} ${i < 2 ? 'md:border-r' : ''}`} style={{ borderColor: C.line }}>
              <p data-bignum className="font-medium leading-none" style={{ fontSize: 'clamp(64px, 8vw, 110px)', letterSpacing: '-0.05em' }}><CountUp to={v} duration={1800} /></p>
              <p className="mt-6 max-w-[340px] text-[17px] leading-relaxed" style={{ color: C.mute }}>{l}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The seven steps */}
      <section id="lp-steps" data-scene="3" data-hscroll data-cursor-scene="steps" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 scroll-mt-24 lg:overflow-hidden" style={{ perspective: 1600 }}>
        <Reveal as="div"><h2 className="font-medium leading-[1.05]" style={{ fontSize: 'clamp(36px, 4.4vw, 60px)', letterSpacing: '-0.04em' }}>Seven steps, in order.</h2></Reveal>
        <div data-track className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-5 lg:flex lg:w-max lg:pr-8">
          {STAGE_ORDER.map((s, i) => {
            const st = STAGES[s];
            const Icon = st.icon;
            return (
              <div key={s} data-step={i + 1} className="lg:w-[360px] lg:shrink-0"><button type="button" onClick={start} className="w-full h-full lp-step lp-glass text-left rounded-[22px] p-6 flex flex-col min-h-[220px] lg:min-h-[340px]" style={{ background: C.card }}>
                <span className="flex items-center justify-between"><span className="text-[13px] tabular-nums" style={{ color: C.dim }}>0{i + 1}</span><Icon className="w-5 h-5" style={{ color: C.mute }} /></span>
                <span className="mt-auto pt-8 block min-h-[118px]">
                  <span className="block text-[22px] tracking-tight">{st.label}</span>
                  <span className="block mt-2 text-[14.5px] leading-relaxed" style={{ color: C.mute }}>{st.description}</span>
                </span>
              </button></div>
            );
          })}
          <div className="lg:w-[360px] lg:shrink-0"><button type="button" onClick={start} className="w-full h-full lp-step rounded-[22px] p-6 flex flex-col min-h-[220px] lg:min-h-[340px] text-left bg-white text-black">
            <span className="text-[13px] opacity-60">Start</span>
            <span className="mt-auto pt-8 block min-h-[118px]">
              <span className="text-[22px] tracking-tight inline-flex items-center gap-2">Open the studio <ArrowRight className="w-5 h-5" /></span>
              <span className="block mt-2 text-[14.5px] opacity-60">Import a file, or try a sample.</span>
            </span>
          </button></div>
        </div>
      </section>

      {/* Two ways to use it */}
      <section data-scene="4" className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 mt-32 grid grid-cols-1 lg:grid-cols-2 gap-10">
        {([
          { title: 'Start in your browser', sub: 'Free, with nothing to install:', items: ['Every step, from import to report', `${AGENT_COUNT} agents that work on your page`, 'Your work saved and versioned in your browser', 'Your own Gemini or ARC key, if you like'], cta: 'Try for free', primary: true },
          { title: 'Run it your way', sub: 'Open source, on your own machines:', items: ['The full source on GitHub', 'One command with Docker', 'The engine on Cloud Run, the studio anywhere', 'Notebooks that reproduce every run'], cta: 'View on GitHub', primary: false },
        ]).map((p, i) => (
          <div key={p.title} data-from={i ? 'right' : 'left'}><Card className="h-full p-8 sm:p-16 flex flex-col">
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
          </Card></div>
        ))}
      </section>

      {/* Footer */}
      <div data-wordmark aria-hidden="true" className="relative z-10 mt-40 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <p className="mx-auto max-w-[1400px] font-medium leading-[0.9] whitespace-nowrap" style={{ fontSize: 'clamp(40px, 10.6vw, 184px)', letterSpacing: '-0.055em' }}><Split text="Data Science Studio" /></p>
      </div>
      <footer className="relative z-10 mt-10" style={{ borderTop: `1px solid ${C.line}`, background: 'rgba(11,11,11,0.92)' }}>
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
