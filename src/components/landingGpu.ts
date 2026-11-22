/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DataField } from './landingScene';

// The front page's particle engine on the GPU (three.js GPGPU). Every particle's
// position and velocity live in float textures and are stepped in shaders:
//   · springs pull each particle to its place in the current shape, one after
//     another, so a morph pours rather than snaps;
//   · a curl-noise flow field stirs them like smoke or water;
//   · scrolling throws the whole field with inertia (it lags, then springs back)
//     and whips up turbulence;
//   · the pointer leaves a vortex wake; a click sends out a shockwave; holding
//     makes a black hole with an accretion swirl that explodes on release;
//   · panels on screen call streams of particles out of the field to trace
//     their borders and follow them as the page scrolls.
// The opening is the intro: everything collapses into one charged point, it
// detonates, the particles write "Data Science Studio", then burst into the
// data globe. Bloom makes the energy glow.
//
// Shapes (targets), in page order: 0 globe · 1 scatter (sloping with the
// sample's r) · 2 ring of agent clusters · 3 seven bars · 4 wide globe ·
// 5 the name in particles · 6 the singularity.

export interface GpuField extends DataField {
  /** A shockwave from a point on screen (normalised device coords), 0–3 strength. */
  shock(x: number, y: number, strength?: number): void;
  /** Holding the pointer down: a black hole at (x, y); release explodes with the held energy. */
  hold(on: boolean, x?: number, y?: number): void;
  /** Panels to trace with particle streams: returns their screen rectangles (or none). */
  setRects(get: (() => DOMRect[]) | null): void;
  /** Ends the intro at once. */
  skipIntro(): void;
  /** How bright the field is (1 full, lower behind text). */
  setDim(v: number): void;
}

const SHAPES = 7;
const MAX_SHOCKS = 4;
const MAX_RECTS = 3;

