// Results list: the 2 km terrain check badge for the top sites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { localCheckLabel } from '../src/lib/localCheck.js';

test('Khorugh (31.5° vs 9.0°) is flagged 3.5× steeper', () => {
  assert.deepEqual(localCheckLabel({ slopeMean: 31.5 }, { slopeMean: 9 }), { ok: false, text: '2 km: 3.5× steeper than target' });
});
test('a flat desert cell (0.5° vs 9.0°) is flagged flatter', () => {
  assert.equal(localCheckLabel({ slopeMean: 0.5 }, { slopeMean: 9 }).text, '2 km: 18.0× flatter than target');
});
test('a close match is OK; missing terrain gives no badge', () => {
  assert.equal(localCheckLabel({ slopeMean: 10 }, { slopeMean: 9 }).ok, true);
  assert.equal(localCheckLabel(null, { slopeMean: 9 }), null);
});

import { spotsAround, combineSpots, orderByCheck } from '../src/lib/localCheck.js';

test('5 spots: centre plus 15 km N, S, E, W', () => {
  const s = spotsAround(36.75, 71.75);
  assert.equal(s.length, 5);
  assert.deepEqual(s[0], [36.75, 71.75]);
  assert.ok(Math.abs(s[1][0] - 36.75 - 15 / 111.32) < 1e-3);           // north
  assert.ok(s[3][1] > 71.75 && s[4][1] < 71.75);                       // east, west
  assert.ok(spotsAround(10, 179.99)[3][1] < -179);                      // wraps the date line
});

test('a cell passes if ANY spot matches; else reports how far off it is', () => {
  const t = { slopeMean: 9 };
  assert.deepEqual(combineSpots([{ slopeMean: 31 }, { slopeMean: 10 }, { slopeMean: 30 }, null, { slopeMean: 28 }], t),
    { ok: true, matches: 1, n: 4, text: '2 km: 1 of 4 spots match' });
  const bad = combineSpots([{ slopeMean: 31.5 }, { slopeMean: 30 }, { slopeMean: 33 }, { slopeMean: 29 }, { slopeMean: 35 }], t);
  assert.equal(bad.ok, false); assert.match(bad.text, /0 of 5 spots match \(3\.5× steeper\)/);
  assert.equal(combineSpots([null, null], t), null);                    // no terrain: no badge
});

test('order: matching first, unchecked next, no-match last; same order inside groups', () => {
  const list = [1, 2, 3, 4, 5].map((id) => ({ id }));
  const checks = { 1: { ok: false }, 2: { ok: true }, 3: { ok: false }, 4: { ok: true } };
  assert.deepEqual(orderByCheck(list, checks).map((x) => x.id), [2, 4, 5, 1, 3]);
});

import { siteVerdict } from '../src/lib/localCheck.js';

test('one verdict per site', () => {
  const pass = { status: 0, warn: 0 };
  assert.equal(siteVerdict(pass, { ok: true }).text, 'Good match');
  assert.equal(siteVerdict(pass, { ok: false }).text, 'Poor up close');
  assert.equal(siteVerdict(pass, null).text, 'Check first');                 // not checked yet
  assert.equal(siteVerdict({ status: 0, warn: 1 }, { ok: true }).text, 'Check first');   // soft-limit warning
  assert.equal(siteVerdict({ status: 1 }, { ok: true }).text, 'Check first');           // unverified
  assert.equal(siteVerdict({ status: 2 }, { ok: true }).text, 'Poor: fails a limit');
});
