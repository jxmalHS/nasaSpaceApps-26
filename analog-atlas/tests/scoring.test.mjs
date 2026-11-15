import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passes, compile, scoreAll, percentile, featureSim, STATUS, overlap } from '../src/lib/scoring.js';
import { loadAll } from './helpers.mjs';

const D = loadAll();
const run = (testId, targetId, extra = {}) => {
  const plan = compile({ test: D.tests[testId], target: D.T[targetId], mode: 'stress', filters: { minEvidence: 0.5 }, ...extra }, D.catalog, D.quant, D.cols);
  return { plan, r: scoreAll(plan, D.X, D.QX, D.n) };
};

test('percentile maps the Earth range onto 0..1 and clips beyond it', () => {
  const q = D.quant.lst_dtr_K;
  assert.equal(percentile(q[0] - 10, q), 0);
  assert.equal(percentile(q[100] + 10, q), 1);
  assert.ok(Math.abs(percentile(q[50], q) - 0.5) < 0.011);
});

test('stress direction: exceeding the target in the stress direction is a full match', () => {
  assert.equal(featureSim(0.9, 0.6, 'high'), 1);
  assert.ok(featureSim(0.3, 0.6, 'high') < 0.1);
  assert.ok(featureSim(0.3, 0.6, 'match') < 0.1);
});

test('unknown is never a pass: missing data on a strict limit makes a site unverified', () => {
  const { r } = run('ltv.wheels', 'mons-mouton-plateau');
  const snow = D.cols.snow_mo;
  let checked = 0;
  for (let i = 0; i < D.n && checked < 50; i++) if (Number.isNaN(D.X[snow][i])) { assert.notEqual(r.status[i], STATUS.PASS); checked++; }
  assert.ok(checked > 0, 'index has cells with unknown snow');
});

test('pending features count against evidence but never score', () => {
  const { plan, r } = run('ltv.wheels', 'mons-mouton-plateau');
  const pending = plan.targets.filter((t) => t.pending).reduce((a, t) => a + t.w, 0);
  const maxEv = 1 - pending / plan.wTotal;
  for (let i = 0; i < D.n; i += 997) assert.ok(r.evidence[i] <= maxEv + 1e-6);
});

test('a strict limit that fails excludes the site', () => {
  const { r } = run('ltv.thermal', 'connecting-ridge');
  const p = D.cols.precip_mm;
  for (let i = 0; i < D.n; i += 401) if (D.X[p][i] > 250) assert.equal(r.status[i], STATUS.FAIL);
});

test('ignored features do not change the score', () => {
  const a = run('ltv.wheels', 'mons-mouton-plateau').r.score;
  const b = run('ltv.wheels', 'mons-mouton-plateau', { roles: { t_mean_C: 'ignore' } }).r.score;
  for (let i = 0; i < D.n; i += 503) assert.ok(Number.isNaN(a[i]) ? Number.isNaN(b[i]) : a[i] === b[i]);
});

test('unknown target value in stress mode aims for Earth extreme, in realism mode it is unknown', () => {
  const s = run('isru.intake', 'jezero').plan.targets.find((t) => t.fid === 'dust_ug');
  assert.equal(s.assumed, true);
  const m = run('isru.intake', 'jezero', { mode: 'realism' }).plan.targets.find((t) => t.fid === 'dust_ug');
  assert.equal(m.targetUnknown, true);
});

test('overlap counts shared top-k members', () => {
  assert.equal(overlap([1, 2, 3, 4, 5], [5, 4, 9, 8, 7]), 0.4);
});

test('scoring the whole index stays fast enough for live sliders', () => {
  const t0 = performance.now();
  for (let k = 0; k < 5; k++) run('hab.thermal', 'connecting-ridge');
  assert.ok((performance.now() - t0) / 5 < 150);
});

import { validMeasurement } from '../src/lib/csv.js';

test('inclusive limits at Earth storage precision', () => {
  for (const op of ['<=', '>=']) assert.equal(passes(Math.fround(0.3), op, 0.3), true);
  assert.equal(passes(0.3001, '<=', 0.3), false);
  assert.equal(passes(0.2999, '>=', 0.3), false);
});

test('uploaded measurements respect their physical units', () => {
  assert.equal(validMeasurement('slope_deg', 91), false);
  assert.equal(validMeasurement('pressure_kPa', -1), false);
  assert.equal(validMeasurement('ndvi', -0.5), true);
  assert.equal(validMeasurement('elev_m', -10), true);
  assert.equal(validMeasurement('basalt', 1.1), false);
});
