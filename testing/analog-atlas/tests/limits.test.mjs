/**
 * Thresholds, their NASA references, and their NASA-site exceptions.
 *
 * If you change a limit on purpose: update PINNED below, re-run `python ml/validate_limits.py`
 * and `node scripts/threshold-table.mjs`, and say why in the limit's `basis`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, scoreAll, passes, STATUS, SOFT_PENALTY } from '../src/lib/scoring.js';
import { buildTable, engineLimits } from '../scripts/threshold-table.mjs';
import { loadAll } from './helpers.mjs';

const J = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const missions = J('src/config/missions.json');
const checks = J('src/config/limit_checks.json');
const meta = J('public/data/earth_index.meta.json');
const S = missions.sources;
const LIMITS = missions.systems.flatMap((s) => s.tests.flatMap((t) => Object.entries(t.interference || {}).map(([fid, l]) => ({ t, fid, l }))));
const CHECK = Object.fromEntries(checks.checks.map((c) => [`${c.test_id}|${c.feature}`, c]));

// ---------------------------------------------------------------- 1. the threshold table itself

/** Every website limit: "test|feature": [op, value, strict]. Changing one must be deliberate. */
const PINNED = {
  'ltv.wheels|snow_mo': ['<=', 9, true], 'ltv.wheels|ndvi': ['<=', 0.3, true], 'ltv.wheels|precip_mm': ['<=', 250, false],
  'ltv.nav|ndvi': ['<=', 0.25, true], 'ltv.nav|snow_mo': ['<=', 6, false], 'ltv.nav|dust_ug': ['<=', 60, false],
  'ltv.comms|ndvi': ['<=', 0.3, false],
  'ltv.thermal|precip_mm': ['<=', 250, true], 'ltv.thermal|snow_mo': ['<=', 6, false],
  'ltv.dust|precip_mm': ['<=', 250, true], 'ltv.dust|ndvi': ['<=', 0.25, true],
  'eva.boots|snow_mo': ['<=', 9, true], 'eva.boots|ndvi': ['<=', 0.3, true], 'eva.boots|precip_mm': ['<=', 250, false],
  'eva.lights|ndvi': ['<=', 0.3, true],
  'eva.suitdust|precip_mm': ['<=', 250, true], 'eva.suitdust|ndvi': ['<=', 0.25, true],
  'isru.intake|precip_mm': ['<=', 250, true], 'isru.intake|ndvi': ['<=', 0.25, false],
  'isru.icedig|precip_mm': ['<=', 400, false], 'isru.icedig|ndvi': ['<=', 0.3, false],
  'isru.drill|precip_mm': ['<=', 250, false],
  'isru.water|ndvi': ['<=', 0.25, true],
  'isru.regolith|precip_mm': ['<=', 250, true], 'isru.regolith|ndvi': ['<=', 0.3, true], 'isru.regolith|snow_mo': ['<=', 9, true],
  'hab.thermal|precip_mm': ['<=', 250, true], 'hab.thermal|snow_mo': ['<=', 6, false],
  'hab.ground|snow_mo': ['<=', 6, false], 'hab.ground|precip_mm': ['<=', 400, false],
  'hab.solar|precip_mm': ['<=', 500, false], 'hab.solar|ndvi': ['<=', 0.3, false],
  'hab.fission|precip_mm': ['<=', 250, false], 'hab.fission|ndvi': ['<=', 0.3, false],
  'sci.spectro|ndvi': ['<=', 0.25, true], 'sci.spectro|precip_mm': ['<=', 500, false],
  'land.hazards|ndvi': ['<=', 0.25, true], 'land.hazards|snow_mo': ['<=', 9, true],
};

test('threshold table: every website limit matches the pinned table, and nothing extra exists', () => {
  const live = Object.fromEntries(LIMITS.map(({ t, fid, l }) => [`${t.id}|${fid}`, [l.op, l.v, !!l.hard]]));
  assert.deepEqual(live, PINNED);
  assert.equal(LIMITS.length, 38);
});

