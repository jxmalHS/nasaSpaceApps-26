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
