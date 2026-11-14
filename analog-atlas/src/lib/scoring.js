/**
 * Analog Atlas scoring engine. Pure functions, no DOM: runs in the Web Worker and in node tests.
 *
 * Suitability, not similarity:
 *  - target features are scored against the Moon/Mars value;
 *  - interference features must stay on the safe side of a threshold (hard = pass/fail, soft = penalty + warning);
 *  - ignored features never touch the score.
 *
 * Earth and target values are compared on one axis: the Earth percentile of each value
 * (from the index's quantile table). A target outside Earth's range maps to 0 or 1 and is
 * flagged "beyond Earth", so the ranking still finds the most extreme Earth sites while the
 * UI reports the real-unit gap. Unknown inputs never count as a pass.
 */

export const STATUS = { PASS: 0, UNKNOWN: 1, FAIL: 2 };
export const SOFT_PENALTY = 0.75;
/** Width of the similarity kernel, in Earth-percentile units: 12 percentile points away ≈ 0.61. */
export const SIM_SIGMA = 0.12;

/** Earth percentile (0..1) of value v using the 101-point quantile table q. */
export function percentile(v, q) {
  if (v == null || Number.isNaN(v)) return NaN;
  if (v <= q[0]) return 0;
  if (v >= q[100]) return 1;
  let lo = 0, hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (q[mid] <= v) lo = mid; else hi = mid;
  }
  const span = q[hi] - q[lo];
  return (lo + (span > 0 ? (v - q[lo]) / span : 0)) / 100;
}

/** Similarity of one feature, 0..1, from Earth percentiles. */
export function featureSim(qx, qt, dir) {
  if (Number.isNaN(qx) || Number.isNaN(qt)) return NaN;
  let d;
  if (dir === 'high') d = Math.max(0, qt - qx);
  else if (dir === 'low') d = Math.max(0, qx - qt);
  else d = Math.abs(qx - qt);
  return Math.exp(-(d * d) / (2 * SIM_SIGMA * SIM_SIGMA));
}

export function passes(x, op, v) {
  if (x == null || Number.isNaN(x)) return null;
  return op === '>=' ? x >= v : x <= v;
}

/**
 * Turn the user's configuration into a compiled plan: which columns, which weights, which
 * thresholds. `cols` maps feature id → column position; `quant` maps id → quantile table.
 */
export function compile(cfg, catalog, quant, cols) {
  const { test, target } = cfg;
  const targets = [];
  const missing = [];
  for (const [fid, spec] of Object.entries(test.target)) {
    const role = cfg.roles?.[fid] ?? 'target';
    if (role !== 'target') continue;
    const w = cfg.weights?.[fid] ?? spec.w;
    if (!(w > 0)) continue;
    const dir = cfg.mode === 'stress' ? spec.dir : 'match';
    const tv = target?.f?.[fid]?.v;
    const pending = catalog.F[fid]?.pending || !(fid in cols);
    const q = quant[fid];
    let qt = !pending && tv != null && q ? percentile(tv, q) : NaN;
    const beyond = !pending && tv != null && q ? (tv < q[0] ? 'below' : tv > q[100] ? 'above' : null) : null;
    // Stress mode with no target value: aim for Earth's extreme in the stress direction.
    const assumed = !pending && tv == null && cfg.mode === 'stress' && (dir === 'high' || dir === 'low');
    if (assumed) qt = dir === 'high' ? 1 : 0;
    const entry = { fid, w, dir, tv, qt, col: cols[fid], pending, beyond, assumed, targetUnknown: tv == null && !assumed };
    targets.push(entry);
    if (pending || entry.targetUnknown) missing.push(entry);
  }
  // Features the user promoted to target from 'ignore' or 'interference'.
  for (const [fid, role] of Object.entries(cfg.roles || {})) {
    if (role !== 'target' || test.target[fid]) continue;
    const w = cfg.weights?.[fid] ?? 20;
    const tv = target?.f?.[fid]?.v;
    const q = quant[fid];
    const pending = catalog.F[fid]?.pending || !(fid in cols);
    targets.push({ fid, w, dir: 'match', tv, qt: !pending && tv != null && q ? percentile(tv, q) : NaN, col: cols[fid], pending,
      beyond: null, targetUnknown: tv == null });
  }
  const checks = [];
  const thr = { ...(test.interference || {}) };
  for (const [fid, t] of Object.entries(cfg.thresholds || {})) thr[fid] = { ...(thr[fid] || {}), ...t };
  for (const [fid, t] of Object.entries(thr)) {
    const role = cfg.roles?.[fid] ?? (test.interference?.[fid] ? 'interference' : t.user ? 'requirement' : 'interference');
    if (role === 'ignore' || role === 'target') continue;
    if (t.off) continue;
    checks.push({ fid, op: t.op, v: t.v, hard: !!t.hard, col: cols[fid], pending: catalog.F[fid]?.pending || !(fid in cols), user: !!t.user });
  }
  const wTotal = targets.reduce((a, t) => a + t.w, 0);
  return { targets, checks, wTotal, minEvidence: cfg.filters?.minEvidence ?? 0.5 };
}

