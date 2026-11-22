/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

// The front page's 3D data field (three.js). Thousands of points behave like a
// liquid held by springs: each is pulled towards its place in the current
// shape, keeps its momentum, sloshes when you scroll fast and scatters from the
// pointer. Scrolling morphs the shape, section by section:
//   0  a globe of data (the hero)
//   1  a scatter plot with its trend line, sloping as the sample's r does
//   2  a ring of agent clusters, one per specialist, in their colours
//   3  seven bars, one per step of the studio
//   4  the globe again, wide and slow (the footer)
// Points move one after another (each has its own delay), so a morph pours
// rather than snaps.

export interface DataField {
  /** Shape position: 0–4, fractional between shapes. */
  setProgress(p: number): void;
  /** Scroll speed in px/s (signed): the field sloshes with it. */
  setVelocity(v: number): void;
  /** Pointer in normalised device coordinates (−1…1), or null when it leaves. */
  setPointer(x: number | null, y: number | null): void;
  resize(): void;
  dispose(): void;
}

const SHAPES = 5;

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** A soft round dot, drawn once, used for every point. */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createDataField(canvas: HTMLCanvasElement, opts: { count: number; r: number; agentColors: string[]; still: boolean }): DataField {
  const { count: N, r, agentColors, still } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 7.5);

  const rand = rng(11);
  const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rand(); return u / 3 - 1; };

  // ---- The shapes (targets), one Float32Array of xyz per shape. ----
  const targets = Array.from({ length: SHAPES }, () => new Float32Array(N * 3));
  const cluster = new Uint16Array(N);
  const agents = Math.max(1, agentColors.length);
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    // 0 · globe: a shell with some depth.
    {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, rad = 2.05 + gauss() * 0.06 + (rand() < 0.12 ? -rand() * 0.9 : 0);
      const s = Math.sqrt(1 - u * u);
      targets[0].set([rad * s * Math.cos(th), rad * u, rad * s * Math.sin(th)], o);
      targets[4].set([rad * 1.7 * s * Math.cos(th), rad * 1.05 * u, rad * 1.7 * s * Math.sin(th)], o);
    }
    // 1 · scatter: most points on y = r·x with noise; some trace the axes.
    {
      if (i % 9 === 0) {
        const t = rand() * 3.6 - 1.8;
        targets[1].set(i % 2 ? [t, -1.55, 0] : [-1.9, t * 0.86, 0], o);
      } else {
        const x = gauss() * 1.05, y = r * x + gauss() * 0.42 * Math.sqrt(Math.max(0.05, 1 - r * r));
        targets[1].set([x * 1.15, y * 1.15, gauss() * 0.35], o);
      }
    }
    // 3 · seven bars, rising left to right.
    {
      const b = i % 7, h = 0.55 + b * 0.42, w = 0.36;
      targets[3].set([-2.4 + b * 0.8 + (rand() - 0.5) * w, -1.6 + rand() * h, (rand() - 0.5) * w], o);
    }
    // 2 · a ring of agent clusters.
    {
      const a = i % agents;
      cluster[i] = a;
      const ang = (a / agents) * Math.PI * 2;
      const R = 2.25, spread = 0.2;
      targets[2].set([Math.cos(ang) * R + gauss() * spread, Math.sin(ang) * R * 0.62 + gauss() * spread, Math.sin(ang) * 0.9 + gauss() * spread], o);
    }
  }

  // ---- Colours: mostly white, some in agent colours; the ring is fully coloured. ----
  const white = new THREE.Color('#e9e9ee');
  // Agent colours are muted for the studio; lift them a little to glow on black.
  const palette = agentColors.map(c => new THREE.Color(c).lerp(white, 0.3));
  const base = new Float32Array(N * 3), ringCol = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const tint = rand() < 0.16 && palette.length ? palette[i % palette.length] : white;
    const dim = 0.55 + rand() * 0.45;
    base.set([tint.r * dim, tint.g * dim, tint.b * dim], i * 3);
    const pc = palette.length ? palette[cluster[i] % palette.length] : white;
    ringCol.set([pc.r, pc.g, pc.b], i * 3);
  }

  const pos = new Float32Array(targets[0]);
  const vel = new Float32Array(N * 3);
  const col = new Float32Array(base);
  const delay = new Float32Array(N);
  for (let i = 0; i < N; i++) delay[i] = rand() * 0.45;

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  const tex = dotTexture();
  const mat = new THREE.PointsMaterial({ size: 0.05, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.95 });
  const points = new THREE.Points(geo, mat);
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // ---- State. ----
  let progress = 0, shown = 0, velocity = 0, slosh = 0;
  let px: number | null = null, py: number | null = null, tiltX = 0, tiltY = 0;
  const pointerWorld = new THREE.Vector3(9, 9, 0);
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const inv = new THREE.Matrix4();
  const local = new THREE.Vector3();
  let raf = 0, last = performance.now(), t = 0;

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the field a similar size on narrow screens.
    camera.position.z = w / h < 0.8 ? 10.5 : 7.5;
    camera.updateProjectionMatrix();
  };
  resize();

  const smooth = (x: number) => x * x * (3 - 2 * x);

  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    shown += (progress - shown) * Math.min(1, dt * 3.2);
    slosh += (velocity / 1400 - slosh) * Math.min(1, dt * 6);
    velocity *= Math.pow(0.02, dt);

    // Pointer on the field's plane, in the field's own space.
    if (px != null && py != null) {
      ndc.set(px, py);
      ray.setFromCamera(ndc, camera);
      ray.ray.intersectPlane(plane, pointerWorld);
      inv.copy(group.matrixWorld).invert();
      local.copy(pointerWorld).applyMatrix4(inv);
    } else local.set(99, 99, 99);

    const k = 26, damp = 6.2;
    const ringMix = Math.max(0, 1 - Math.abs(shown - 2));
    for (let i = 0; i < N; i++) {
      // Each point is a little behind or ahead in the morph.
      const p = Math.min(SHAPES - 1, Math.max(0, shown * 1.0 + (delay[i] - 0.22) * Math.min(1, Math.abs(progress - shown) * 2.5 + 0.0)));
      const a = Math.floor(p), b = Math.min(SHAPES - 1, a + 1), f = smooth(p - a);
      const o = i * 3;
      const ta = targets[a], tb = targets[b];
      let tx = ta[o] + (tb[o] - ta[o]) * f;
      let ty = ta[o + 1] + (tb[o + 1] - ta[o + 1]) * f;
      const tz = ta[o + 2] + (tb[o + 2] - ta[o + 2]) * f;
      // Slosh: a wave across the field, driven by scroll speed.
      ty += Math.sin(tx * 1.6 + t * 3) * slosh * 0.55;
      tx += Math.cos(ty * 1.3 + t * 2.4) * slosh * 0.25;

      let ax = (tx - pos[o]) * k - vel[o] * damp;
      let ay = (ty - pos[o + 1]) * k - vel[o + 1] * damp;
      const az = (tz - pos[o + 2]) * k - vel[o + 2] * damp;
      // The pointer pushes points away, like a finger in water.
      const dx = pos[o] - local.x, dy = pos[o + 1] - local.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 0.9) { const push = (0.9 - d2) * 70; const d = Math.sqrt(d2) + 1e-3; ax += (dx / d) * push; ay += (dy / d) * push; }
      vel[o] += ax * dt; vel[o + 1] += ay * dt; vel[o + 2] += az * dt;
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;

      if (ringMix > 0.001 || col[o] !== base[o]) {
        col[o] = base[o] + (ringCol[o] - base[o]) * ringMix;
        col[o + 1] = base[o + 1] + (ringCol[o + 1] - base[o + 1]) * ringMix;
        col[o + 2] = base[o + 2] + (ringCol[o + 2] - base[o + 2]) * ringMix;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // The field turns slowly, faster while you scroll, and leans towards the pointer.
    tiltX += (((py ?? 0) * 0.25) - tiltX) * Math.min(1, dt * 2);
    tiltY += (((px ?? 0) * 0.35) - tiltY) * Math.min(1, dt * 2);
    const flat = Math.max(0, 1 - Math.abs(shown - 1)) + Math.max(0, 1 - Math.abs(shown - 3));
    group.rotation.y += dt * (0.12 + Math.abs(slosh) * 0.9) * (1 - Math.min(1, flat) * 0.85);
    if (flat > 0.5) group.rotation.y += (Math.round(group.rotation.y / (Math.PI * 2)) * Math.PI * 2 - group.rotation.y) * Math.min(1, dt * 2.5);
    group.rotation.x = tiltX + slosh * 0.12;
    group.position.x = tiltY * 0.4;
    mat.size = 0.05 + Math.abs(slosh) * 0.02;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  };

  if (still) renderer.render(scene, camera);
  else raf = requestAnimationFrame(step);

  return {
    setProgress(p) { progress = Math.max(0, Math.min(SHAPES - 1, p)); if (still) { shown = progress; } },
    setVelocity(v) { velocity = Math.max(-6000, Math.min(6000, v)); },
    setPointer(x, y) { px = x; py = y; },
    resize() { resize(); if (still) renderer.render(scene, camera); },
    dispose() { cancelAnimationFrame(raf); geo.dispose(); mat.dispose(); tex.dispose(); renderer.dispose(); },
  };
}
