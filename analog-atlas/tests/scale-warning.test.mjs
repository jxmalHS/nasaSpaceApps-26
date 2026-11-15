// Compare page: warn when the 2 km patches disagree with the 55 km ranking (Khorugh: 31.5° vs Moon 9.0°).
import test from 'node:test';
import assert from 'node:assert/strict';

import { scaleMismatch } from '../src/lib/scale.js';

test('Khorugh-like patch (31.5° vs 9.0°) is flagged as steeper', () => {
  const m = scaleMismatch({ slopeMean: 31.5 }, { slopeMean: 9.0 });
  assert.ok(m && m.steeper && m.ratio > 3);
});
test('close patches are not flagged', () => {
  assert.equal(scaleMismatch({ slopeMean: 11 }, { slopeMean: 9 }), null);
});
test('missing data is not flagged', () => {
  assert.equal(scaleMismatch({ slopeMean: NaN }, { slopeMean: 9 }), null);
  assert.equal(scaleMismatch(null, { slopeMean: 9 }), null);
});
