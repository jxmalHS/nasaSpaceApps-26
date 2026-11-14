import { F } from './catalog.js';

const nf = new Map();
function fmtNum(v, dp) {
  const key = dp;
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  return nf.get(key).format(v);
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** "3.2 °" style value with unit; '—' for missing. */
export function fmt(v, fid, { unit = true, dp } = {}) {
  if (!isNum(v)) return '—';
  const f = F[fid];
  const d = dp ?? f?.dp ?? 1;
  const u = f?.unit;
  const n = fmtNum(Math.abs(v) < 1e-9 ? 0 : v, d);
  if (!unit || !u) return n;
  if (u === '°' || u === '%') return n + u;
  if (u === 'share' || u === 'NDVI') return n;
  return `${n} ${u}`;
}

export function fmtDiff(v, fid) {
  if (!isNum(v)) return '—';
  const s = fmt(Math.abs(v), fid);
  if (Math.abs(v) < 10 ** -((F[fid]?.dp ?? 1)) / 2) return '±0';
  return (v > 0 ? '+' : '−') + s;
}

export const pct = (v, dp = 0) => (isNum(v) ? fmtNum(v * 100, dp) + '%' : '—');
export const score100 = (v) => (isNum(v) ? fmtNum(v * 100, v >= 0.985 && v < 1 ? 1 : 0) : '—');
export const int = (v) => (isNum(v) ? fmtNum(v, 0) : '—');

export function latlon(lat, lon) {
  const a = `${fmtNum(Math.abs(lat), 2)}°${lat >= 0 ? 'N' : 'S'}`;
  const b = `${fmtNum(Math.abs(lon), 2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${a} ${b}`;
}

export function ordinal(n) {
  if (!isNum(n)) return '—';
  return '#' + fmtNum(n, 0);
}
