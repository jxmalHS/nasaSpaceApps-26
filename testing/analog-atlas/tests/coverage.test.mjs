// Multi-site coverage (scoring.coverGreedy) and the measured target terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, scoreAll, coverGreedy, featureSim, COVER_SIM, STATUS, SIM_SIGMA } from '../src/lib/scoring.js';
import { loadAll } from './helpers.mjs';

const D = loadAll();
const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

// Two target features (a, b) on percentile columns; four cells.
function synthetic(qa, qb, status) {
  const plan = { targets: [
    { fid: 'a', w: 1, dir: 'match', qt: 0.5, col: 0, pending: false, targetUnknown: false, beyond: null },
    { fid: 'b', w: 1, dir: 'match', qt: 0.5, col: 1, pending: false, targetUnknown: false, beyond: null },
    { fid: 'c', w: 1, dir: 'match', qt: NaN, col: 2, pending: true, targetUnknown: false },
  ] };
  return { plan, QX: [Float32Array.from(qa), Float32Array.from(qb), new Float32Array(qa.length).fill(NaN)], status: Uint8Array.from(status) };
}

test('coverage threshold = one kernel width (12 Earth-percentile points)', () => {
  assert.ok(Math.abs(featureSim(0.5 + SIM_SIGMA, 0.5, 'match') - COVER_SIM) < 1e-9);
  assert.ok(featureSim(0.5 + SIM_SIGMA * 0.99, 0.5, 'match') >= COVER_SIM);
  assert.ok(featureSim(0.5 + SIM_SIGMA * 1.01, 0.5, 'match') < COVER_SIM);
});

test('conditions must hold together at one cell that passes every strict limit', () => {
  // cell 0: a only; cell 1: b only; cell 2: a+b but FAILS a strict limit; cell 3: a+b but unverified
  const { plan, QX, status } = synthetic([0.5, 0.0, 0.5, 0.5], [0.0, 0.5, 0.5, 0.5],
    [STATUS.PASS, STATUS.PASS, STATUS.FAIL, STATUS.UNKNOWN]);
  const cv = coverGreedy(plan, QX, status, 4, { score: Float32Array.from([0.9, 0.8, 1, 1]) });
  assert.deepEqual(cv.steps.map((s) => s.i), [0, 1]);               // needs two sites, never 2 or 3
  assert.deepEqual(cv.steps.map((s) => s.adds), [['a'], ['b']]);
  assert.equal(cv.nRequirements, 2);
  assert.deepEqual(cv.notCovered, []);
  assert.deepEqual(cv.unmeasurable, [{ fid: 'c', why: 'no-earth-layer' }]);
});

test('greedy prefers more new requirements, then the higher score, and respects spacing', () => {
  const { plan, QX, status } = synthetic([0.5, 0.5, 0.5], [0.5, 0.5, 0.0], [0, 0, 0]);
  const cv = coverGreedy(plan, QX, status, 3, { score: Float32Array.from([0.4, 0.7, 0.99]) });
  assert.deepEqual(cv.steps.map((s) => s.i), [1]);                   // covers both; beats cell 0 on score
  const far = coverGreedy(plan, QX, status, 3, { score: Float32Array.from([0.4, 0.7, 0.99]), tooClose: (i) => i === 1 });
  assert.equal(far.steps[0].i, 0);
});

test('what no site covers is reported, never hidden', () => {
  const { plan, QX, status } = synthetic([0.5, 0.5], [0.0, 0.1], [0, 0]);
  const cv = coverGreedy(plan, QX, status, 2);
  assert.equal(cv.steps.length, 1);
  assert.deepEqual(cv.notCovered.map((x) => x.fid), ['b']);
});

test('real index: wheels at Jezero needs few sites and every step adds something new', () => {
  const plan = compile({ test: D.tests['ltv.wheels'], target: D.T.jezero, mode: 'realism', filters: { minEvidence: 0.5 } }, D.catalog, D.quant, D.cols);
  const r = scoreAll(plan, D.X, D.QX, D.n);
  const cv = coverGreedy(plan, D.QX, r.status, D.n, { score: r.score });
  assert.ok(cv.steps.length >= 1 && cv.steps.length <= 5);
  const seen = new Set();
  for (const s of cv.steps) {
    assert.equal(r.status[s.i], STATUS.PASS);
    assert.ok(s.adds.length > 0);
    for (const f of s.adds) { assert.ok(!seen.has(f)); seen.add(f); }
  }
  // rock abundance and soil strength have no Earth layer yet: listed, not silently dropped
  assert.deepEqual(cv.unmeasurable.map((x) => x.fid).sort(), ['rock_pct', 'soil_kPa']);
});

test('target slope/roughness are measured from NASA DEMs at the Earth index scale', () => {
  const m = readJson('../pipeline/target_terrain.json');
  const cal = readJson('../pipeline/target_terrain_calibration.json');
  assert.equal(cal.calibration.rough_m.n_cells, 12);
  assert.ok(cal.calibration.rough_m.r > 0.9, 'roughness method must track the Earth index');
  for (const t of Object.values(D.T)) {
    for (const f of ['slope_deg', 'rough_m']) {
      const v = t.f[f];
      assert.equal(v.s, 'measured', `${t.id} ${f}`);
      assert.equal(v.v, m.targets[t.id][f], `${t.id} ${f} matches pipeline/target_terrain.json`);
      assert.match(v.src, t.body === 'mars' ? /MOLA/ : /LOLA/);
    }
  }
});