const NOISE = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 curl(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  float n1 = snoise(p + dy + vec3(31.4)), n2 = snoise(p - dy + vec3(31.4));
  float n3 = snoise(p + dz + vec3(-17.2)), n4 = snoise(p - dz + vec3(-17.2));
  float n5 = snoise(p + dz), n6 = snoise(p - dz);
  float n7 = snoise(p + dx + vec3(31.4)), n8 = snoise(p - dx + vec3(31.4));
  float n9 = snoise(p + dx + vec3(-17.2)), n10 = snoise(p - dx + vec3(-17.2));
  float n11 = snoise(p + dy), n12 = snoise(p - dy);
  return vec3((n1 - n2) - (n3 - n4), (n5 - n6) - (n9 - n10), (n11 - n12) - (n7 - n8)) / (2.0 * e);
}`;

const VELOCITY = /* glsl */ `
uniform float uTime, uDt, uMix, uSpring, uDamp, uTurb, uHold, uPointerOn, uStreamFrac;
uniform sampler2D uShapeA, uShapeB, uSeed;
uniform mat3 uRot;
uniform vec3 uPointer, uPointerVel, uScroll;
uniform vec4 uShock[${MAX_SHOCKS}];
uniform vec4 uRect[${MAX_RECTS}];
uniform float uRectOn[${MAX_RECTS}];
${NOISE}
vec3 onRect(vec4 r, float t){
  // A point on a rectangle's border, t in [0,1) around it.
  float w = r.z * 2.0, h = r.w * 2.0, per = 2.0 * (w + h), d = fract(t) * per;
  vec2 p;
  if (d < w) p = vec2(-r.z + d, r.w);
  else if (d < w + h) p = vec2(r.z, r.w - (d - w));
  else if (d < 2.0 * w + h) p = vec2(r.z - (d - w - h), -r.w);
  else p = vec2(-r.z, -r.w + (d - 2.0 * w - h));
  return vec3(r.xy + p, 0.35);
}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec4 S = texture2D(uSeed, uv);
  vec3 pos = P.xyz, vel = V.xyz;

  // The particle's place in the shape: each moves a little before or after the rest.
  float m = smoothstep(0.0, 1.0, clamp(uMix * 1.45 - S.x * 0.45, 0.0, 1.0));
  vec3 target = uRot * mix(texture2D(uShapeA, uv).xyz, texture2D(uShapeB, uv).xyz, m);

  // Panels on screen call streams out of the field to run around their borders.
  float spring = uSpring;
  for (int k = 0; k < ${MAX_RECTS}; k++) {
    float pick = step(S.w, uStreamFrac * uRectOn[k]) * step(float(k), S.z * ${MAX_RECTS}.0) * step(S.z * ${MAX_RECTS}.0, float(k) + 1.0);
    if (pick > 0.5) { target = onRect(uRect[k], S.y + uTime * (0.03 + S.x * 0.05)); spring = uSpring * 1.6; }
  }

  vec3 force = (target - pos) * spring - vel * uDamp;
  // Smoke-like flow, stronger with scroll speed and after explosions.
  force += curl(pos * 0.45 + vec3(0.0, 0.0, uTime * 0.12)) * uTurb * (0.6 + S.x);
  // Scrolling throws the field: it lags behind, then springs back like a liquid.
  force += uScroll * (0.55 + S.y * 0.9);

  // The pointer: a vortex wake around it, and a push away up close.
  vec3 dp = pos - uPointer; dp.z *= 0.35;
  float r2 = dot(dp, dp);
  if (uPointerOn > 0.5) {
    float wake = exp(-r2 * 1.6);
    force += normalize(dp + 1e-4) * wake * 26.0;
    force += vec3(-dp.y, dp.x, 0.0) * wake * 18.0;
    force += uPointerVel * wake * 4.0;
  }
  // Holding the pointer: a black hole with an accretion swirl.
  if (uHold > 0.001) {
    float r = sqrt(r2) + 0.12;
    force += -normalize(dp + 1e-4) * uHold * 34.0 / (r * r + 0.25);
    force += vec3(-dp.y, dp.x, dp.z * 0.2) * uHold * 22.0 / (r + 0.3);
    force -= (target - pos) * spring * uHold * 0.85;
  }
  // Shockwaves: an expanding ring of force.
  for (int k = 0; k < ${MAX_SHOCKS}; k++) {
    vec4 s = uShock[k];
    float age = uTime - s.z;
    if (s.w > 0.0 && age > 0.0 && age < 3.0) {
      vec3 d = pos - vec3(s.xy, 0.0);
      float dist = length(d) + 1e-4;
      float ring = exp(-pow((dist - age * 7.5) * 1.6, 2.0));
      force += (d / dist) * ring * s.w * 230.0 * exp(-age * 1.4);
      force += curl(pos * 1.3 + vec3(s.z)) * ring * s.w * 14.0;
    }
  }
  vel += force * uDt;
  // Safety: no runaway speeds, and a particle that has gone astray (or turned
  // NaN on half-float GPUs) stops so its spring can bring it home.
  float sp = length(vel);
  if (sp > 30.0) vel *= 30.0 / sp;
  if (!(sp == sp) || length(pos) > 40.0) vel = (target - pos) * 0.5;
  gl_FragColor = vec4(vel, 1.0);
}`;

const POSITION = /* glsl */ `
uniform float uDt;
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec3 p = P.xyz + V.xyz * uDt;
  // A particle that has gone astray comes back to the middle rather than haunting the camera.
  if (!(p.x == p.x) || length(p) > 40.0) p = vec3(0.0);
  gl_FragColor = vec4(p, P.w);
}`;

const RENDER_VERT = /* glsl */ `
uniform sampler2D tPos, tVel;
uniform float uSize, uPR, uRingMix, uHeat, uGain, uDim;
attribute vec2 aRef;
attribute vec3 aBase, aRing;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec3 pos = texture2D(tPos, aRef).xyz;
  float speed = length(texture2D(tVel, aRef).xyz);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  // Speed and explosions heat a particle a little; brightness is shared out by
  // the particle count (uGain) so tens of thousands of overlapping points never
  // add up to a white-out, and the field dims behind the page's text (uDim).
  float hot = clamp(speed * 0.03 + uHeat * 0.6, 0.0, 1.0);
  vColor = mix(mix(aBase, aRing, uRingMix), vec3(1.0, 0.96, 0.9), hot * 0.5);
  vAlpha = (0.42 + hot * 0.28) * uGain * uDim;
  gl_PointSize = min(uSize * uPR * (7.5 / -mv.z) * (1.0 + hot * 0.5), 9.0 * uPR);
}`;

const RENDER_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = smoothstep(0.25, 0.0, d);
  gl_FragColor = vec4(vColor * a, a * vAlpha);
}`;

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Points sampled from text drawn in the brand face, centred, `width` world units wide. */
async function textPoints(text: string, width: number): Promise<Float32Array> {
  try { await document.fonts.load('600 160px "Zilla Slab"'); } catch { /* falls back to Georgia */ }
  const c = document.createElement('canvas');
  const W = 1400, H = 260;
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 190;
  g.font = `600 ${size}px "Zilla Slab", Georgia, serif`;
  while (g.measureText(text).width > W * 0.94 && size > 40) { size -= 6; g.font = `600 ${size}px "Zilla Slab", Georgia, serif`; }
  g.fillText(text, W / 2, H / 2);
  const data = g.getImageData(0, 0, W, H).data;
  const pts: number[] = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 140) pts.push(x, y);
  const s = width / W, out = new Float32Array((pts.length / 2) * 3);
  for (let i = 0, j = 0; i < pts.length; i += 2, j += 3) { out[j] = (pts[i] - W / 2) * s; out[j + 1] = -(pts[i + 1] - H / 2) * s; out[j + 2] = 0; }
  return out;
}

