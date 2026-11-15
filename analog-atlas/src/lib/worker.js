/* eslint-disable no-restricted-globals */
import { catalog, tests, T, A } from './catalog.js';
import { compile, scoreAll, explain, STATUS, mulberry32, percentile, overlap, coverGreedy } from './scoring.js';
import { distanceKm } from './geo.js';
import { mlProvider } from './ml.js';

const G = { ready: false };
const MERC_H = 720;

async function init({ base, mlApi = '' }) {
  if (G.ready) return summary();
  const [meta, buf] = await Promise.all([
    fetch(base + 'data/earth_index.meta.json').then((r) => { if (!r.ok) throw new Error('index meta ' + r.status); return r.json(); }),
    fetch(base + 'data/earth_index.bin').then((r) => { if (!r.ok) throw new Error('index ' + r.status); return r.arrayBuffer(); }),
  ]);
  const n = meta.n;
  let off = 0;
  const ids = new Uint32Array(buf.slice(0, 4 * n)); off += 4 * n;
  const X = [], QX = [], cols = {}, quant = {};
  meta.columns.forEach((c, j) => {
    const q16 = new Uint16Array(buf, off, n); off += 2 * n;
    const x = new Float32Array(n), qx = new Float32Array(n);
    const span = c.max - c.min;
    for (let i = 0; i < n; i++) {
      if (q16[i] === meta.missing_code) { x[i] = NaN; qx[i] = NaN; continue; }
      x[i] = c.min + (q16[i] / 65534) * span;
    }
    for (let i = 0; i < n; i++) if (!Number.isNaN(x[i])) qx[i] = percentile(x[i], c.q);
    X.push(x); QX.push(qx); cols[c.id] = j; quant[c.id] = c.q;
  });
  const country = new Uint16Array(buf.slice(off, off + 2 * n)); off += 2 * n;
  const place = new Uint16Array(buf.slice(off, off + 2 * n)); off += 2 * n;
  const lstMeasured = new Uint8Array(buf.slice(off, off + n));
  const lat = new Float32Array(n), lon = new Float32Array(n);
  const cellToIndex = new Int32Array(meta.grid.nrow * meta.grid.ncol).fill(-1);
  for (let i = 0; i < n; i++) {
    const id = ids[i], r = Math.floor(id / meta.grid.ncol), c = id % meta.grid.ncol;
    lat[i] = 90 - (r + 0.5) * meta.grid.cell_deg; lon[i] = -180 + (c + 0.5) * meta.grid.cell_deg;
    cellToIndex[id] = i;
  }
  // Mercator row → source grid row, for painting rasters straight into a MapLibre canvas source.
  const rowMap = new Int16Array(MERC_H);
  const yMax = Math.log(Math.tan(Math.PI / 4 + (85.0511287798 * Math.PI) / 360));
  for (let y = 0; y < MERC_H; y++) {
    const my = yMax - ((y + 0.5) / MERC_H) * 2 * yMax;
    const la = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI);
    rowMap[y] = Math.min(meta.grid.nrow - 1, Math.max(0, Math.floor((90 - la) / meta.grid.cell_deg)));
  }
  const digest = await crypto.subtle.digest('SHA-1', ids.buffer.slice(0));
  const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  Object.assign(G, { ready: true, meta, n, ids, X, QX, cols, quant, country, place, lstMeasured, lat, lon, cellToIndex, rowMap, fingerprint, base });
  G.ml = await mlProvider({ base, fingerprint, n, apiBase: mlApi });
  return summary();
}

function summary() {
  const { meta, n, fingerprint } = G;
  return {
    n, fingerprint,
    columns: meta.columns.map(({ id, min, max, missing }) => ({ id, min, max, missing })),
    continents: [...new Set(meta.continents)].filter((c) => c !== '—' && !c.startsWith('Seven')).sort(),
    analogCells: meta.analog_cells,
    ml: G.ml.summary(),
  };
}

const nameOf = (i) => {
  const p = G.meta.places[G.place[i]];
  const country = G.meta.countries[G.country[i]] || '—';
  return { place: p ? p[0] : null, country, continent: G.meta.continents[G.country[i]] || '—' };
};

function cfgFor(cfg) {
  const test = tests[cfg.testId];
  const target = T[cfg.targetId];
  return { ...cfg, test, target };
}

