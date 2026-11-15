// "Top X%" shown instead of a 0-100 score: rank / ranked places, rounded up (never overclaims).
import test from 'node:test';
import assert from 'node:assert/strict';
import { topPct } from '../src/lib/rank.js';

test('#1 of 14,981 is Top 0.01%', () => assert.equal(topPct(1, 14981), 'Top 0.01%'));
test('rounds up, never down', () => {
  assert.equal(topPct(150, 14981), 'Top 1.1%');      // 1.0013% -> 1.1, not 1.0
  assert.equal(topPct(5956, 14981), 'Top 40%');      // NASA's Black Point Lava Flow
  assert.equal(topPct(14981, 14981), 'Top 100%');
});
test('no rank, no claim', () => assert.equal(topPct(undefined, 14981), null));
