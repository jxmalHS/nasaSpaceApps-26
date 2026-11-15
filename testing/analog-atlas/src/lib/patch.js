/**
 * 2 × 2 km terrain patches for Compare. Both sides always share size, sampling, colour scale and units.
 *
 * Source order:
 *   1. Measured patch  public/data/patches/{earth|moon|mars}/{key}.json
 *      { size_m: 2000, n: 128, z: [n*n heights in metres, row-major, north up], source: "NASADEM 30 m" }
 *      (cut them with pipeline/make_patches.py from NASADEM / LOLA / HiRISE DTMs)
 *   2. Synthesized from the site's regional statistics (roughness, slope), clearly labelled
 *      "illustrative". It conveys texture scale, not real landforms.
 */
export const PATCH_M = 2000;
export const PATCH_N = 128;

const cache = new Map();

export async function loadPatch({ body, key, seed, slopeDeg, roughM }) {
  const k = `${body}/${key}`;
  if (cache.has(k)) return cache.get(k);
  let p = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/patches/${k}.json`);
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      const j = await r.json();
      if (j.n && j.z?.length === j.n * j.n) p = { ...j, z: Float32Array.from(j.z), synthetic: false };
    }
  } catch { /* fall back */ }
  if (!p) p = synthesize({ body, seed, slopeDeg, roughM });
  p.stats = patchStats(p);
  cache.set(k, p);
  return p;
}

/** Fractal terrain with RMS roughness scaled from the ~9 km regional value to 2 km (Hurst 0.8). */
export function synthesize({ body, seed = 1, slopeDeg = 1, roughM = 20 }) {
  const n = PATCH_N, dx = PATCH_M / (n - 1);
  const rnd = mulberry(seed >>> 0 || 1);
  const z = new Float32Array(n * n);
  const lattice = (f) => { const g = new Float32Array((f + 1) * (f + 1)); for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1; return g; };
  const H = 0.8;
  for (let o = 0; o < 6; o++) {
    const f = 2 << o, g = lattice(f), amp = Math.pow(f, -H);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const gx = (x / (n - 1)) * f, gy = (y / (n - 1)) * f, ix = Math.min(f - 1, Math.floor(gx)), iy = Math.min(f - 1, Math.floor(gy));
      const tx = smooth(gx - ix), ty = smooth(gy - iy), w = f + 1;
      const a = g[iy * w + ix], b = g[iy * w + ix + 1], c = g[(iy + 1) * w + ix], d = g[(iy + 1) * w + ix + 1];
      z[y * n + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
  }
  // Craters: dense on the Moon, sparse on Mars, none on Earth.
  const craters = body === 'moon' ? 70 : body === 'mars' ? 14 : 0;
  for (let k = 0; k < craters; k++) {
    const cx = rnd() * n, cy = rnd() * n, D = (12 + 260 * Math.pow(rnd(), 3)) / dx, R = D / 2, depth = 0.2 * D * dx;
    for (let y = Math.max(0, Math.floor(cy - R * 1.6)); y < Math.min(n, cy + R * 1.6); y++)
      for (let x = Math.max(0, Math.floor(cx - R * 1.6)); x < Math.min(n, cx + R * 1.6); x++) {
        const r = Math.hypot(x - cx, y - cy) / R;
        z[y * n + x] += r < 1 ? depth * (r * r - 1) * 0.0035 : r < 1.6 ? depth * 0.0012 * Math.cos(((r - 1) / 0.6) * Math.PI / 2) ** 2 : 0;
      }
  }
  // normalise to target RMS, then add the regional tilt
  let m = 0; for (const v of z) m += v; m /= z.length;
  let s = 0; for (const v of z) s += (v - m) ** 2; s = Math.sqrt(s / z.length) || 1;
  const rms = Math.max(0.3, (Number.isFinite(roughM) ? roughM : 20) * Math.pow(2 / 9, H));
  const tilt = Math.tan(((Number.isFinite(slopeDeg) ? slopeDeg : 1) * Math.PI) / 180);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) z[y * n + x] = ((z[y * n + x] - m) / s) * rms + tilt * x * dx;
  return { n, size_m: PATCH_M, z, synthetic: true, source: 'Synthesized from regional slope and roughness (illustrative)' };
}

export function slopeAt(p, x, y) {
  const n = p.n, dx = p.size_m / (n - 1);
  const xi = Math.min(n - 2, Math.max(1, x)), yi = Math.min(n - 2, Math.max(1, y));
  const gx = (p.z[yi * n + xi + 1] - p.z[yi * n + xi - 1]) / (2 * dx), gy = (p.z[(yi + 1) * n + xi] - p.z[(yi - 1) * n + xi]) / (2 * dx);
  return (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
}

export function patchStats(p) {
  const n = p.n, slopes = [];
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) slopes.push(slopeAt(p, x, y));
  slopes.sort((a, b) => a - b);
  // best-fit plane removal for RMS roughness
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxz = 0, syz = 0, N = n * n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = p.z[y * n + x]; sx += x; sy += y; sz += v; sxx += x * x; syy += y * y; sxz += x * v; syz += y * v; }
  const a = (sxz - (sx * sz) / N) / (sxx - (sx * sx) / N), b = (syz - (sy * sz) / N) / (syy - (sy * sy) / N), c = (sz - a * sx - b * sy) / N;
  let ss = 0; const zs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = p.z[y * n + x] - (a * x + b * y + c); ss += r * r; zs.push(p.z[y * n + x]); }
  zs.sort((u, v) => u - v);
  const q = (arr, f) => arr[Math.floor(f * (arr.length - 1))];
  return { slopeMean: slopes.reduce((u, v) => u + v, 0) / slopes.length, slopeP90: q(slopes, 0.9), rms: Math.sqrt(ss / N), relief: q(zs, 0.98) - q(zs, 0.02),
    mean: sz / N, steepShare: slopes.filter((s) => s > 15).length / slopes.length };
}

/** Shared colour domain so both sides read on one scale (heights relative to each patch's mean). */
export function sharedDomain(a, b) {
  let lo = Infinity, hi = -Infinity;
  for (const p of [a, b]) if (p) for (const v of p.z) { const r = v - p.stats.mean; if (r < lo) lo = r; if (r > hi) hi = r; }
  const m = Math.max(Math.abs(lo), Math.abs(hi), 1);
  return [-m, m];
}

const RAMP = [[0, [8, 20, 52]], [0.35, [36, 72, 150]], [0.55, [110, 128, 150]], [0.75, [190, 176, 150]], [1, [250, 246, 238]]];
export function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < RAMP.length; k++) if (t <= RAMP[k][0]) {
    const [t0, c0] = RAMP[k - 1], [t1, c1] = RAMP[k], u = (t - t0) / (t1 - t0);
    return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
  }
  return RAMP[RAMP.length - 1][1];
}

/** Hillshade × height colour into a canvas. `sunAlt` in degrees lets you view under grazing light. */
export function renderPatch(canvas, p, domain, { sunAlt = 30, sunAz = 315, exaggerate = 1 } = {}) {
  const n = p.n, dx = p.size_m / (n - 1);
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(n, n);
  const zen = ((90 - sunAlt) * Math.PI) / 180, az = ((360 - sunAz + 90) * Math.PI) / 180;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const xm = Math.max(1, Math.min(n - 2, x)), ym = Math.max(1, Math.min(n - 2, y));
    const dzdx = ((p.z[ym * n + xm + 1] - p.z[ym * n + xm - 1]) / (2 * dx)) * exaggerate;
    const dzdy = ((p.z[(ym + 1) * n + xm] - p.z[(ym - 1) * n + xm]) / (2 * dx)) * exaggerate;
    const sl = Math.atan(Math.hypot(dzdx, dzdy)), asp = Math.atan2(dzdy, -dzdx);
    const shade = Math.max(0, Math.cos(zen) * Math.cos(sl) + Math.sin(zen) * Math.sin(sl) * Math.cos(az - asp));
    const t = (p.z[y * n + x] - p.stats.mean - domain[0]) / (domain[1] - domain[0]);
    const c = rampColor(t), k = 0.25 + 0.95 * shade, o = (y * n + x) * 4;
    img.data[o] = Math.min(255, c[0] * k); img.data[o + 1] = Math.min(255, c[1] * k); img.data[o + 2] = Math.min(255, c[2] * k); img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Sample heights (relative to the line's start) along a normalised segment. */
export function profile(p, a, b, samples = 120) {
  const n = p.n, out = [];
  const at = (u, v) => { const x = Math.min(n - 1, Math.max(0, u * (n - 1))), y = Math.min(n - 1, Math.max(0, v * (n - 1))); return p.z[Math.round(y) * n + Math.round(x)]; };
  const z0 = at(a[0], a[1]);
  for (let k = 0; k <= samples; k++) { const t = k / samples; out.push(at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) - z0); }
  return out;
}

const smooth = (t) => t * t * (3 - 2 * t);
function mulberry(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Downhill direction as a compass bearing (degrees from north). */
export function aspectAt(p, x, y) {
  const n = p.n, xi = Math.min(n - 2, Math.max(1, x)), yi = Math.min(n - 2, Math.max(1, y));
  const gx = p.z[yi * n + xi + 1] - p.z[yi * n + xi - 1], gy = p.z[(yi + 1) * n + xi] - p.z[(yi - 1) * n + xi];
  if (Math.hypot(gx, gy) < 1e-6) return NaN;
  return (Math.atan2(-gx, gy) * 180 / Math.PI + 360) % 360; // row index grows southward
}
/** RMS height wiggle in a ~80 m window around a point (detrended by the window mean). */
export function localRms(p, x, y, r = 2) {
  const n = p.n, v = [];
  for (let j = Math.max(0, y - r); j <= Math.min(n - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(n - 1, x + r); i++) v.push(p.z[j * n + i]);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}
export const compass = (deg) => (Number.isNaN(deg) ? 'flat' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