async function run(cfg) {
  const c = cfgFor(cfg);
  const plan = compile(c, catalog, G.quant, G.cols);
  const res = scoreAll(plan, G.X, G.QX, G.n);
  const mlArr = await G.ml.get(cfg.testId, cfg.targetId);
  let final = res.score;
  if (mlArr && cfg.rankBy !== 'rules') {
    final = new Float32Array(G.n);
    for (let i = 0; i < G.n; i++) {
      const m = mlArr[i];
      if (cfg.rankBy === 'ml') final[i] = m;
      else final[i] = Number.isNaN(m) ? res.score[i] : Number.isNaN(res.score[i]) ? m : 0.5 * (m + res.score[i]);
    }
  }
  return { c, plan, res, final, mlArr };
}

function regionOk(cfg) {
  const reg = cfg.filters?.region;
  if (!reg || reg === 'all') return null;
  return (i) => G.meta.continents[G.country[i]] === reg;
}

function sortedCandidates(final, status, cfg) {
  const allow = [true, !!cfg.filters?.includeUnknown, false];
  const rf = regionOk(cfg);
  const idx = [];
  for (let i = 0; i < G.n; i++) {
    if (Number.isNaN(final[i]) || final[i] < (cfg.filters?.minMatch || 0) || !allow[status[i]]) continue;
    if (rf && !rf(i)) continue;
    idx.push(i);
  }
  idx.sort((a, b) => (status[a] - status[b]) || (final[b] - final[a]));
  return idx;
}

/** Greedy distinct sites: skip cells within `km` of one already chosen. */
function distinct(sorted, k, km = 250) {
  const out = [];
  for (const i of sorted) {
    let near = false;
    for (const j of out) if (distanceKm(G.lat[i], G.lon[i], G.lat[j], G.lon[j], 'earth') < km) { near = true; break; }
    if (!near) out.push(i);
    if (out.length >= k) break;
  }
  return out;
}

function baselineInfo(c, final, res, rankMap) {
  return (c.test.baseline || []).map((id) => {
    const cell = G.meta.analog_cells[id];
    const i = cell?.index;
    return {
      id, name: A[id].name, place: A[id].place, index: i, offsetKm: cell?.offset_km,
      representative: cell?.offset_km <= 60,
      score: final[i], rules: res.score[i], status: res.status[i], evidence: res.evidence[i], rank: rankMap.get(i) ?? null,
    };
  });
}

function paintScore(final, status, cfg) {
  const W = G.meta.grid.ncol, H = MERC_H;
  const img = new Uint8ClampedArray(W * H * 4);
  // colour by rank percentile among visible scored cells: the top 1% is always white-hot.
  const sorted = sortedCandidates(final, status, { ...cfg, filters: { ...cfg.filters, includeUnknown: false } });
  const rankPct = new Float32Array(G.n).fill(NaN);
  for (let r = 0; r < sorted.length; r++) rankPct[sorted[r]] = 1 - r / Math.max(1, sorted.length - 1);
  const rf = regionOk(cfg);
  const showUnknown = cfg.filters?.includeUnknown !== false;
  for (let y = 0; y < H; y++) {
    const row = G.rowMap[y];
    for (let x = 0; x < W; x++) {
      const i = G.cellToIndex[row * W + x];
      if (i < 0) continue;
      const o = (y * W + x) * 4;
      if (rf && !rf(i)) { img[o] = 6; img[o + 1] = 10; img[o + 2] = 20; img[o + 3] = 120; continue; }
      if (final[i] < (cfg.filters?.minMatch || 0)) continue;
      const st = status[i];
      if (st === STATUS.FAIL) { img[o] = 6; img[o + 1] = 9; img[o + 2] = 18; img[o + 3] = 95; continue; }
      if (st === STATUS.UNKNOWN || Number.isNaN(rankPct[i])) {
        if (!showUnknown) continue;
        const stripe = (x + y) % 6 < 2;
        img[o] = stripe ? 150 : 40; img[o + 1] = stripe ? 158 : 46; img[o + 2] = stripe ? 175 : 60; img[o + 3] = stripe ? 150 : 70;
        continue;
      }
      const t = rankPct[i];
      const [r, g, b, a] = ramp(t);
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = a;
    }
  }
  return { width: W, height: H, data: img };
}

// Earth blue → white. Low ranks fade out so the basemap reads through.
const STOPS = [[0, 20, 60, 160, 70], [0.5, 40, 100, 230, 150], [0.8, 90, 155, 255, 205], [0.95, 185, 215, 255, 235], [1, 255, 255, 255, 250]];
function ramp(t) {
  for (let k = 1; k < STOPS.length; k++) {
    if (t <= STOPS[k][0]) {
      const a = STOPS[k - 1], b = STOPS[k], u = (t - a[0]) / (b[0] - a[0]);
      return [0, 1, 2, 3].map((j) => a[j + 1] + (b[j + 1] - a[j + 1]) * u);
    }
  }
  return STOPS[STOPS.length - 1].slice(1);
}