test('threshold table: tests without limits are exactly crew operations and astrobiology', () => {
  const none = missions.systems.flatMap((s) => s.tests).filter((t) => !Object.keys(t.interference || {}).length).map((t) => t.id).sort();
  assert.deepEqual(none, ['eva.crewops', 'sci.astrobio']);
});

test('threshold table: engine limits read from KNN-Model/config/missions.yaml match the pinned values', () => {
  const e = engineLimits();
  const by = (m) => Object.fromEntries(e.filter((x) => x.mission === m).map((x) => [`${x.feature}:${x.rule}`, x.v]));
  const land = { tree_frac: 0.3, cropland_frac: 0.2, builtup_frac: 0.1, snow_ice_frac: 0.1, water_frac: 0.05 };
  const lc = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`${k}:max`, v]));
  const rover = { ...lc(land), 'slope_p90:max_abs_diff': 5, 'frac_steep:max_abs_diff': 0.1, 'rough_small:max_abs_diff': 3 };
  assert.deepEqual(by('moon_rover_south_pole'), rover);
  assert.deepEqual(by('moon_rover_mons_mouton'), rover);
  assert.deepEqual(by('moon_landing_hazards_south_pole'), { 'tree_frac:max': 0.2, 'builtup_frac:max': 0.1, 'snow_ice_frac:max': 0.1, 'water_frac:max': 0.05, 'pit_density:max_abs_diff': 0.5, 'relief:max_abs_diff': 150 });
  assert.deepEqual(by('moon_rover_thermal_south_pole'), { ...lc(land), 'slope_p90:max_abs_diff': 5, 'temp_range_mean:min': 60 });
});

test('threshold table: docs/THRESHOLDS.md and docs/thresholds.csv are up to date', () => {
  const { md, csv } = buildTable();
  assert.equal(readFileSync(new URL('../docs/THRESHOLDS.md', import.meta.url), 'utf8'), md, 'run: node scripts/threshold-table.mjs');
  assert.equal(readFileSync(new URL('../docs/thresholds.csv', import.meta.url), 'utf8'), csv, 'run: node scripts/threshold-table.mjs');
});

// ---------------------------------------------------------------- 2. every limit is referenced

test('references: every limit cites at least one source, and every cited id exists', () => {
  for (const { t, fid, l } of LIMITS) {
    assert.ok(Array.isArray(l.src) && l.src.length, `${t.id} ${fid} has no src`);
    for (const id of l.src) assert.ok(S[id], `${t.id} ${fid} cites unknown source ${id}`);
    assert.ok(l.basis && l.basis.length > 20, `${t.id} ${fid} has no basis`);
  }
});

