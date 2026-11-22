/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { HumanMover, Point } from '../swarm/humanMotion';
import type { DataField } from './landingScene';
import type { GpuField } from './landingGpu';

// The front page's scroll choreography (GSAP + ScrollTrigger), on the page's
// own scroller. Markup opts in with data attributes:
//   data-scene="n"     the 3D field morphs to shape n as this section arrives
//   data-split         its .lp-char letters fly apart as the hero scrolls away
//   data-hero-fade     drifts up and fades with the hero
//   data-tilt          tips up from the floor in 3D as it enters
//   data-skew          leans with scroll speed
//   data-marquee="±1"  a row of words that runs, faster as you scroll, and turns with you
//   data-bignum        scales down from huge into place
//   data-burst         flies in from a scattered position and spin
//   data-flip          swings in like a door
//   data-hscroll       pinned; its [data-track] scrolls sideways (wide screens)
//   data-from="left|right"  slides in from that side
//   data-wordmark      its letters rise one by one
//   data-reveal        rises into place (batched)
// The agents' page cursors ([data-page-cursor]) visit sections as they arrive:
//   data-cursor-scene="hero|dev|engine|platform|numbers|steps"

gsap.registerPlugin(ScrollTrigger);

type Cursor = { el: HTMLElement; mover: HumanMover; say: HTMLElement | null; role: string; pin: { el: Element; fx: number; fy: number } | null; token: number };

