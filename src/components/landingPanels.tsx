/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { AGENTS, AgentRole } from '../swarm/agents';
import { HumanMover, Point } from '../swarm/humanMotion';
import { CursorGlyph } from './AgentCursor';
import type { demoResults } from './welcomeDemo';

// The front page's live panels and motion. As in the agents' welcome, agents
// move in and do the work while you watch: every value they type or draw is
// computed from the 20-row sample (welcomeDemo.ts). A panel plays when it
// scrolls into view, loops while it is visible and rests when it isn't. With
// reduced motion each panel is its finished picture.

type Demo = ReturnType<typeof demoResults>;

export const still = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
const C = { card: 'rgba(20,20,20,0.82)', line: 'rgba(255,255,255,0.07)', text: '#f5f5f5', mute: '#8b8b8b', dim: '#5c5c5c', green: '#7ee787' };

/** Thrown to end a choreography when its panel leaves view. */
class Stopped extends Error {}

/** Whether an element is on screen (`once`: stays true after the first time). */
export function useInView<T extends Element>(threshold = 0.3, once = false) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeen(true); if (once) io.disconnect(); } else if (!once) setSeen(false);
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);
  return [ref, seen] as const;
}

/** Rises into place when it scrolls into view (the page's motion batches every [data-reveal]). */
export function Reveal({ children, className = '', as: Tag = 'div', style }: { children: React.ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li'; style?: React.CSSProperties; key?: React.Key }) {
  return React.createElement(Tag, { 'data-reveal': '', className, style }, children);
}

/** Counts up to a number the first time it is seen. */
export function CountUp({ to, duration = 1400 }: { to: number; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4, true);
  const [v, setV] = useState(still() ? to : 0);
  useEffect(() => {
    if (!seen || still()) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration]);
  return <span ref={ref} className="tabular-nums">{v}</span>;
}

/** An agent's name tag: a pill in the agent's colour, like a collaborator's cursor. */
export function AgentTag({ role, label, small = false }: { role: AgentRole; label?: string; small?: boolean }) {
  return (
    <span className={`lp-tag${small ? ' small' : ''}`} style={{ '--c': AGENTS[role].color } as React.CSSProperties}>
      <span className="lp-tag-name">{AGENTS[role].name}</span>
      {label && <span className="lp-tag-say" data-say-text>{label}</span>}
    </span>
  );
}

/** Agent cursors that live inside one panel. */
function useStage(roles: AgentRole[], root: React.RefObject<HTMLDivElement | null>) {
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const movers = useRef<HumanMover[]>([]);
  const [labels, setLabels] = useState<string[]>(() => roles.map(() => ''));
  const api = useMemo(() => {
    const box = () => root.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 400, 400);
    const offstage = (i: number): Point => { const b = box(); return { x: b.width * (0.25 + 0.5 * (i / Math.max(1, roles.length - 1))), y: b.height + 40 }; };
    return {
      begin() { movers.current.forEach(m => m.stop()); movers.current = els.current.map((el, i) => new HumanMover(el, offstage(i))); },
      end() { movers.current.forEach(m => m.stop()); },
      at(sel: string, fx = 0.5, fy = 0.5): Point {
        const b = box(); const r = root.current?.querySelector(sel)?.getBoundingClientRect();
        return r ? { x: r.left - b.left + r.width * fx, y: r.top - b.top + r.height * fy } : { x: b.width / 2, y: b.height / 2 };
      },
      go(i: number, p: Point, opts: Parameters<HumanMover['moveTo']>[1] = {}) { return movers.current[i]?.moveTo(p, { maxDuration: 650, ...opts }) ?? Promise.resolve(); },
      jump(i: number, p: Point) { movers.current[i]?.jump(p); },
      leave(i: number) { setLabels(l => l.map((x, k) => (k === i ? '' : x))); return this.go(i, offstage(i), { maxDuration: 700, arc: 0.2 }); },
      say(i: number, t: string) { setLabels(l => l.map((x, k) => (k === i ? t : x))); },
      async press(i: number) { const el = els.current[i]; el?.classList.add('is-pressing'); await new Promise(r => setTimeout(r, 130)); el?.classList.remove('is-pressing'); },
    };
  }, [roles, root]);
  const cursors = still() ? null : roles.map((role, i) => (
    <div key={role} ref={el => { els.current[i] = el; }} className="absolute left-0 top-0 z-20 pointer-events-none will-change-transform" aria-hidden="true" style={{ transform: 'translate3d(-80px,-80px,0)' }}>
      <CursorGlyph color={AGENTS[role].color} variant="solid" size={19} />
      <AgentTag role={role} label={labels[i]} small />
    </div>
  ));
  return { cursors, ...api };
}