test('references: every source has a citation, an https link and a quote of what it says', () => {
  for (const [id, s] of Object.entries(S)) {
    assert.ok(s.cite?.length > 10, `${id} cite`);
    assert.match(s.url, /^https:\/\//, `${id} url`);
    assert.ok(s.says?.length > 20, `${id} says`);
  }
});

test('references: each limit with a NASA number cites the NASA document that gives it', () => {
  const need = { 'ndvi|0.25': 'nasa-eo-ndvi', 'ndvi|0.3': 'nasa-eo-ndvi', 'precip_mm|250': 'nasa-biome-desert', 'snow_mo|9': 'mcd12q1-igbp' };
  for (const { t, fid, l } of LIMITS) {
    const id = need[`${fid}|${l.v}`];
    if (id) assert.ok(l.src.includes(id), `${t.id} ${fid} ${l.v} must cite ${id}`);
  }
});

test('references: limits without a NASA number say so plainly (no hidden "team values")', () => {
  const noNasaNumber = new Set(['snow_mo|6', 'precip_mm|400', 'precip_mm|500', 'dust_ug|60']);
  for (const { t, fid, l } of LIMITS) {
    assert.ok(!/team value/i.test(l.basis), `${t.id} ${fid} still says "team value"`);
    if (noNasaNumber.has(`${fid}|${l.v}`)) {
      assert.match(l.basis, /No NASA dataset sets this number/, `${t.id} ${fid} ${l.v}`);
      assert.ok(!l.hard, `${t.id} ${fid} ${l.v}: a limit without a NASA number must not be strict`);
    }
  }
});

test('references: the verified NASA quotes are carried word for word', () => {
  const has = (id, frag) => assert.ok(S[id].says.includes(frag), `${id} should quote: ${frag}`);
  has('nasa-eo-ndvi', 'Moderate values represent shrub and grassland (0.2 to 0.3)');
  has('nasa-eo-ndvi', 'real vegetation is much more varied');
  has('nasa-biome-desert', 'Deserts get about 250 millimeters (10 inches) of rain per year');
  has('nasa-biome-desert', 'Most deserts receive less than 300 mm a year');
  has('mcd12q1-igbp', 'At least 60% of area is covered by snow and ice for at least 10 months of the year');
  has('mcd12q1-igbp', 'Tree cover 10-30% (canopy >2m)');
  has('nasa-power-merra2', 'between 42.5º and 62.5º latitude');
  has('nasa-field-seasons', 'week-long moonwalk simulation');
  has('nasa-field-seasons', '2 weeks of consecutive field-testing');
  has('viper-ops', 'VIPER can generally drive on a slope of up to 15 degrees.');
  has('mod10-snow', 'snow cover always has an NDSI > 0 but not all features with NDSI > 0 are snow');
});

test('references: known conflicts in the sources are stated on the limits they affect', () => {
  for (const { t, fid, l } of LIMITS) {
    if (fid === 'precip_mm' && l.v === 250) assert.match(l.basis, /less than 300 mm/, `${t.id}: NASA's 250 vs 300 mm conflict`);
    if (fid === 'ndvi') assert.match(l.basis, /representative/, `${t.id}: NASA NDVI values are representative; layer is the yearly maximum`);
  }
});

// ---------------------------------------------------------------- 3. how the scorer applies a limit

test('boundaries: a value exactly at the limit passes; just over fails; missing is unknown', () => {
  assert.equal(passes(250, '<=', 250), true);
  assert.equal(passes(250.0001, '<=', 250), false);
  assert.equal(passes(9, '<=', 9), true);
  assert.equal(passes(10, '<=', 9), false);
  assert.equal(passes(0.3, '<=', 0.3), true);
  assert.equal(passes(0.3001, '<=', 0.3), false);
  assert.equal(passes(60, '>=', 60), true);
  assert.equal(passes(59.9, '>=', 60), false);
  assert.equal(passes(NaN, '<=', 250), null);
  assert.equal(passes(null, '<=', 250), null);
});

/** One-feature synthetic index: column 0 scores (perfect match), column 1 = the limited value. */
function synth(values, check) {
  const n = values.length;
  const X = [new Float32Array(n).fill(0.5), Float32Array.from(values)];
  const QX = [new Float32Array(n).fill(0.5), new Float32Array(n)];
  const plan = { targets: [{ fid: 'slope_deg', w: 1, dir: 'match', qt: 0.5, col: 0, pending: false, targetUnknown: false }],
    checks: [{ fid: 'precip_mm', op: '<=', v: 250, hard: true, col: 1, pending: false, ...check }], wTotal: 1, minEvidence: 0.5 };
  return scoreAll(plan, X, QX, n);
}

test('scoring: breaking a strict limit marks the site "Fails a limit"; the limit itself passes', () => {
  const r = synth([249, 250, 251, NaN], { hard: true });
  assert.deepEqual([...r.status], [STATUS.PASS, STATUS.PASS, STATUS.FAIL, STATUS.UNKNOWN]);
});

test('scoring: breaking a soft limit multiplies the score by 0.75 and adds one warning', () => {
  assert.equal(SOFT_PENALTY, 0.75);
  const r = synth([250, 251, NaN], { hard: false });
  assert.equal(r.score[0], 1);
  assert.ok(Math.abs(r.score[1] - 0.75) < 1e-6);
  assert.deepEqual([...r.warn], [0, 1, 0]);
  assert.equal(r.status[1], STATUS.PASS, 'a soft limit never fails a site');
  assert.equal(r.score[2], 1, 'missing data on a soft limit gives no penalty and no pass/fail');
});

test('scoring: two broken soft limits compound (0.75 x 0.75)', () => {
  const n = 1;
  const X = [new Float32Array([0.5]), new Float32Array([300]), new Float32Array([8])];
  const QX = [new Float32Array([0.5]), new Float32Array(1), new Float32Array(1)];
  const plan = { targets: [{ fid: 'slope_deg', w: 1, dir: 'match', qt: 0.5, col: 0, pending: false, targetUnknown: false }],
    checks: [{ fid: 'precip_mm', op: '<=', v: 250, hard: false, col: 1, pending: false }, { fid: 'snow_mo', op: '<=', v: 6, hard: false, col: 2, pending: false }], wTotal: 1, minEvidence: 0.5 };
  const r = scoreAll(plan, X, QX, n);
  assert.ok(Math.abs(r.score[0] - 0.5625) < 1e-6);
  assert.equal(r.warn[0], 2);
});

test('scoring: the compiled plan uses exactly the pinned limits for every test', () => {
  const D = loadAll();
  for (const { t } of LIMITS.filter((x, i, a) => a.findIndex((y) => y.t.id === x.t.id) === i)) {
    const target = Object.values(D.T).find((g) => t.bodies.includes(g.body));
    const plan = compile({ test: D.tests[t.id], target, mode: 'stress', filters: { minEvidence: 0.5 } }, D.catalog, D.quant, D.cols);
    const got = Object.fromEntries(plan.checks.map((c) => [`${t.id}|${c.fid}`, [c.op, c.v, c.hard]]));
    const want = Object.fromEntries(Object.entries(PINNED).filter(([k]) => k.startsWith(t.id + '|')));
    assert.deepEqual(got, want, t.id);
  }
});

// ---------------------------------------------------------------- 4. the NASA precedent-site check

test('precedent check: limit_checks.json covers every limit with the same value (not stale)', () => {
  assert.equal(checks.checks.length, LIMITS.length);
  for (const { t, fid, l } of LIMITS) {
    const c = CHECK[`${t.id}|${fid}`];
    assert.ok(c, `${t.id} ${fid} not checked: run python ml/validate_limits.py`);
    assert.deepEqual([c.op, c.v, c.hard], [l.op, l.v, !!l.hard], `${t.id} ${fid} changed since the check: re-run it`);
    assert.deepEqual(c.precedents.map((p) => p.site), t.baseline, `${t.id} ${fid} precedents`);
  }
});

test('precedent check: a site counts only when its index cell is within 60 km', () => {
  for (const c of checks.checks) for (const p of c.precedents) {
    assert.equal(p.representative, meta.analog_cells[p.site].offset_km <= 60, `${c.test_id} ${p.site}`);
  }
});

test('precedent check: cell values match the current Earth index', () => {
  const D = loadAll();
  for (const c of checks.checks) for (const p of c.precedents) {
    const x = D.X[D.cols[c.feature]][meta.analog_cells[p.site].index];
    if (p.cell == null) { assert.ok(Number.isNaN(x)); continue; }
    assert.ok(Math.abs(x - p.cell) <= Math.max(0.01, Math.abs(p.cell) * 0.005), `${c.test_id} ${c.feature} ${p.site}: index ${x} vs checked ${p.cell}`);
  }
});

test('precedent check: snow months at the field site use NASA\'s 60% permanent-snow line', () => {
  assert.match(checks.method, /mean cover >= 60%/);
});

test('exceptions: every disagreement with a NASA site is listed, tagged by kind, never dropped', () => {
  const kinds = { 'field-site': 0, 'cell-only': 0, cell: 0 };
  for (const c of checks.checks) {
    const ok = (v) => (v == null ? null : c.op === '<=' ? v <= c.v : v >= c.v);
    for (const p of c.precedents) {
      const e = c.exceptions.find((x) => x.site === p.site);
      const expect = !p.representative ? null
        : ok(p.site_scale) === false ? 'field-site'
        : ok(p.cell) === false && ok(p.site_scale) === true ? 'cell-only'
        : ok(p.cell) === false ? 'cell' : null;
      assert.equal(e?.kind ?? null, expect, `${c.test_id} ${c.feature} ${p.site}`);
      if (e) kinds[e.kind]++;
    }
  }
  assert.deepEqual(kinds, { 'field-site': 10, 'cell-only': 6, cell: 16 });
});

test('exceptions: known NASA cases are tagged correctly', () => {
  const ex = (t, f, s) => CHECK[`${t}|${f}`].exceptions.find((e) => e.site === s);
  // Holuhraun: fails snow on its 55 km cell (glacier) but passes at the lava field.
  assert.deepEqual([ex('ltv.wheels', 'snow_mo', 'holuhraun').kind, ex('ltv.wheels', 'snow_mo', 'holuhraun').cell, ex('ltv.wheels', 'snow_mo', 'holuhraun').site_scale], ['cell-only', 10, 6]);
  // San Francisco Volcanic Field: vegetation over the limit even at 1 km.
  assert.equal(ex('land.hazards', 'ndvi', 'sf-volcanic-field').kind, 'field-site');
  assert.ok(ex('land.hazards', 'ndvi', 'sf-volcanic-field').site_scale > 0.25);
  // Mojave passes on its cell (0.22) but not at the field site (0.28).
  assert.equal(ex('ltv.nav', 'ndvi', 'mojave').kind, 'field-site');
  assert.ok(ex('ltv.nav', 'ndvi', 'mojave').cell <= 0.25 && ex('ltv.nav', 'ndvi', 'mojave').site_scale > 0.25);
  // McMurdo is chosen for cold: snow over 6 months is a NASA exception for thermal tests.
  assert.equal(ex('ltv.thermal', 'snow_mo', 'mcmurdo-dry-valleys').kind, 'field-site');
  // Rain has no field-site data, so rain exceptions are "cell, unverified".
  for (const c of checks.checks.filter((x) => x.feature === 'precip_mm')) for (const e of c.exceptions) assert.equal(e.kind, 'cell');
  // Not representative (index cell 172 km away): Lanzarote is never counted.
  assert.ok(!checks.checks.some((c) => c.exceptions.some((e) => e.site === 'lanzarote')));
});

test('exceptions: strict limits are kept strict; Holuhraun still shows "Fails a limit" in the app', () => {
  const D = loadAll();
  const plan = compile({ test: D.tests['ltv.wheels'], target: D.T['connecting-ridge'], mode: 'stress', filters: { minEvidence: 0 } }, D.catalog, D.quant, D.cols);
  const r = scoreAll(plan, D.X, D.QX, D.n);
  assert.equal(r.status[meta.analog_cells.holuhraun.index], STATUS.FAIL);
  assert.ok(CHECK['ltv.wheels|snow_mo'].exceptions.some((e) => e.site === 'holuhraun'), 'and it is tagged as an exception');
});

test('exceptions: every exception has a reason or is a rain cell without field-site data', () => {
  for (const c of checks.checks) for (const e of c.exceptions) {
    assert.ok(e.reason || e.kind === 'cell', `${c.test_id} ${c.feature} ${e.site} needs a reason in ml/validate_limits.py NOTES`);
  }
});