export function initLandingMotion(root: HTMLElement, field: DataField | null, opts: { cursors: boolean; gpu?: GpuField | null }) {
  const ctx = gsap.context(() => undefined, root);
  const q = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const rnd = gsap.utils.random;
  const triggers: ScrollTrigger[] = [];
  const st = (vars: ScrollTrigger.Vars) => { const t = ScrollTrigger.create({ scroller: root, ...vars }); triggers.push(t); return t; };
  let alive = true;

  ctx.add(() => {
    ScrollTrigger.defaults({ scroller: root });

    // ---- Scroll speed: the 3D field sloshes, marked elements lean. ----
    const skews = q('[data-skew]');
    const skewTo = skews.map(el => gsap.quickTo(el, 'skewY', { duration: 0.5, ease: 'power3.out' }));
    const clamp = gsap.utils.clamp(-7, 7);
    let speed = 0;
    st({
      start: 0, end: 'max',
      onUpdate: self => {
        const v = self.getVelocity();
        speed = v;
        field?.setVelocity(v);
        const sk = clamp(v / -320);
        skewTo.forEach(fn => fn(sk));
        repin();
      },
    });

    // ---- The 3D field follows the sections. ----
    if (field) {
      const scenes = q('[data-scene]');
      let prev = 0;
      scenes.forEach(el => {
        const n = Number(el.dataset.scene), from = prev;
        prev = n;
        if (n === from) return;
        st({ trigger: el, start: 'top 85%', end: 'top 20%', scrub: true, onUpdate: s => field.setProgress(from + (n - from) * s.progress) });
      });
    }

    // ---- Hero: the headline's letters fly apart as it scrolls away. ----
    const hero = root.querySelector('[data-hero]');
    if (hero) {
      const chars = q('[data-split] .lp-char');
      const mid = chars.length / 2;
      const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom 15%', scrub: 0.6 } });
      tl.to(chars, {
        y: () => rnd(-320, 260), x: (i: number) => (i - mid) * rnd(8, 26), rotation: () => rnd(-110, 110), scale: () => rnd(0.4, 1.8),
        opacity: 0, filter: 'blur(10px)', ease: 'power2.in', stagger: { each: 0.012, from: 'center' },
      }, 0);
      tl.to(q('[data-hero-fade]'), { y: -140, opacity: 0, ease: 'none', stagger: 0.05 }, 0);
    }

    // ---- Panels tip up from the floor. ----
    q('[data-tilt]').forEach((el, i) => {
      gsap.fromTo(el, { rotateX: 38, y: 180, z: -260, scale: 0.86, opacity: 0.15, transformOrigin: '50% 100%' }, {
        rotateX: 0, y: 0, z: 0, scale: 1, opacity: 1, ease: 'none',
        scrollTrigger: { trigger: el, start: `top ${105 + (i % 3) * 4}%`, end: 'top 58%', scrub: 0.8 },
      });
    });

    // ---- Marquee rows: run, speed up with scrolling, turn with its direction. ----
    q('[data-marquee]').forEach(row => {
      const dir0 = Number(row.dataset.marquee) || 1;
      const track = row.firstElementChild as HTMLElement | null;
      if (!track) return;
      let x = 0, dir = dir0;
      const tick = (_t: number, dtMs: number) => {
        if (speed) dir = (speed > 0 ? 1 : -1) * dir0;
        const half = track.scrollWidth / 2 || 1;
        x -= (dtMs / 1000) * (60 + Math.min(1600, Math.abs(speed) * 0.45)) * dir;
        x = ((x % half) + half) % half - half;
        gsap.set(track, { x });
      };
      gsap.ticker.add(tick);
      ctx.add(() => () => gsap.ticker.remove(tick));
    });

    // ---- Panels and the 3D field, as one: a panel lights up as its particle
    // stream arrives, tilts towards the pointer and catches its light; a panel
    // arriving fast sends a small shockwave through the field. ----
    q('[data-stream]').forEach(el => {
      st({ trigger: el, start: 'top 82%', end: 'bottom 18%', toggleClass: { targets: el, className: 'is-charged' },
        onEnter: self => { if (opts.gpu && Math.abs(self.getVelocity()) > 1400) { const r = el.getBoundingClientRect(); opts.gpu.shock(((r.left + r.width / 2) / window.innerWidth) * 2 - 1, -(((r.top + r.height / 2) / window.innerHeight) * 2 - 1), 0.6); } } });
      const panel = (el.firstElementChild as HTMLElement | null) ?? el;
      const rx = gsap.quickTo(panel, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      const ry = gsap.quickTo(panel, 'rotationY', { duration: 0.6, ease: 'power3.out' });
      gsap.set(panel, { transformPerspective: 1000 });
      const move = (e: PointerEvent) => {
        const r = panel.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
        rx((0.5 - fy) * 9); ry((fx - 0.5) * 11);
        panel.style.setProperty('--mx', `${fx * 100}%`); panel.style.setProperty('--my', `${fy * 100}%`);
      };
      const out = () => { rx(0); ry(0); };
      panel.addEventListener('pointermove', move);
      panel.addEventListener('pointerleave', out);
      ctx.add(() => () => { panel.removeEventListener('pointermove', move); panel.removeEventListener('pointerleave', out); });
    });

    // ---- Big numbers come down from huge. ----
    q('[data-bignum]').forEach(el => {
      gsap.fromTo(el, { scale: 2.6, yPercent: 60, opacity: 0, filter: 'blur(12px)', transformOrigin: '0% 100%' }, {
        scale: 1, yPercent: 0, opacity: 1, filter: 'blur(0px)', ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 98%', end: 'top 55%', scrub: 0.7 },
      });
    });

    // ---- Tiles burst in from scattered places. ----
    q('[data-burst]').forEach(el => {
      gsap.fromTo(el, { x: () => rnd(-380, 380), y: () => rnd(120, 420), rotation: () => rnd(-45, 45), scale: 0.55, opacity: 0 }, {
        x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 108%', end: 'top 62%', scrub: 0.9 },
      });
    });

    // ---- Cards swing in like doors. ----
    q('[data-flip]').forEach((el, i) => {
      gsap.fromTo(el, { rotateY: -75, x: -120, opacity: 0, transformOrigin: '0% 50%' }, {
        rotateY: 0, x: 0, opacity: 1, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: `top ${100 + i * 2}%`, end: 'top 60%', scrub: 0.8 },
      });
    });

    q('[data-from]').forEach(el => {
      const left = el.dataset.from === 'left';
      gsap.fromTo(el, { x: left ? -260 : 260, rotation: left ? -6 : 6, opacity: 0 }, {
        x: 0, rotation: 0, opacity: 1, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 100%', end: 'top 60%', scrub: 0.8 },
      });
    });

    // ---- The footer wordmark rises letter by letter. ----
    q('[data-wordmark]').forEach(el => {
      gsap.fromTo(el.querySelectorAll('.lp-char'), { yPercent: 115, rotation: 8, opacity: 0 }, {
        yPercent: 0, rotation: 0, opacity: 1, ease: 'power3.out', stagger: 0.04,
        scrollTrigger: { trigger: el, start: 'top 100%', end: 'top 55%', scrub: 0.8 },
      });
    });

    // ---- Everything else rises into place as it arrives. ----
    gsap.set(q('[data-reveal]'), { y: 70, opacity: 0 });
    ScrollTrigger.batch(q('[data-reveal]'), {
      scroller: root, start: 'top 92%',
      onEnter: batch => gsap.to(batch, { y: 0, opacity: 1, duration: 1.1, ease: 'power3.out', stagger: 0.09, overwrite: true }),
    });

    // ---- Wide screens: the steps scroll sideways while the section is pinned. ----
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px)', () => {
      q('[data-hscroll]').forEach(sec => {
        const track = sec.querySelector<HTMLElement>('[data-track]');
        if (!track) return;
        const dist = () => Math.max(0, track.scrollWidth - sec.clientWidth + 48);
        gsap.to(track, {
          x: () => -dist(), ease: 'none',
          scrollTrigger: { trigger: sec, start: 'top 10%', end: () => `+=${dist() + 200}`, scrub: 0.8, pin: true, pinSpacing: true, invalidateOnRefresh: true, anticipatePin: 1 },
        });
        // Each card leans as it passes.
        gsap.utils.toArray<HTMLElement>(track.children).forEach((card, i) => {
          gsap.fromTo(card, { rotateY: -24, z: -120 }, { rotateY: 8, z: 0, ease: 'none', scrollTrigger: { trigger: sec, start: 'top 10%', end: () => `+=${dist() + 200}`, scrub: true }, delay: i * 0.02 });
        });
      });
    });
    ctx.add(() => () => mm.revert());
  });

  // ---- The agents' page cursors. ----
  const cursors: Cursor[] = opts.cursors ? q('[data-page-cursor]').map((el, i) => ({
    el, role: el.dataset.pageCursor ?? '', say: el.querySelector<HTMLElement>('[data-say]'), pin: null, token: 0,
    mover: new HumanMover(el, { x: i % 2 ? window.innerWidth + 60 : -320, y: window.innerHeight * (0.3 + i * 0.15) }),
  })) : [];
  const byRole = (r: string) => cursors.find(c => c.role === r);
  const at = (el: Element, fx = 0.5, fy = 0.5): Point => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; };
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 60 && r.top < window.innerHeight - 30; };
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  function repin() {
    // A cursor that has arrived stays on its element while the page scrolls.
    for (const c of cursors) if (c.pin) c.mover.jump(at(c.pin.el, c.pin.fx, c.pin.fy));
  }
  const say = (c: Cursor, text: string) => { if (c.say) { c.say.textContent = text ? ` · ${text}` : ''; } };
  const press = async (c: Cursor) => { c.el.classList.add('is-pressing'); await wait(130); c.el.classList.remove('is-pressing'); };
  /** Moves a cursor to an element and stays with it while the page scrolls. */
  const visit = async (c: Cursor, el: Element | null, text: string, token: number, fx = 0.5, fy = 0.5) => {
    if (!el || !alive || c.token !== token) return false;
    c.pin = null;
    say(c, text);
    await c.mover.moveTo(at(el, fx, fy), { maxDuration: 750, follow: () => at(el, fx, fy) });
    if (!alive || c.token !== token) return false;
    c.pin = { el, fx, fy };
    return true;
  };
  const leave = (c: Cursor) => {
    c.token++; c.pin = null; say(c, '');
    const r = c.el.getBoundingClientRect();
    void c.mover.moveTo({ x: r.left < window.innerWidth / 2 ? -320 : window.innerWidth + 80, y: Math.max(40, Math.min(window.innerHeight - 40, r.top + rnd(-120, 120))) }, { maxDuration: 900, arc: 0.25 });
  };
  const run = (role: string, steps: (c: Cursor, token: number) => Promise<void>) => {
    const c = byRole(role);
    if (!c) return;
    const token = ++c.token;
    void steps(c, token).catch(() => undefined);
  };

  const scenes: Record<string, { roles: string[]; play: () => void }> = {
    hero: {
      roles: ['orchestrator', 'statistician'],
      play: () => {
        run('orchestrator', async (c, t) => { await wait(400); await visit(c, root.querySelector('[data-cur="typed"]'), 'Writing your goal', t, 0.5, 0.95); });
        run('statistician', async (c, t) => { await wait(1100); if (await visit(c, root.querySelector('[data-cur="try"]'), 'Start here', t, 0.7, 0.7)) await press(c); });
      },
    },
    dev: {
      roles: ['ml_engineer'],
      play: () => run('ml_engineer', async (c, t) => {
        if (!(await visit(c, root.querySelector('[data-cur="tab-TypeScript"]'), 'Switching to TypeScript', t))) return;
        await press(c); (root.querySelector('[data-cur="tab-TypeScript"]') as HTMLElement | null)?.click();
        await wait(1400);
        if (!(await visit(c, root.querySelector('[data-cur="copy"]'), 'Copying the call', t))) return;
        await press(c);
        await wait(1600);
        if (await visit(c, root.querySelector('[data-cur="tab-Python"]'), 'Back to Python', t)) { await press(c); (root.querySelector('[data-cur="tab-Python"]') as HTMLElement | null)?.click(); }
      }),
    },
    engine: {
      roles: ['statistician'],
      play: () => run('statistician', async (c, t) => {
        const tiles = q('[data-area]').filter(visible).slice(0, 4);
        for (const tile of tiles) {
          if (!(await visit(c, tile, `${tile.dataset.area} · ${tile.dataset.count} analyses`, t, 0.82, 0.22))) return;
          await press(c);
          tile.classList.add('is-picked');
          await wait(900);
          tile.classList.remove('is-picked');
        }
      }),
    },
    platform: {
      roles: ['orchestrator'],
      play: () => run('orchestrator', async (c, t) => {
        for (const card of q('[data-platform]').filter(visible)) {
          if (!(await visit(c, card, card.dataset.platform ?? '', t, 0.75, 0.2))) return;
          card.classList.add('is-picked');
          await wait(850);
          card.classList.remove('is-picked');
        }
      }),
    },
    numbers: {
      roles: ['verifier'],
      play: () => run('verifier', async (c, t) => {
        for (const n of q('[data-bignum]').filter(visible)) {
          if (!(await visit(c, n, `Recounted: ${n.textContent?.trim()}`, t, 0.9, 0.3))) return;
          await press(c);
          await wait(800);
        }
      }),
    },
    team: {
      roles: ['orchestrator'],
      play: () => run('orchestrator', async (c, t) => {
        const chips = q('[data-agent-chip]').filter(visible);
        for (const chip of [chips[0], chips[4], chips[9], chips[15]].filter(Boolean)) {
          if (!(await visit(c, chip, `Calling the ${chip.dataset.agentChip}`, t, 0.85, 0.5))) return;
          await press(c);
          chip.classList.add('is-picked');
          await wait(800);
          chip.classList.remove('is-picked');
        }
      }),
    },
    steps: {
      roles: ['data_engineer'],
      play: () => run('data_engineer', async (c, t) => {
        for (let k = 0; k < 4; k++) {
          const card = q('[data-step]').find(visible);
          const cards = q('[data-step]').filter(visible);
          const target = cards[Math.min(k, cards.length - 1)] ?? card;
          if (!target || !(await visit(c, target, `Step ${target.dataset.step}`, t, 0.8, 0.25))) return;
          await press(c);
          await wait(1100);
        }
      }),
    },
  };

  if (cursors.length) {
    q('[data-cursor-scene]').forEach(sec => {
      const sc = scenes[sec.dataset.cursorScene ?? ''];
      if (!sc) return;
      st({
        trigger: sec, start: 'top 55%', end: 'bottom 35%',
        onEnter: () => sc.play(), onEnterBack: () => sc.play(),
        onLeave: () => sc.roles.forEach(r => { const c = byRole(r); if (c) leave(c); }),
        onLeaveBack: () => sc.roles.forEach(r => { const c = byRole(r); if (c) leave(c); }),
      });
    });
    // The hero's agents arrive once the intro has finished.
    const heroWhenReady = () => {
      if (!alive) return;
      if (root.dataset.intro === 'done') { setTimeout(() => { if (alive && root.scrollTop < 200) scenes.hero.play(); }, 900); return; }
      const mo = new MutationObserver(() => { if (root.dataset.intro === 'done') { mo.disconnect(); heroWhenReady(); } });
      mo.observe(root, { attributes: true, attributeFilter: ['data-intro'] });
      ctx.add(() => () => mo.disconnect());
    };
    heroWhenReady();
  }

  const refresh = () => ScrollTrigger.refresh();
  const t = setTimeout(refresh, 400);

  return () => {
    alive = false;
    clearTimeout(t);
    cursors.forEach(c => { c.token++; c.mover.stop(); });
    triggers.forEach(tr => tr.kill());
    ctx.revert();
    ScrollTrigger.getAll().forEach(tr => { if (tr.scroller === root) tr.kill(); });
    ScrollTrigger.defaults({ scroller: window });
  };
}