function paintLayer(fid) {
  const W = G.meta.grid.ncol, H = MERC_H, j = G.cols[fid];
  const img = new Uint8ClampedArray(W * H * 4);
  if (j == null) return { width: W, height: H, data: img, empty: true };
  const qx = G.QX[j];
  for (let y = 0; y < H; y++) {
    const row = G.rowMap[y];
    for (let x = 0; x < W; x++) {
      const i = G.cellToIndex[row * W + x];
      if (i < 0) continue;
      const o = (y * W + x) * 4, t = qx[i];
      if (Number.isNaN(t)) {
        const stripe = (x + y) % 6 < 2;
        img[o] = stripe ? 150 : 40; img[o + 1] = stripe ? 158 : 46; img[o + 2] = stripe ? 175 : 60; img[o + 3] = 150; continue;
      }
      const [r, g, b] = ramp(t);
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 215;
    }
  }
  return { width: W, height: H, data: img, q: G.quant[fid] };
}

function siteRow(i, final, res, mlArr, rankMap, baseBest) {
  const nm = nameOf(i);
  return {
    i, id: G.ids[i], lat: G.lat[i], lon: G.lon[i], ...nm,
    score: final[i], rules: res.score[i], ml: mlArr ? mlArr[i] : null,
    evidence: res.evidence[i], status: res.status[i], warn: res.warn[i], rank: rankMap.get(i),
    beatsBaseline: baseBest != null && res.status[i] === STATUS.PASS && final[i] > baseBest,
    mlScored: mlArr ? !Number.isNaN(mlArr[i]) : null,
  };
}

async function score(cfg) {
  const { c, plan, res, final, mlArr } = await run(cfg);
  const sorted = sortedCandidates(final, res.status, cfg);
  const rankMap = new Map();
  sorted.forEach((i, r) => rankMap.set(i, r + 1));
  const base = baselineInfo(c, final, res, rankMap);
  const repr = base.filter((b) => b.representative && !Number.isNaN(b.score));
  const baseBest = repr.length ? Math.max(...repr.map((b) => b.score)) : null;
  const shown = cfg.filters?.beatsBaseline && baseBest != null ? sorted.filter((i) => final[i] > baseBest && res.status[i] === STATUS.PASS) : sorted;
  const top = shown.slice(0, 2000);
  const points = new Float32Array(top.length * 4);
  top.forEach((i, k) => { points[k * 4] = G.lon[i]; points[k * 4 + 1] = G.lat[i]; points[k * 4 + 2] = final[i]; points[k * 4 + 3] = i; });
  const list = distinct(shown, 60).map((i) => siteRow(i, final, res, mlArr, rankMap, baseBest));
  let counts = [0, 0, 0];
  for (let i = 0; i < G.n; i++) counts[res.status[i]]++;
  // envelope: how far Earth can go on each target feature
  const envelope = plan.targets.map((t) => {
    const col = G.cols[t.fid];
    const meta = col != null ? G.meta.columns[col] : null;
    return { fid: t.fid, w: t.w, dir: t.dir, tv: t.tv, min: meta?.min, max: meta?.max, beyond: t.beyond, pending: t.pending, targetUnknown: t.targetUnknown,
      best: list[0] && col != null ? G.X[col][list[0].i] : null };
  });
  let agreement = null;
  if (mlArr) {
    const rulesSorted = sortedCandidates(res.score, res.status, cfg);
    const mlOnly = new Float32Array(mlArr);
    const mlSorted = sortedCandidates(mlOnly, res.status, cfg);
    agreement = overlap(distinct(rulesSorted, 5), distinct(mlSorted, 5), 5);
  }
  let mlCount = 0;
  const mlIdx = [];
  if (mlArr) for (let i = 0; i < G.n; i++) if (!Number.isNaN(mlArr[i])) { mlCount++; mlIdx.push(i); }
  // Sparse models get their own list, ranked by the model score, whatever the ranking mode.
  const mlTop = mlCount && mlCount < G.n / 2 ? mlIdx.sort((a, b) => mlArr[b] - mlArr[a]).map((i) => siteRow(i, final, res, mlArr, rankMap, baseBest)) : [];
  const raster = paintScore(final, res.status, cfg);
  G.last = { cfg, plan, res, final, mlArr, rankMap, baseBest, base };
  return {
    transfer: [points.buffer, raster.data.buffer],
    value: { points, raster, list, counts, total: G.n, scored: sorted.length, baseline: base, baseBest, envelope, agreement,
      mlUsed: !!mlArr && cfg.rankBy !== 'rules', mlAvailable: !!mlArr, mlCount, mlSparse: !!mlArr && mlCount < G.n / 2, mlTop,
      planInfo: { checks: plan.checks.map(({ fid, op, v, hard, pending, user }) => ({ fid, op, v, hard, pending, user })), wTotal: plan.wTotal } },
  };
}

