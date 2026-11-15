/** Compare uses measured elevations on a north-up metric grid. */
export const PATCH_M = 2000;
export const PATCH_N = 128;
const cache = new Map();
export async function loadPatch({body, key, lat, lon, signal}) {
  const coordinates = new URLSearchParams({body,lat,lon});
  const id = coordinates.toString();
  if (cache.has(id)) return cache.get(id);
  const urls = [key && import.meta.env.BASE_URL+'data/patches/'+body+'/'+key+'.json', import.meta.env.BASE_URL+'api/terrain?'+id].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url,{signal});
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) continue;
      const p = await res.json();
      if (p.body !== body || p.lat !== lat || p.lon !== lon || p.n !== PATCH_N || p.size_m !== PATCH_M || p.z?.length !== p.n*p.n || !p.z.every(Number.isFinite)) continue;
      p.z = Float32Array.from(p.z);
      p.stats = patchStats(p);
      if (cache.size >= 96) cache.delete(cache.keys().next().value);
      cache.set(id,p);
      return p;
    } catch { if(signal?.aborted) break; }
  }
  return null;
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
export function renderPatch(canvas, p, domain, { sunAlt = 30, sunAz = 315, exaggerate = 1, layer = "height" } = {}) {
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
    const c = rampColor(layer==="slope"?sl/(Math.PI/2):t), k = layer==="slope"?1:0.25 + 0.95 * shade, o = (y * n + x) * 4;
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