/** Runs `play` in a loop while the panel is visible; `reset` before each round. */
function useLoop(visible: boolean, play: (w: (ms: number) => Promise<void>, alive: () => boolean) => Promise<void>, onStop: () => void) {
  useEffect(() => {
    if (!visible || still()) return;
    let alive = true;
    const w = (ms: number) => new Promise<void>((res, rej) => setTimeout(() => (alive ? res() : rej(new Stopped())), ms));
    (async () => {
      try { while (alive) await play(w, () => alive); } catch (e) { if (!(e instanceof Stopped)) console.error(e); }
    })();
    return () => { alive = false; onStop(); };
    // The choreography is fixed for the panel's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
}

function Foot({ label, onExplore }: { label: string; onExplore: () => void }) {
  return (
    <div className="absolute left-0 right-0 bottom-0 z-10 px-6 pb-5 pt-10 flex items-end justify-between" style={{ background: `linear-gradient(to top, ${C.card} 55%, transparent)` }}>
      <span className="text-[20px] font-semibold" style={{ color: C.text, fontFamily: 'var(--font-display)' }}>{label}</span>
      <button type="button" onClick={onExplore} className="lp-link text-[17px] inline-flex items-center gap-1.5">Explore <ArrowRight className="w-4 h-4" /></button>
    </div>
  );
}

function Shell({ children, h, label, onExplore, bg, inner }: { children: React.ReactNode; h: number; label: string; onExplore: () => void; bg?: string; inner?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={inner} className="relative overflow-hidden rounded-[22px] lp-panel lp-glass" style={{ height: h, background: bg ?? C.card }}>
      {children}
      <Foot label={label} onExplore={onExplore} />
    </div>
  );
}

/** A conversation: the question is typed, the Orchestrator thinks, the answer is this sample's number. */
export function ChatPanel({ demo, onExplore }: { demo: Demo; onExplore: () => void }) {
  const monthly = demo.byPlan.find(g => g.plan === 'Monthly')!;
  const yearly = demo.byPlan.find(g => g.plan === 'Yearly')!;
  const turns = useMemo(() => [
    ['Why do customers leave?', `Monthly plans churn at ${pct(monthly.rate)}, yearly at ${pct(yearly.rate)} (${monthly.n + yearly.n} customers).`],
    ['Are tenure and charges related?', `r = ${demo.r.toFixed(2)} across all 20 rows: ${demo.r < 0 ? 'newer customers pay more' : 'longer-standing customers pay more'}.`],
    ['Can we predict who leaves?', `${pct(demo.model.accuracy)} right on ${demo.model.testRows} customers the model never saw. Rule: ${demo.model.rule}.`],
  ], [demo, monthly, yearly]);
  const all = turns.flatMap(([q, a]) => [{ me: true, text: q }, { me: false, text: a }]);
  const [msgs, setMsgs] = useState<Array<{ me: boolean; text: string }>>(still() ? all : []);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [ref, visible] = useInView<HTMLDivElement>(0.35);
  useLoop(visible, async w => {
    setMsgs([]); setDraft('');
    await w(500);
    for (const [q, a] of turns) {
      for (let k = 1; k <= q.length; k++) { setDraft(q.slice(0, k)); await w(38 + Math.random() * 40); }
      await w(260);
      setDraft(''); setMsgs(m => [...m, { me: true, text: q }]);
      await w(350); setThinking(true); await w(1100); setThinking(false);
      setMsgs(m => [...m, { me: false, text: a }]);
      await w(1500);
    }
    await w(2400);
  }, () => setThinking(false));
  return (
    <Shell h={420} label="Agents" onExplore={onExplore} inner={ref}>
      <div className="absolute inset-x-0 top-0 bottom-[132px] px-6 pt-6 flex flex-col justify-end gap-3 overflow-hidden">
        {msgs.slice(-5).map((m, i) => (
          <div key={`${msgs.length}-${i}`} className={`lp-in max-w-[86%] px-4 py-2.5 rounded-[18px] text-[14px] leading-snug ${m.me ? 'self-end' : 'self-start'}`}
            style={{ background: m.me ? '#232323' : '#1a1a1a', color: m.me ? C.text : '#d9d9d9' }}>
            {!m.me && <span className="block text-[11px] mb-0.5" style={{ color: AGENTS.orchestrator.color }}>Orchestrator</span>}
            {m.text}
          </div>
        ))}
        {thinking && <div className="lp-in self-start px-4 py-3 rounded-[18px] flex gap-1.5" style={{ background: '#1a1a1a' }} aria-label="Thinking">{[0, 1, 2].map(k => <span key={k} className="lp-typing" style={{ animationDelay: `${k * 160}ms` }} />)}</div>}
      </div>
      {/* The message box, where the question is typed. */}
      <div className="absolute inset-x-5 bottom-[76px] h-11 rounded-full px-4 flex items-center text-[13.5px]" style={{ background: '#0f0f0f', border: `1px solid ${C.line}`, color: draft ? C.text : C.dim }}>
        {draft || 'Give the team a goal…'}{draft && <span className="lp-caret" style={{ height: '1em' }} />}
      </div>
    </Shell>
  );
}

/** The engine's run log: the command is typed, then each call returns its real result. */
export function EnginePanel({ demo, onExplore }: { demo: Demo; onExplore: () => void }) {
  const cmd = 'Find why customers leave and build a dashboard.';
  const lines = useMemo(() => [
    { kind: 'tool', text: 'quality.check', tail: `${demo.fills.length} blanks found` },
    ...demo.fills.map(f => ({ kind: 'add', text: `${f.col}[${f.row}] = ${f.value}`, tail: 'median' })),
    { kind: 'tool', text: 'stats.correlation', tail: `r = ${demo.r.toFixed(2)}` },
    { kind: 'tool', text: 'models.train', tail: `${pct(demo.model.accuracy)} on held-out rows` },
    { kind: 'tool', text: 'dashboard.design', tail: '1 chart' },
    { kind: 'done', text: 'Verifier recomputed 3 results', tail: '[done]' },
  ], [demo]);
  const [typed, setTyped] = useState(still() ? cmd.length : 0);
  const [n, setN] = useState(still() ? lines.length : 0);
  const [ref, visible] = useInView<HTMLDivElement>(0.35);
  useLoop(visible, async w => {
    setTyped(0); setN(0);
    await w(500);
    for (let k = 1; k <= cmd.length; k++) { setTyped(k); await w(28 + Math.random() * 30); }
    for (let k = 1; k <= lines.length; k++) { await w(620 + Math.random() * 380); setN(k); }
    await w(3000);
  }, () => undefined);
  const done = n / lines.length;
  return (
    <Shell h={420} label="Engine" onExplore={onExplore} bg="rgba(16,16,16,0.86)" inner={ref}>
      <div className="flex items-center gap-3 px-5 py-3.5 text-[13px]" style={{ borderBottom: `1px solid ${C.line}`, fontFamily: MONO }}>
        <span className="flex gap-1.5" aria-hidden="true">{['#ff5f57', '#febc2e', '#28c840'].map(c => <span key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />)}</span>
        <span style={{ color: C.mute }}>customers.csv</span>
        <span className="ml-auto flex items-center gap-2 tabular-nums" style={{ color: C.mute }}>
          <span className="w-16 h-2 rounded-sm overflow-hidden" style={{ background: '#2a2a2a' }}><span className="block h-full bg-white/80 transition-[width] duration-500" style={{ width: pct(done) }} /></span>
          {pct(done)}
        </span>
      </div>
      <div className="px-5 py-4 space-y-2 text-[13px] leading-relaxed" style={{ fontFamily: MONO }}>
        <div className="flex gap-2"><span style={{ color: '#8b9cff' }}>❯</span><span style={{ color: C.text }}>{cmd.slice(0, typed)}{typed < cmd.length && <span className="lp-caret" style={{ height: '1em' }} />}</span></div>
        {lines.slice(0, n).map((l, i) => (
          <div key={i} className="lp-in flex gap-2">
            {l.kind === 'tool' && <><span style={{ color: C.green }}>▸</span><span style={{ color: C.green }}>{l.text}</span><span style={{ color: C.dim }}>{l.tail}</span></>}
            {l.kind === 'add' && <span className="flex-1 px-2 rounded-sm" style={{ background: 'rgba(46,160,67,0.18)', color: '#d2f5d8' }}>+ {l.text} <span style={{ color: C.dim }}>{l.tail}</span></span>}
            {l.kind === 'done' && <><span style={{ color: '#c49bff' }}>◆</span><span style={{ color: C.mute }}>{l.text}</span><span className="ml-auto" style={{ color: C.green }}>{l.tail}</span></>}
          </div>
        ))}
        {typed >= cmd.length && n < lines.length && <div className="flex gap-2" style={{ color: C.mute }}><span className="lp-dots">⋮</span>Thinking…</div>}
      </div>
    </Shell>
  );
}

/** The Dashboard Designer drags a chart into the dashboard and widens it by its curved corner. */
export function DashboardPanel({ demo, onExplore }: { demo: Demo; onExplore: () => void }) {
  const [ref, visible] = useInView<HTMLDivElement>(0.35);
  const stage = useStage(useMemo<AgentRole[]>(() => ['dashboard_designer'], []), ref);
  const [ask, setAsk] = useState(still());
  const [chartIn, setChartIn] = useState(still());
  const [wide, setWide] = useState(still() ? 1 : 0);
  const [drag, setDrag] = useState<Point | null>(null);
  const [bars, setBars] = useState(still());
  const [pinned, setPinned] = useState(still());
  const maxRate = Math.max(...demo.byPlan.map(g => g.rate), 0.01);
  useLoop(visible, async w => {
    setAsk(false); setChartIn(false); setWide(0); setDrag(null); setBars(false); setPinned(false);
    stage.begin();
    await w(500);
    setAsk(true); await w(900);
    stage.say(0, 'Choosing a chart');
    const tray = stage.at('[data-p="tray"]');
    await stage.go(0, tray); await stage.press(0);
    stage.say(0, 'Adding it to the dashboard');
    const slot = stage.at('[data-p="slot"]', 0.62, 0.5);
    for (let k = 1; k <= 16; k++) { const p = { x: tray.x + ((slot.x - tray.x) * k) / 16, y: tray.y + ((slot.y - tray.y) * k) / 16 }; setDrag(p); stage.jump(0, p); await w(24); }
    setDrag(null); setChartIn(true);
    await w(160); setBars(true); await w(500);
    stage.say(0, 'Making it wider');
    const corner = stage.at('[data-p="corner"]', 0.4, 0.6);
    await stage.go(0, corner); await stage.press(0);
    const slotBox = stage.at('[data-p="slot"]', 0, 0.5), slotRight = stage.at('[data-p="slot"]', 1, 0.5);
    const span = (slotRight.x - slotBox.x) * 0.36;
    for (let k = 1; k <= 14; k++) { setWide(k / 14); stage.jump(0, { x: corner.x - (k / 14) * span, y: corner.y + k }); await w(28); }
    await w(300);
    setPinned(true);
    stage.say(0, 'Pinned');
    await w(900);
    await stage.leave(0);
    await w(2400);
  }, () => stage.end());
  return (
    <Shell h={420} label="Dashboard" onExplore={onExplore} inner={ref}>
      <div className="px-6 pt-6 flex flex-col gap-4">
        <div className={`self-end max-w-[88%] px-5 py-3 rounded-[20px] text-[15px] leading-snug transition-all duration-500 ${ask ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`} style={{ background: '#ecebe8', color: '#111' }}>build a churn dashboard for monday's review?</div>
        <div className="grid grid-cols-[1fr_76px] gap-3">
          <div data-p="slot" className="rounded-xl min-h-[118px] p-2 flex justify-end" style={{ border: `1px dashed rgba(255,255,255,0.14)` }}>
            {chartIn ? (
              <div className="relative rounded-lg p-3 transition-[width] duration-100" style={{ width: `${58 + wide * 42}%`, background: '#1c1c1c', border: `1px solid ${C.line}` }}>
                <p className="text-[12px] mb-2" style={{ color: C.text }}>Churn rate by plan</p>
                {demo.byPlan.map(g => (
                  <div key={g.plan} className="flex items-center gap-2 text-[11.5px] mb-1.5" style={{ color: C.mute }}>
                    <span className="w-12 shrink-0">{g.plan}</span>
                    <span className="h-2.5 rounded-sm transition-[width] duration-700 ease-out" style={{ width: bars ? `${(g.rate / maxRate) * 62}%` : '0%', background: AGENTS.dashboard_designer.color }} />
                    <span className="tabular-nums" style={{ color: C.text }}>{pct(g.rate)}</span>
                  </div>
                ))}
                <span data-p="corner" className="absolute left-0 bottom-0 w-5 h-5" aria-hidden="true">
                  <svg viewBox="0 0 20 20" className="w-full h-full"><path d="M3 3 C3 11 7 17 16 17" fill="none" stroke="#6b6b6b" strokeWidth="3" strokeLinecap="round" /></svg>
                </span>
              </div>
            ) : <p className="m-auto text-[12px]" style={{ color: C.dim }}>Dashboard</p>}
          </div>
          <div data-p="tray" className="rounded-xl flex flex-col items-center justify-center gap-1 transition-opacity" style={{ background: '#1a1a1a', opacity: chartIn ? 0.35 : 1 }}>
            <span className="flex items-end gap-0.5 h-6">{[0.5, 0.9, 0.35].map((v, k) => <span key={k} className="w-2 rounded-sm" style={{ height: `${v * 100}%`, background: AGENTS.dashboard_designer.color }} />)}</span>
            <span className="text-[10px]" style={{ color: C.dim }}>Chart</span>
          </div>
        </div>
        <p className={`text-center text-[14px] transition-opacity duration-500 ${pinned ? 'opacity-100' : 'opacity-0'}`} style={{ color: C.mute }}>Pinned to <span style={{ color: C.text }}>Dashboard</span> · computed from 20 rows</p>
      </div>
      {drag && <div className="absolute z-10 pointer-events-none rounded-lg px-3 py-2 text-[11px] shadow-xl" style={{ left: drag.x - 34, top: drag.y - 16, background: '#1c1c1c', color: C.text, border: `1px solid ${C.line}`, transform: 'rotate(-2deg)' }}>Churn rate by plan</div>}
      {stage.cursors}
    </Shell>
  );
}

/** The Data Engineer fills each blank with its column's median; the Verifier ticks the results. */
export function CleanPanel({ demo, onExplore }: { demo: Demo; onExplore: () => void }) {
  const [ref, visible] = useInView<HTMLDivElement>(0.35);
  const stage = useStage(useMemo<AgentRole[]>(() => ['data_engineer', 'verifier'], []), ref);
  const SHOWN = 9;
  const blankCells = useMemo(() => {
    const c: Record<string, string> = {};
    demo.raw.slice(0, SHOWN).forEach((r, i) => { c[`${i}:tenure`] = r.tenure == null ? '' : String(r.tenure); c[`${i}:charges`] = r.charges == null ? '' : String(r.charges); });
    return c;
  }, [demo]);
  const finished = useMemo(() => { const c = { ...blankCells }; demo.fills.forEach(f => { c[`${f.row}:${f.col}`] = String(f.value); }); return c; }, [blankCells, demo]);
  const [cells, setCells] = useState(still() ? finished : blankCells);
  const [flash, setFlash] = useState<string[]>(still() ? demo.fills.map(f => `${f.row}:${f.col}`) : []);
  const [checks, setChecks] = useState(still() ? demo.fills.length + 1 : 0);
  useLoop(visible, async w => {
    setCells(blankCells); setFlash([]); setChecks(0);
    stage.begin();
    await w(700);
    for (const f of demo.fills) {
      const key = `${f.row}:${f.col}`;
      stage.say(0, `Filling ${f.col} with the median`);
      await stage.go(0, stage.at(`[data-cell="${key}"]`, 0.3, 0.6));
      await stage.press(0);
      const text = String(f.value);
      for (let k = 1; k <= text.length; k++) { setCells(c => ({ ...c, [key]: text.slice(0, k) })); await w(130); }
      setFlash(x => [...x, key]);
      await w(380);
    }
    stage.say(0, 'No blanks left');
    await w(500);
    void stage.leave(0);
    for (let k = 0; k <= demo.fills.length; k++) {
      stage.say(1, k < demo.fills.length ? 'Checking the fill' : 'Recounting blanks');
      await stage.go(1, stage.at(`[data-check="${k}"]`, 0.06));
      await stage.press(1);
      setChecks(k + 1);
      await w(320);
    }
    stage.say(1, 'All checked');
    await w(800);
    await stage.leave(1);
    await w(2600);
  }, () => stage.end());
  const checkText = [...demo.fills.map(f => `${f.col}, row ${f.row + 1}: ${f.value}`), 'Blanks left: 0'];
  return (
    <Shell h={480} label="Clean" onExplore={onExplore} inner={ref}>
      <div className="absolute inset-2 bottom-2 rounded-[18px] overflow-hidden grid grid-cols-[1.6fr_1fr] gap-2">
        <div className="rounded-[16px] p-5 overflow-hidden" style={{ background: '#0e0e0e' }}>
          <p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim, fontFamily: MONO }}>customers.csv · 20 rows</p>
          <table className="mt-4 w-full text-[13px] tabular-nums" style={{ fontFamily: MONO }}>
            <thead><tr style={{ color: C.dim }}>{['id', 'plan', 'tenure', 'charges'].map(h => <th key={h} className="text-left font-normal pb-2">{h}</th>)}</tr></thead>
            <tbody>
              {demo.raw.slice(0, SHOWN).map((r, i) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="py-1.5" style={{ color: C.dim }}>{r.id}</td>
                  <td style={{ color: '#cfcfcf' }}>{r.plan}</td>
                  {(['tenure', 'charges'] as const).map(c => {
                    const key = `${i}:${c}`, v = cells[key], on = flash.includes(key);
                    return (
                      <td key={c} data-cell={key} className="transition-colors duration-500" style={{ background: on ? 'rgba(46,160,67,0.14)' : undefined }}>
                        {v === '' ? <span className="inline-block px-1.5 rounded text-[10.5px]" style={{ background: 'rgba(255,166,87,0.14)', color: '#ffa657' }}>blank</span>
                          : <span style={{ color: on ? C.green : '#cfcfcf' }}>{v}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-[16px] p-5 flex flex-col" style={{ background: '#0e0e0e' }}>
          <p className="text-[12px] uppercase tracking-[0.18em]" style={{ color: C.dim, fontFamily: MONO }}>Verified</p>
          <ul className="mt-3 space-y-3">
            {checkText.map((t, k) => (
              <li key={t} data-check={k} className="flex items-center gap-2 text-[13.5px] transition-colors duration-300" style={{ color: checks > k ? C.text : C.dim }}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors duration-300" style={{ background: checks > k ? AGENTS.verifier.color : '#262626', color: '#fff' }}>{checks > k && <Check className="w-3 h-3" strokeWidth={3} />}</span>
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-auto mb-14 text-[13px] leading-relaxed" style={{ color: C.mute }}>Each blank takes its column’s median, and every change is a version you can undo.</p>
        </div>
      </div>
      {stage.cursors}
    </Shell>
  );
}

/**
 * The agents' live board (formerly the welcome): five specialists work on the
 * 20-row sample, in order, and the Orchestrator watches. The Data Engineer
 * types each median into its blank; the Statistician drags across two columns
 * and the correlation appears; the ML Engineer presses Train and the one-rule
 * model is scored on the 6 rows it never saw; the Dashboard Designer drags a
 * chart into the dashboard and widens it by its curved corner; the Verifier
 * recomputes and ticks each result. Every number is computed from the rows.
 */
const BOARD_CAST: AgentRole[] = ['data_engineer', 'statistician', 'ml_engineer', 'dashboard_designer', 'verifier', 'orchestrator'];
export function BoardPanel({ demo }: { demo: Demo }) {
  const [ref, visible] = useInView<HTMLDivElement>(0.3);
  const stage = useStage(useMemo(() => BOARD_CAST, []), ref);
  const ROWS = 8;
  const blank = useMemo(() => {
    const c: Record<string, string> = {};
    demo.raw.slice(0, ROWS).forEach((x, i) => { c[`${i}:tenure`] = x.tenure == null ? '' : String(x.tenure); c[`${i}:charges`] = x.charges == null ? '' : String(x.charges); });
    return c;
  }, [demo]);
  const done = useMemo(() => { const c = { ...blank }; demo.fills.forEach(f => { c[`${f.row}:${f.col}`] = String(f.value); }); return c; }, [blank, demo]);
  type B = { cells: Record<string, string>; flash: string[]; sel: string[]; r: string | null; train: number | null; model: string | null; chartIn: boolean; wide: number; drag: Point | null; checks: number };
  const finished: B = { cells: done, flash: [], sel: [], r: demo.r.toFixed(2), train: null, model: pct(demo.model.accuracy), chartIn: true, wide: 1, drag: null, checks: 3 };
  const empty: B = { cells: blank, flash: [], sel: [], r: null, train: null, model: null, chartIn: false, wide: 0, drag: null, checks: 0 };
  const [b, setB] = useState<B>(still() ? finished : empty);
  const patch = (p: Partial<B> | ((x: B) => Partial<B>)) => setB(x => ({ ...x, ...(typeof p === 'function' ? p(x) : p) }));
  const maxRate = Math.max(...demo.byPlan.map(g => g.rate), 0.01);
  const color = (r: AgentRole) => AGENTS[r].color;

  useLoop(visible, async w => {
    setB(empty);
    stage.begin();
    await w(600);
    // 1. Data Engineer: each blank gets its column's median, typed in.
    for (const f of demo.fills) {
      const key = `${f.row}:${f.col}`;
      stage.say(0, `Filling a blank ${f.col} with the median`);
      await stage.go(0, stage.at(`[data-b="cell-${key}"]`, 0.3, 0.6)); await stage.press(0);
      const text = String(f.value);
      for (let k = 1; k <= text.length; k++) { patch(x => ({ cells: { ...x.cells, [key]: text.slice(0, k) } })); await w(120); }
      patch(x => ({ flash: [...x.flash, key] }));
      await w(280);
    }
    stage.say(0, 'No blanks left'); await w(400); void stage.leave(0);
    // 2. Statistician: drag across tenure and charges; the correlation of all 20 rows appears.
    stage.say(1, 'Selecting tenure and charges');
    await stage.go(1, stage.at('[data-b="head-tenure"]')); await stage.press(1);
    patch({ sel: ['tenure'] });
    await stage.go(1, stage.at('[data-b="head-charges"]'), { duration: 420, arc: 0.05, overshoot: false });
    patch({ sel: ['tenure', 'charges'] }); await w(240);
    patch({ r: demo.r.toFixed(2) }); stage.say(1, `Correlation r = ${demo.r.toFixed(2)}`);
    await stage.go(1, stage.at('[data-b="r"]', 0.2)); await w(500);
    patch({ sel: [] }); void stage.leave(1);
    // 3. ML Engineer: train on 14 rows, score on the other 6.
    stage.say(2, 'Training on 14 rows');
    await stage.go(2, stage.at('[data-b="train"]')); await stage.press(2);
    for (let k = 0; k <= 10; k++) { patch({ train: k / 10 }); await w(110); }
    patch({ train: null, model: pct(demo.model.accuracy) });
    stage.say(2, `${pct(demo.model.accuracy)} right on 6 rows it never saw`); await w(900); void stage.leave(2);
    // 4. Dashboard Designer: drag the chart in, then widen it by its curved corner.
    stage.say(3, 'Adding a chart to the dashboard');
    const tray = stage.at('[data-b="tray"]');
    await stage.go(3, tray); await stage.press(3);
    const slot = stage.at('[data-b="slot"]', 0.72, 0.5);
    for (let k = 1; k <= 14; k++) { const pt = { x: tray.x + ((slot.x - tray.x) * k) / 14, y: tray.y + ((slot.y - tray.y) * k) / 14 }; patch({ drag: pt }); stage.jump(3, pt); await w(26); }
    patch({ drag: null, chartIn: true }); await w(300);
    stage.say(3, 'Making it wider');
    const corner = stage.at('[data-b="corner"]', 0.4, 0.6);
    await stage.go(3, corner); await stage.press(3);
    const left = stage.at('[data-b="slot"]', 0, 0.5), right = stage.at('[data-b="slot"]', 1, 0.5);
    for (let k = 1; k <= 12; k++) { patch({ wide: k / 12 }); stage.jump(3, { x: corner.x - (k / 12) * (right.x - left.x) * 0.38, y: corner.y + k * 1.5 }); await w(30); }
    await w(300); void stage.leave(3);
    // 5. Verifier: recompute and tick each result; the Orchestrator signs off.
    for (let k = 0; k < 3; k++) {
      stage.say(4, ['Checking the blanks', 'Recomputing r', 'Rescoring the model'][k]);
      await stage.go(4, stage.at(`[data-b="check-${k}"]`, 0.05)); await stage.press(4);
      patch({ checks: k + 1 }); await w(300);
    }
    stage.say(4, 'All checked'); await w(500); void stage.leave(4);
    stage.say(5, 'Done: every number recomputed');
    await stage.go(5, stage.at('[data-b="checks"]', 0.6, 0.5)); await w(1400);
    await stage.leave(5);
    await w(2200);
  }, () => stage.end());

  return (
    <div ref={ref} data-stream className="relative overflow-hidden rounded-[24px] lp-glass lp-panel p-4 sm:p-5 space-y-4" style={{ background: 'rgba(20,20,20,0.86)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[14px] font-semibold" style={{ color: C.text, fontFamily: MONO }}>customers.csv <span className="font-normal" style={{ color: C.dim }}>· 20 rows</span></p>
        <p className="text-[11px]" style={{ color: C.dim }}>Live · every number is computed</p>
      </div>
      <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full text-[12.5px] tabular-nums" style={{ fontFamily: MONO }}>
          <thead style={{ background: 'rgba(255,255,255,0.04)' }}>
            <tr>{(['id', 'plan', 'tenure', 'charges', 'churned'] as const).map(c => (
              <th key={c} data-b={`head-${c}`} className="px-2.5 py-1.5 text-left font-normal transition-colors" style={{ color: b.sel.includes(c) ? C.text : C.dim, background: b.sel.includes(c) ? `color-mix(in srgb, ${color('statistician')} 35%, transparent)` : undefined }}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {demo.raw.slice(0, ROWS).map((x, i) => (
              <tr key={x.id} style={{ borderTop: `1px solid ${C.line}` }}>
                <td className="px-2.5 py-1" style={{ color: C.dim }}>{x.id}</td>
                <td className="px-2.5 py-1" style={{ color: '#cfcfcf' }}>{x.plan}</td>
                {(['tenure', 'charges'] as const).map(c => {
                  const key = `${i}:${c}`, v = b.cells[key], on = b.flash.includes(key);
                  return (
                    <td key={c} data-b={`cell-${key}`} className="px-2.5 py-1 transition-colors duration-500"
                      style={{ background: b.sel.includes(c) ? `color-mix(in srgb, ${color('statistician')} 16%, transparent)` : on ? 'rgba(46,160,67,0.16)' : undefined }}>
                      {v === '' ? <span className="inline-block px-1.5 rounded text-[10.5px]" style={{ background: 'rgba(255,166,87,0.14)', color: '#ffa657' }}>blank</span>
                        : <span style={{ color: on ? C.green : '#cfcfcf', fontWeight: on ? 600 : 400 }}>{v}</span>}
                    </td>
                  );
                })}
                <td className="px-2.5 py-1" style={{ color: x.churned === 'Yes' ? '#ffa657' : C.mute }}>{x.churned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div data-b="r" className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <p className="text-[11px] uppercase tracking-wide" style={{ color: C.dim }}>Tenure × charges</p>
          <p className="text-[17px] font-numeral" style={{ color: C.text }}>{b.r ? `r = ${b.r}` : '—'}</p>
        </div>
        <div className="rounded-xl px-3 py-2.5 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <span data-b="train" className="px-3 py-1.5 rounded-full text-[13px] font-medium bg-white text-black">Train</span>
          <div className="min-w-0 flex-1">
            {b.train != null ? (
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}><div className="h-full rounded-full" style={{ width: pct(b.train), background: color('ml_engineer'), transition: 'width 110ms linear' }} /></div>
            ) : b.model ? (
              <p className="text-[12.5px] leading-snug" style={{ color: C.text }}><b className="font-numeral">{b.model}</b> right on {demo.model.testRows} new rows <span style={{ color: C.dim }}>· {demo.model.rule}</span></p>
            ) : <p className="text-[12.5px]" style={{ color: C.dim }}>A model of churn</p>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3 items-stretch">
        <div data-b="slot" className="rounded-xl min-h-[96px] p-2 flex justify-end" style={{ border: '1px dashed rgba(255,255,255,0.16)' }}>
          {b.chartIn ? (
            <div className="relative rounded-lg p-2.5 transition-[width] duration-150" style={{ width: `${56 + b.wide * 44}%`, background: '#1c1c1c', border: `1px solid ${C.line}` }}>
              <p className="text-[11.5px] font-semibold mb-1.5" style={{ color: C.text }}>Churn rate by plan</p>
              {demo.byPlan.map(g => (
                <div key={g.plan} className="flex items-center gap-2 text-[11px] mb-1" style={{ color: C.mute }}>
                  <span className="w-12 shrink-0">{g.plan}</span>
                  <span className="h-2.5 rounded-sm" style={{ width: `${(g.rate / maxRate) * 70}%`, background: color('dashboard_designer') }} />
                  <span className="tabular-nums" style={{ color: C.text }}>{pct(g.rate)}</span>
                </div>
              ))}
              <span data-b="corner" className="absolute left-0 bottom-0 w-5 h-5" aria-hidden="true">
                <svg viewBox="0 0 20 20" className="w-full h-full"><path d="M3 3 C3 11 7 17 16 17" fill="none" stroke="#6b6b6b" strokeWidth="3" strokeLinecap="round" /></svg>
              </span>
            </div>
          ) : <p className="m-auto text-[11px]" style={{ color: C.dim }}>Dashboard</p>}
        </div>
        <div data-b="tray" className="w-24 rounded-xl flex flex-col items-center justify-center gap-1 p-2 transition-opacity" style={{ background: 'rgba(255,255,255,0.04)', opacity: b.chartIn ? 0.35 : 1 }}>
          <span className="flex items-end gap-0.5 h-6">{[0.5, 0.9, 0.35].map((v, k) => <span key={k} className="w-2 rounded-sm" style={{ height: `${v * 100}%`, background: color('dashboard_designer') }} />)}</span>
          <span className="text-[10px]" style={{ color: C.dim }}>Chart</span>
        </div>
      </div>
      <ul data-b="checks" className="space-y-1.5">
        {[`Blanks filled with medians (${demo.fills.map(f => f.value).join(', ')}): none left`, `Correlation recomputed from all 20 rows: ${demo.r.toFixed(2)}`, `Model rescored on the 6 held-out rows: ${pct(demo.model.accuracy)}`].map((t, k) => (
          <li key={k} data-b={`check-${k}`} className="flex items-center gap-2 text-[12.5px] transition-colors" style={{ color: b.checks > k ? C.text : C.dim }}>
            <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors" style={{ background: b.checks > k ? color('verifier') : '#262626', color: '#fff' }}>{b.checks > k && <Check className="w-3 h-3" strokeWidth={3} />}</span>
            {t}
          </li>
        ))}
      </ul>
      {b.drag && <div className="absolute z-10 pointer-events-none rounded-lg px-3 py-2 text-[11px] font-semibold shadow-xl" style={{ left: b.drag.x - 30, top: b.drag.y - 16, background: '#1c1c1c', color: C.text, border: `1px solid ${C.line}`, transform: 'rotate(-2deg)' }}>Churn rate by plan</div>}
      {stage.cursors}
    </div>
  );
}
