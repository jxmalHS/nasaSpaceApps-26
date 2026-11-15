/** One verdict scale for the whole References page: Strong / Moderate / Weak, same colours as Explore. */
import { topPct } from './rank.js';

export const VERDICT_KIND = { Strong: 'met', Moderate: 'warn', Weak: 'notmet' };

/** Same rule as the engine's NASA-agreement note: how often would k random places do this well? */
export function strengthFromChance(p) {
  if (!Number.isFinite(p)) return null;
  return p <= 0.01 ? 'Strong' : p <= 0.05 ? 'Moderate' : 'Weak';
}

/** Chance that k random places (from a large population) have a median percentile >= medianPct. */
export function chanceRandomMedian(medianPct, k, draws = 20000) {
  if (!Number.isFinite(medianPct) || k < 1) return NaN;
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let hits = 0;
  const xs = new Array(k);
  for (let d = 0; d < draws; d++) {
    for (let j = 0; j < k; j++) xs[j] = rand() * 100;
    xs.sort((a, b) => a - b);
    if (xs[Math.floor(k / 2)] >= medianPct - 1e-9) hits++;
  }
  return hits / draws;
}

/** Percentile (share of places beaten, 0-100) -> "Top 3%" (rounded up, never overclaims), or "Bottom 4%" below the middle. */
export const topFromPercentile = (p) => {
  if (!Number.isFinite(p)) return null;
  return p >= 50 ? topPct(Math.max(1e-4, 100 - p), 100) : `Bottom ${Math.max(1, Math.ceil(p))}%`;
};

/** Stability: share of small changes in which the #1 site stays #1. */
export function stabilityStrength(kept, total) {
  if (!(total > 0)) return null;
  const s = kept / total;
  return s >= 0.8 ? 'Strong' : s >= 0.5 ? 'Moderate' : 'Weak';
}

export const median = (a) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