function valuesOf(i) {
  const out = {};
  for (const [fid, j] of Object.entries(G.cols)) out[fid] = G.X[j][i];
  return out;
}

async function detail({ cfg, i }) {
  let L = G.last;
  if (!L || JSON.stringify(L.cfg) !== JSON.stringify(cfg)) { await score(cfg); L = G.last; }
  const ex = explain(L.plan, G.X, G.QX, i, catalog);
  const best = L.base.filter((b) => b.representative).sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const baseEx = best ? explain(L.plan, G.X, G.QX, best.index, catalog) : null;
  const rank = L.rankMap.get(i) ?? null;
  const fullRank = (() => { const s = L.final[i]; if (Number.isNaN(s)) return null; let r = 1; for (let j = 0; j < G.n; j++) if (L.final[j] > s) r++; return r; })();
  return {
    value: {
      ...siteRow(i, L.final, L.res, L.mlArr, L.rankMap, L.baseBest), rankFiltered: rank, rankAll: fullRank, scoredTotal: L.rankMap.size,
      rows: ex.rows, checks: ex.checks, values: valuesOf(i), lstMeasured: !!G.lstMeasured[i],
      baseline: best ? { ...best, rows: baseEx.rows, values: valuesOf(best.index) } : null,
      baselineAll: L.base, baseBest: L.baseBest,
      mlStatus: !L.mlArr ? 'no-model' : Number.isNaN(L.mlArr[i]) ? 'not-analysed' : 'scored',
      mlDetail: L.mlArr ? ((await G.ml.details(cfg.testId, cfg.targetId)) || {})[String(G.ids[i])] || null : null,
    },
  };
}

/** Constraint mask: where the strict requirements pass (blue), fail (dim red) or are unknown (hatch). */
async function mask({ cfg }) {
  const { res } = await run(cfg);
  const W = G.meta.grid.ncol, H = MERC_H, img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const row = G.rowMap[y];
    for (let x = 0; x < W; x++) {
      const i = G.cellToIndex[row * W + x];
      if (i < 0) continue;
      const o = (y * W + x) * 4, st = res.status[i];
      if (st === STATUS.PASS) { img[o] = 76; img[o + 1] = 141; img[o + 2] = 255; img[o + 3] = 190; }
      else if (st === STATUS.FAIL) { img[o] = 252; img[o + 1] = 61; img[o + 2] = 33; img[o + 3] = 70; }
      else { const s = (x + y) % 6 < 2; img[o] = s ? 150 : 40; img[o + 1] = s ? 158 : 46; img[o + 2] = s ? 175 : 60; img[o + 3] = 150; }
    }
  }
  return { transfer: [img.buffer], value: { width: W, height: H, data: img, mask: true } };
}

async function layer({ fid }) {
  const r = paintLayer(fid);
  return { transfer: [r.data.buffer], value: r };
}

async function stability({ cfg, trials = 40, jitter = 0.3 }) {
  const c = cfgFor(cfg);
  const base = await run(cfg);
  const ref = distinct(sortedCandidates(base.final, base.res.status, cfg), 5);
  const rng = mulberry32(7);
  let winnerKept = 0, overlapSum = 0;
  const freq = new Map();
  for (let t = 0; t < trials; t++) {
    const weights = {};
    for (const [fid, spec] of Object.entries(c.test.target)) {
      const w = cfg.weights?.[fid] ?? spec.w;
      weights[fid] = w * (1 - jitter + 2 * jitter * rng());
    }
    const r = await run({ ...cfg, weights });
    const top = distinct(sortedCandidates(r.final, r.res.status, cfg), 5);
    if (top[0] === ref[0]) winnerKept++;
    overlapSum += overlap(ref, top, 5);
    for (const i of top) freq.set(i, (freq.get(i) || 0) + 1);
  }
  return {
    value: {
      trials, jitter, winnerKept: winnerKept / trials, meanOverlap: overlapSum / trials,
      ref: ref.map((i) => ({ i, ...nameOf(i), lat: G.lat[i], lon: G.lon[i], freq: (freq.get(i) || 0) / trials })),
    },
  };
}

