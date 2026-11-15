// References page: one verdict scale (Strong / Moderate / Weak) for every check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { strengthFromChance, chanceRandomMedian, topFromPercentile, stabilityStrength, median } from '../src/lib/verdict.js';

test('chance thresholds match the engine note', () => {
  assert.equal(strengthFromChance(0.0003), 'Strong');
  assert.equal(strengthFromChance(0.03), 'Moderate');
  assert.equal(strengthFromChance(0.12), 'Weak');
  assert.equal(strengthFromChance(NaN), null);
});

test('random chance of a high median', () => {
  assert.ok(Math.abs(chanceRandomMedian(90, 1) - 0.10) < 0.01);      // one site at percentile 90: 10%
  assert.ok(chanceRandomMedian(95, 5) < 0.01);                        // five sites, median 95: rare
  assert.ok(Math.abs(chanceRandomMedian(50, 3) - 0.5) < 0.02);
});

test('percentile 97 is Top 3%; rounding never overclaims', () => {
  assert.equal(topFromPercentile(97), 'Top 3%');
  assert.equal(topFromPercentile(96.8), 'Top 3.2%');
  assert.equal(topFromPercentile(100), 'Top 0.01%');
  assert.equal(topFromPercentile(3.2), 'Bottom 4%');            // below the middle reads as Bottom
});

test('stability and median helpers', () => {
  assert.equal(stabilityStrength(13, 14), 'Strong');
  assert.equal(stabilityStrength(8, 14), 'Moderate');
  assert.equal(stabilityStrength(3, 14), 'Weak');
  assert.equal(median([3, 1, 2, NaN]), 2);
  assert.equal(median([]), null);
});
