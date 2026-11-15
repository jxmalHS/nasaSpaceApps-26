import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendation } from '../src/lib/recommendation.js';
import { STATUS } from '../src/lib/scoring.js';

const candidate = { status: STATUS.PASS, ml: 0.51, mlDetail: { low_evidence: false } };
for (const [name, overrides, expected] of [
  ['strict limit overrides a perfect match', { status: STATUS.FAIL, ml: 1 }, 'Exclude'],
  ['unknown mission evidence', { status: STATUS.UNKNOWN }, 'Collect'],
  ['unanalysed cell', { ml: NaN }, 'Rules-only'],
  ['unavailable model metadata', { mlDetail: null }, 'Request'],
  ['sparse tile support', { mlDetail: { low_evidence: true } }, 'Request'],
  ['unmet model requirement', { mlDetail: { req_not_met: ['slope_p90'], low_evidence: false } }, 'Review unmet'],
  ['unknown model requirement', { mlDetail: { req_unknown: ['slope_p90'], low_evidence: false } }, 'Collect evidence'],
  ['soft interference', { warn: 1 }, 'Review'],
  ['field verification candidate', {}, 'Consider'],
]) {
  test(name, () => assert.ok(recommendation({ ...candidate, ...overrides }).startsWith(expected)));
}