/** Multi-site coverage for the current configuration (see scoring.coverGreedy). */
async function coverage({ cfg, maxSites = 5, km = 250 }) {
  const { plan, res, final } = await run(cfg);
  const rf = regionOk(cfg);
  const out = coverGreedy(plan, G.QX, res.status, G.n, {
    maxSites, score: final, eligible: rf,
    tooClose: (i, chosen) => chosen.some((j) => distanceKm(G.lat[i], G.lon[i], G.lat[j], G.lon[j], 'earth') < km),
  });
  return { value: { ...out, km, steps: out.steps.map((s) => ({ ...s, ...nameOf(s.i), lat: G.lat[s.i], lon: G.lon[s.i], score: final[s.i] })) } };
}

async function validateRules({ mode = 'stress' }) {
  const out = [];
  for (const t of Object.values(tests)) {
    const targetId = t.bodies.includes('moon') ? 'connecting-ridge' : 'jezero';
    const r = await run({ testId: t.id, targetId, mode, rankBy: 'rules', filters: { minEvidence: 0, includeUnknown: true } });
    const scored = [];
    for (let i = 0; i < G.n; i++) if (!Number.isNaN(r.res.score[i])) scored.push(r.res.score[i]);
    scored.sort((a, b) => a - b);
    const sites = t.baseline.map((id) => {
      const cell = G.meta.analog_cells[id];
      const s = r.res.score[cell.index];
      let below = 0;
      for (const v of scored) { if (v < s) below++; else break; }
      return { id, name: A[id].name, offsetKm: cell.offset_km, representative: cell.offset_km <= 60,
        percentile: Number.isNaN(s) ? null : (100 * below) / scored.length, status: r.res.status[cell.index] };
    });
    out.push({ testId: t.id, targetId, sites });
  }
  return { value: out };
}

function nearest({ lat, lon }) {
  const { grid } = G.meta;
  const r0 = Math.floor((90 - lat) / grid.cell_deg), c0 = Math.floor((lon + 180) / grid.cell_deg);
  let best = -1, bestD = Infinity;
  for (let rad = 0; rad <= 4 && best < 0; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const r = r0 + dr, c = ((c0 + dc) % grid.ncol + grid.ncol) % grid.ncol;
      if (r < 0 || r >= grid.nrow) continue;
      const i = G.cellToIndex[r * grid.ncol + c];
      if (i < 0) continue;
      const d = distanceKm(lat, lon, G.lat[i], G.lon[i], 'earth');
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return { value: best < 0 ? null : { i: best, km: bestD } };
}

async function scoreSites({ cfg, sites }) {
  const c = cfgFor(cfg);
  const plan = compile(c, catalog, G.quant, G.cols);
  const m = sites.length;
  const X = G.meta.columns.map(() => new Float32Array(m).fill(NaN));
  const QX = G.meta.columns.map(() => new Float32Array(m).fill(NaN));
  const meta = [];
  sites.forEach((s, k) => {
    const nn = nearest({ lat: s.lat, lon: s.lon }).value;
    meta.push({ cell: nn?.i ?? null, km: nn?.km ?? null });
    G.meta.columns.forEach((col, j) => {
      const own = s.values?.[col.id];
      const v = own != null && !Number.isNaN(own) ? own : nn && nn.km < 60 ? G.X[j][nn.i] : NaN;
      X[j][k] = v;
      QX[j][k] = percentile(v, col.q);
    });
  });
  const res = scoreAll(plan, X, QX, m);
  return {
    value: sites.map((s, k) => ({ ...s, score: res.score[k], evidence: res.evidence[k], status: res.status[k], warn: res.warn[k], cell: meta[k].cell, cellKm: meta[k].km,
      resolvedValues:Object.fromEntries(G.meta.columns.map((col,j)=>[col.id,Number.isFinite(X[j][k])?X[j][k]:null])), ex: explain(plan, X, QX, k, catalog) })),
  };
}

function rows({ indices }) {
  return { value: indices.map((i) => ({ i, id: G.ids[i], lat: G.lat[i], lon: G.lon[i], ...nameOf(i), values: valuesOf(i) })) };
}

const byId = ({ id }) => ({ value: G.cellToIndex[id] ?? -1 });
const HANDLERS = { init, score, detail, layer, mask, stability, coverage, validateRules, nearest, scoreSites, rows, byId };

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type !== 'init' && !G.ready) throw new Error('index not loaded');
    const out = await HANDLERS[type](payload || {});
    const isWrapped = out && typeof out === 'object' && 'value' in out;
    self.postMessage({ id, ok: true, result: isWrapped ? out.value : out }, isWrapped && out.transfer ? out.transfer : []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