/** Whether this browser can run the GPU engine (float render targets). */
export function gpuFieldSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return !!gl && !!gl.getExtension('EXT_color_buffer_float');
  } catch { return false; }
}

/** How much the device can take: 'software' (no real GPU), 'low' (phones) or 'high'. */
export function gpuTier(): 'software' | 'low' | 'high' {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'software';
  } catch { /* unknown: assume a real GPU */ }
  // Touch devices (phones and tablets) get the lighter version: fewer particles, no bloom.
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return window.innerWidth < 768 || coarse ? 'low' : 'high';
}

export async function createGpuField(canvas: HTMLCanvasElement, opts: {
  size: number; r: number; agentColors: string[]; intro: boolean; bloom: boolean; onIntroDone?: () => void;
  /** Intro speed (1 normal; below 1 is slow motion, for checking it frame by frame). */
  introSpeed?: number;
}): Promise<GpuField> {
  const S = opts.size, N = S * S;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x0a0a0a, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const camBase = new THREE.Vector3(0, 0, 7.5);
  camera.position.copy(camBase);

  // ---- Shapes as float textures. ----
  const rand = rng(23);
  const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rand(); return u / 3 - 1; };
  const agents = Math.max(1, opts.agentColors.length);
  const shapeData = Array.from({ length: SHAPES }, () => new Float32Array(N * 4));
  const cluster = new Uint16Array(N);
  const text = await textPoints('Data Science Studio', 7.2);
  const textCount = text.length / 3;
  const r = opts.r;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const rad = 2.05 + gauss() * 0.06 + (rand() < 0.14 ? -rand() * 1.0 : 0);
    shapeData[0].set([rad * s * Math.cos(th), rad * u, rad * s * Math.sin(th), 1], o);
    shapeData[4].set([rad * 1.75 * s * Math.cos(th), rad * 1.05 * u, rad * 1.75 * s * Math.sin(th), 1], o);
    if (i % 11 === 0) {
      const t = rand() * 3.8 - 1.9;
      shapeData[1].set(i % 2 ? [t, -1.62, 0, 1] : [-2.0, t * 0.86, 0, 1], o);
    } else {
      const x = gauss() * 1.05, y = r * x + gauss() * 0.42 * Math.sqrt(Math.max(0.05, 1 - r * r));
      shapeData[1].set([x * 1.18, y * 1.18, gauss() * 0.35, 1], o);
    }
    const a = i % agents;
    cluster[i] = a;
    const ang = (a / agents) * Math.PI * 2;
    shapeData[2].set([Math.cos(ang) * 2.3 + gauss() * 0.2, Math.sin(ang) * 1.45 + gauss() * 0.2, Math.sin(ang) * 0.9 + gauss() * 0.2, 1], o);
    const b = i % 7, h = 0.55 + b * 0.43, w = 0.38;
    shapeData[3].set([-2.4 + b * 0.8 + (rand() - 0.5) * w, -1.65 + rand() * h, (rand() - 0.5) * w, 1], o);
    if (textCount) { const k = Math.floor(rand() * textCount) * 3; shapeData[5].set([text[k] + (rand() - 0.5) * 0.02, text[k + 1] + (rand() - 0.5) * 0.02, (rand() - 0.5) * 0.12, 1], o); }
    else shapeData[5].set(shapeData[0].subarray(o, o + 4), o);
    const rr = Math.cbrt(rand()) * 0.06;
    shapeData[6].set([rr * s * Math.cos(th), rr * u, rr * s * Math.sin(th), 1], o);
  }
  const shapeTex = shapeData.map(d => { const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; });
  const seedData = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seedData.set([rand(), rand(), rand(), rand()], i * 4);
  const seedTex = new THREE.DataTexture(seedData, S, S, THREE.RGBAFormat, THREE.FloatType); seedTex.needsUpdate = true;

  // ---- The simulation. ----
  const gpu = new GPUComputationRenderer(S, S, renderer);
  const pos0 = gpu.createTexture(), vel0 = gpu.createTexture();
  if (opts.intro) {
    // The intro opens on scattered stars, which the charge then pulls into one point.
    const stars = pos0.image.data as Float32Array;
    for (let i = 0; i < N; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s2 = Math.sqrt(1 - u * u), rad = 2.5 + Math.pow(rand(), 0.6) * 6.5;
      stars.set([rad * s2 * Math.cos(th) * 1.4, rad * u * 0.8, rad * s2 * Math.sin(th) - 1.5, 1], i * 4);
    }
  } else (pos0.image.data as Float32Array).set(shapeData[0]);
  const posVar: Variable = gpu.addVariable('texturePosition', POSITION, pos0);
  const velVar: Variable = gpu.addVariable('textureVelocity', VELOCITY, vel0);
  gpu.setVariableDependencies(posVar, [posVar, velVar]);
  gpu.setVariableDependencies(velVar, [posVar, velVar]);
  const vu = velVar.material.uniforms;
  Object.assign(vu, {
    uTime: { value: 0 }, uDt: { value: 0.016 }, uMix: { value: 0 }, uSpring: { value: 24 }, uDamp: { value: 5.6 }, uTurb: { value: 0.35 },
    uHold: { value: 0 }, uPointerOn: { value: 0 }, uStreamFrac: { value: 0.05 },
    uShapeA: { value: shapeTex[opts.intro ? 6 : 0] }, uShapeB: { value: shapeTex[opts.intro ? 6 : 0] }, uSeed: { value: seedTex },
    uRot: { value: new THREE.Matrix3() }, uPointer: { value: new THREE.Vector3(99, 99, 0) }, uPointerVel: { value: new THREE.Vector3() }, uScroll: { value: new THREE.Vector3() },
    uShock: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4(0, 0, -99, 0)) },
    uRect: { value: Array.from({ length: MAX_RECTS }, () => new THREE.Vector4(0, 0, 1, 1)) },
    uRectOn: { value: new Array(MAX_RECTS).fill(0) },
  });
  posVar.material.uniforms.uDt = { value: 0.016 };
  const err = gpu.init();
  if (err) throw new Error(err);

  // ---- The particles on screen. ----
  const geo = new THREE.BufferGeometry();
  const ref = new Float32Array(N * 2), base = new Float32Array(N * 3), ring = new Float32Array(N * 3);
  const white = new THREE.Color('#ecedf2');
  const palette = opts.agentColors.map(c => new THREE.Color(c).lerp(white, 0.3));
  for (let i = 0; i < N; i++) {
    ref.set([(i % S + 0.5) / S, (Math.floor(i / S) + 0.5) / S], i * 2);
    const tint = rand() < 0.18 && palette.length ? palette[i % palette.length] : white;
    const dim = 0.45 + rand() * 0.55;
    base.set([tint.r * dim, tint.g * dim, tint.b * dim], i * 3);
    const pc = palette.length ? palette[cluster[i] % palette.length] : white;
    ring.set([pc.r, pc.g, pc.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 2));
  geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aRing', new THREE.BufferAttribute(ring, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: RENDER_VERT, fragmentShader: RENDER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tPos: { value: null }, tVel: { value: null }, uSize: { value: N > 30000 ? 2.0 : 3.0 }, uPR: { value: PR }, uRingMix: { value: 0 }, uHeat: { value: 0 }, uGain: { value: Math.min(1, Math.sqrt(11000 / N)) }, uDim: { value: 1 } },
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // ---- Glow. ----
  let composer: EffectComposer | null = null, bloom: UnrealBloomPass | null = null;
  if (opts.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.42);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // ---- State. ----
  let dimTarget = 1, dimNow = 1, progress = 0, shown = 0, scrollV = 0, turbBoost = 0, heat = 0, shake = 0, yaw = 0, tiltX = 0, tiltY = 0;
  let px: number | null = null, py: number | null = null;
  const pointer = new THREE.Vector3(99, 99, 0), lastPointer = new THREE.Vector3(99, 99, 0);
  let holdOn = false, holdLevel = 0, holdStart = 0;
  let shockIdx = 0, t = 0, last = performance.now(), raf = 0;
  let rectGetter: (() => DOMRect[]) | null = null;
  const rectOn = new Array(MAX_RECTS).fill(0);
  let viewW = 1, viewH = 1, worldH = 1;

  // The intro: collapse, charge, detonate, write the name, burst into the globe.
  type Intro = { at: number; from: number; to: number; dur: number; spring?: number; turb?: number; shock?: number; heat?: number; done?: boolean };
  const introSteps: Intro[] = opts.intro ? [
    { at: 0.0, from: 6, to: 6, dur: 0.1, spring: 2.5, turb: 0.15, heat: 0.2 },
    { at: 1.7, from: 6, to: 5, dur: 1.1, spring: 13, turb: 2.6, shock: 3.2, heat: 1 },
    { at: 4.5, from: 5, to: 0, dur: 1.4, spring: 18, turb: 1.4, shock: 2.2, heat: 0.7, done: true },
  ] : [];
  let chargeHold = 0, introClock = 0, introAt = 0, introStep = -1, introOn = opts.intro, introA = 0, introB = 0, introMix = 1, introMixDur = 1, introSince = 0;

  const toWorld = (nx: number, ny: number) => new THREE.Vector3(nx * worldH * 0.5 * camera.aspect, ny * worldH * 0.5, 0);
  const resize = () => {
    viewW = canvas.clientWidth || window.innerWidth; viewH = canvas.clientHeight || window.innerHeight;
    renderer.setSize(viewW, viewH, false);
    composer?.setSize(viewW, viewH);
    bloom?.setSize(Math.floor(viewW / 2), Math.floor(viewH / 2));
    camera.aspect = viewW / viewH;
    camBase.z = viewW / viewH < 0.8 ? 10.5 : 7.5;
    camera.position.z = camBase.z;
    camera.updateProjectionMatrix();
    worldH = 2 * Math.tan((camera.fov * Math.PI) / 360) * camBase.z;
  };
  resize();

  const fireShock = (x: number, y: number, strength: number) => {
    const s = vu.uShock.value[shockIdx++ % MAX_SHOCKS] as THREE.Vector4;
    s.set(x, y, t, strength);
    shake = Math.min(1.4, shake + strength * 0.35);
    turbBoost = Math.min(3, turbBoost + strength * 0.6);
    heat = Math.min(1, heat + strength * 0.25);
  };

  const finishIntro = () => {
    if (!introOn) return;
    introOn = false;
    opts.onIntroDone?.();
  };

  const smooth = (x: number) => x * x * (3 - 2 * x);
  const rot = new THREE.Matrix4(), rot3 = new THREE.Matrix3();

  const step = (now: number) => {
    // Real time drives the intro and the decay of effects; physics takes up to
    // three steps per frame on slow devices so it keeps real speed.
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    const steps = Math.min(3, Math.max(1, Math.ceil(real / 0.034)));
    const dt = Math.min(0.034, real / steps);

    // Shapes: the intro, or the scroll.
    let A: number, B: number, mix: number;
    if (introOn) {
      if (!introClock) introClock = now;
      introAt = ((now - introClock) / 1000) * (opts.introSpeed ?? 1);
      while (introStep + 1 < introSteps.length && introAt >= introSteps[introStep + 1].at) {
        const s = introSteps[++introStep];
        introA = s.from; introB = s.to; introMix = 0; introMixDur = s.dur; introSince = introAt;
        if (s.spring != null) vu.uSpring.value = s.spring;
        if (s.turb != null) turbBoost = s.turb;
        if (s.heat != null) heat = s.heat;
        if (s.shock) fireShock(0, 0, s.shock);
        if (s.done) setTimeout(finishIntro, 700 / (opts.introSpeed ?? 1));
      }
      introMix = Math.min(1, (introAt - introSince) / introMixDur);
      A = introA; B = introB; mix = introMix;
      // The charge: the stars spiral into a black hole at the centre, the core
      // pulses hotter and faster, the camera trembles, and then it blows.
      if (introStep === 0) {
        const k = Math.min(1, introAt / 1.6);
        chargeHold = 0.35 + k * 0.9;
        vu.uSpring.value = 2.5 + k * k * 40;
        heat = 0.25 + 0.75 * k * (0.6 + 0.4 * Math.sin(introAt * (10 + k * 30)));
        shake = Math.max(shake, k * k * 0.5);
      } else chargeHold = 0;
    } else {
      shown += (progress - shown) * Math.min(1, dt * 3.4);
      A = Math.floor(shown); B = Math.min(4, A + 1); mix = smooth(shown - A);
      vu.uSpring.value += (24 - vu.uSpring.value) * Math.min(1, dt * 1.5);
    }
    vu.uShapeA.value = shapeTex[A]; vu.uShapeB.value = shapeTex[B]; vu.uMix.value = mix;

    // Scroll: inertia and turbulence.
    scrollV *= Math.pow(0.03, real);
    (vu.uScroll.value as THREE.Vector3).set(0, scrollV * 0.012, 0);
    turbBoost *= Math.pow(0.35, real);
    vu.uTurb.value = 0.32 + turbBoost + Math.min(2.2, Math.abs(scrollV) / 900);
    heat *= Math.pow(0.4, real);

    // Pointer, its wake, and the black hole.
    if (px != null && py != null) {
      pointer.copy(toWorld(px, py));
      (vu.uPointerVel.value as THREE.Vector3).copy(pointer).sub(lastPointer).multiplyScalar(1 / Math.max(real, 1e-3)).clampLength(0, 12);
      lastPointer.copy(pointer);
      vu.uPointerOn.value = 1;
    } else vu.uPointerOn.value = 0;
    (vu.uPointer.value as THREE.Vector3).copy(pointer);
    holdLevel += ((holdOn ? 1 : 0) - holdLevel) * Math.min(1, real * (holdOn ? 2.2 : 9));
    vu.uHold.value = Math.max(holdLevel, chargeHold);
    if (chargeHold > 0) { (vu.uPointer.value as THREE.Vector3).set(0, 0, 0); vu.uPointerOn.value = 0; }
    if (holdOn) heat = Math.max(heat, holdLevel * 0.5);

    // Panels: streams trace the ones on screen.
    const rects = rectGetter ? rectGetter().slice(0, MAX_RECTS) : [];
    for (let k = 0; k < MAX_RECTS; k++) {
      const rc = rects[k];
      const on = rc && rc.bottom > 0 && rc.top < viewH ? 1 : 0;
      rectOn[k] += (on - rectOn[k]) * Math.min(1, dt * 2.5);
      vu.uRectOn.value[k] = rectOn[k];
      if (rc) {
        const c = toWorld(((rc.left + rc.width / 2) / viewW) * 2 - 1, -(((rc.top + rc.height / 2) / viewH) * 2 - 1));
        const hw = (rc.width / viewW) * worldH * camera.aspect * 0.5, hh = (rc.height / viewH) * worldH * 0.5;
        (vu.uRect.value[k] as THREE.Vector4).set(c.x, c.y, hw, hh);
      }
    }
    vu.uStreamFrac.value = 0.06;

    // The shape turns, faster while scrolling, and leans to the pointer; flat for charts and the name.
    const flat = introOn ? 1 : Math.max(0, 1 - Math.abs(shown - 1)) + Math.max(0, 1 - Math.abs(shown - 3));
    yaw += dt * (0.14 + Math.min(1.5, Math.abs(scrollV) / 1500)) * (1 - Math.min(1, flat) * 0.9);
    if (flat > 0.5) yaw += (Math.round(yaw / (Math.PI * 2)) * Math.PI * 2 - yaw) * Math.min(1, dt * 2.5);
    tiltX += (((py ?? 0) * 0.28) - tiltX) * Math.min(1, dt * 2);
    tiltY += (((px ?? 0) * 0.32) - tiltY) * Math.min(1, dt * 2);
    rot.makeRotationFromEuler(new THREE.Euler(tiltX * (1 - flat * 0.6), yaw + tiltY * 0.6, 0, 'YXZ'));
    rot3.setFromMatrix4(rot);
    (vu.uRot.value as THREE.Matrix3).copy(rot3);
    mat.uniforms.uRingMix.value = introOn ? 0 : Math.max(0, 1 - Math.abs(shown - 2));
    mat.uniforms.uHeat.value = heat * 0.6;

    // Camera shake after explosions.
    shake *= Math.pow(0.08, real);
    camera.position.set(camBase.x + (Math.random() - 0.5) * shake * 0.18, camBase.y + (Math.random() - 0.5) * shake * 0.18, camBase.z);

    vu.uDt.value = dt; posVar.material.uniforms.uDt.value = dt;
    for (let k = 0; k < steps; k++) { t += dt; vu.uTime.value = t; gpu.compute(); }
    mat.uniforms.tPos.value = gpu.getCurrentRenderTarget(posVar).texture;
    mat.uniforms.tVel.value = gpu.getCurrentRenderTarget(velVar).texture;
    if (bloom) bloom.strength = Math.min(1.0, 0.48 + heat * 0.45 + holdLevel * 0.35 + Math.min(0.2, Math.abs(scrollV) / 8000));
    dimNow += (dimTarget - dimNow) * Math.min(1, real * 3);
    mat.uniforms.uDim.value = dimNow;
    if (composer) composer.render(); else renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  return {
    setProgress(p) { progress = Math.max(0, Math.min(4, p)); },
    setDim(v) { dimTarget = Math.max(0.2, Math.min(1, v)); },
    setVelocity(v) { scrollV = Math.max(-7000, Math.min(7000, v)); },
    setPointer(x, y) { px = x; py = y; },
    shock(x, y, strength = 1.5) { fireShock(toWorld(x, y).x, toWorld(x, y).y, strength); },
    hold(on, x, y) {
      if (x != null && y != null) { px = x; py = y; }
      if (on && !holdOn) { holdOn = true; holdStart = t; }
      else if (!on && holdOn) {
        holdOn = false;
        const held = Math.min(3, t - holdStart);
        fireShock(pointer.x, pointer.y, 1 + held * 1.1);
      }
    },
    setRects(get) { rectGetter = get; },
    skipIntro() {
      if (!introOn) return;
      introStep = introSteps.length - 1;
      introA = 5; introB = 0; introMix = 0; introMixDur = 0.9; introSince = introAt;
      fireShock(0, 0, 1.6);
      setTimeout(finishIntro, 300);
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      geo.dispose(); mat.dispose(); shapeTex.forEach(x => x.dispose()); seedTex.dispose();
      gpu.dispose(); composer?.dispose(); renderer.dispose();
    },
  };
}