/**
 * Score every cell. `X` = array of Float32Array columns (NaN = missing), `QX` = matching
 * Earth-percentile columns. Returns typed arrays the size of the index.
 */
export function scoreAll(plan, X, QX, n) {
  const score = new Float32Array(n);
  const evidence = new Float32Array(n);
  const status = new Uint8Array(n);
  const warn = new Uint8Array(n);
  const { targets, checks, wTotal, minEvidence } = plan;
  const live = targets.filter((t) => !t.pending && !t.targetUnknown);
  for (let i = 0; i < n; i++) {
    let num = 0, wk = 0;
    for (let k = 0; k < live.length; k++) {
      const t = live[k];
      const s = featureSim(QX[t.col][i], t.qt, t.dir);
      if (!Number.isNaN(s)) { num += t.w * s; wk += t.w; }
    }
    let st = STATUS.PASS, pen = 1, w = 0;
    for (let c = 0; c < checks.length; c++) {
      const ch = checks[c];
      const ok = ch.pending ? null : passes(X[ch.col][i], ch.op, ch.v);
      if (ok === null) { if (ch.hard && st === STATUS.PASS) st = STATUS.UNKNOWN; }
      else if (!ok) {
        if (ch.hard) st = STATUS.FAIL;
        else { pen *= SOFT_PENALTY; w++; }
      }
    }
    const ev = wTotal > 0 ? wk / wTotal : 0;
    if (st === STATUS.PASS && ev < minEvidence) st = STATUS.UNKNOWN;
    evidence[i] = ev;
    score[i] = wk > 0 ? (num / wk) * pen : NaN;
    status[i] = Number.isNaN(score[i]) && st === STATUS.PASS ? STATUS.UNKNOWN : st;
    warn[i] = w;
  }
  return { score, evidence, status, warn };
}

/** Full breakdown for one cell, in real units. */
export function explain(plan, X, QX, i, catalog) {
  const rows = plan.targets.map((t) => {
    const x = t.pending ? NaN : X[t.col][i];
    const sim = t.pending || t.targetUnknown ? NaN : featureSim(QX[t.col][i], t.qt, t.dir);
    let state;
    if (t.pending) state = 'no-earth-layer';
    else if (t.targetUnknown) state = 'no-target-value';
    else if (Number.isNaN(x)) state = 'missing';
    else state = 'scored';
    return { fid: t.fid, w: t.w, dir: t.dir, x, tv: t.tv, assumed: !!t.assumed, diff: Number.isNaN(x) || t.tv == null ? NaN : x - t.tv, sim, beyond: t.beyond, state,
      label: catalog.F[t.fid]?.label };
  });
  const checks = plan.checks.map((c) => {
    const x = c.pending ? NaN : X[c.col][i];
    const ok = c.pending ? null : passes(x, c.op, c.v);
    return { ...c, x, ok, state: ok === null ? 'unknown' : ok ? 'met' : 'not-met' };
  });
  return { rows, checks };
}

/** Indices of the top `k` cells by score, among allowed statuses. */
export function topK(score, status, k, allow, extraFilter) {
  const idx = [];
  for (let i = 0; i < score.length; i++) {
    if (Number.isNaN(score[i]) || !allow[status[i]]) continue;
    if (extraFilter && !extraFilter(i)) continue;
    idx.push(i);
  }
  idx.sort((a, b) => score[b] - score[a]);
  return idx.slice(0, k);
}

/** Rank (1-based) of cell i among all scored cells with the same filters. */
export function rankOf(score, i) {
  const s = score[i];
  if (Number.isNaN(s)) return null;
  let r = 1;
  for (let j = 0; j < score.length; j++) if (score[j] > s) r++;
  return r;
}

/** Deterministic PRNG for reproducible stability tests. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Share of the top `k` that two rankings have in common. Agreement is not accuracy. */
export function overlap(a, b, k = 5) {
  const A = new Set(a.slice(0, k));
  let m = 0;
  for (const x of b.slice(0, k)) if (A.has(x)) m++;
  return m / Math.min(k, a.length || k);
}
