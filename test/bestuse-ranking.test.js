// test/bestuse-ranking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, RANKING_STRATEGIES } from '../src/bestuse/ranking.js';

function result(candidateId, { value = 0, utilization = 0, demandSatisfied = 0 }) {
  return { candidateId, value, utilization, demandSatisfied, placements: [], counts: {} };
}

test('value orders by total value, highest first', () => {
  const ranked = rankCandidates(
    [result('a', { value: 100 }), result('b', { value: 300 }), result('c', { value: 200 })],
    'value'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['b', 'c', 'a']);
});

test('utilization orders by area used, highest first', () => {
  const ranked = rankCandidates(
    [result('a', { utilization: 0.2 }), result('b', { utilization: 0.9 })],
    'utilization'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['b', 'a']);
});

test('demand orders by orders filled, breaking ties on value', () => {
  const ranked = rankCandidates(
    [
      result('a', { demandSatisfied: 2, value: 50 }),
      result('b', { demandSatisfied: 2, value: 90 }),
      result('c', { demandSatisfied: 5, value: 10 }),
    ],
    'demand'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['c', 'b', 'a']);
});

test('THE POINT: value and utilization pick different winners', () => {
  // A hide packed 89% full of cheap keepers is worth less than one packed
  // 68% with belt straps. If this ever fails, some comparison has been
  // hardcoded and the tool has quietly become a utilization maximiser.
  const keepers = result('keepers', { value: 196, utilization: 0.89 });
  const straps = result('straps', { value: 284, utilization: 0.68 });

  const byValue = rankCandidates([keepers, straps], 'value');
  const byUtilization = rankCandidates([keepers, straps], 'utilization');

  assert.equal(byValue[0].candidateId, 'straps');
  assert.equal(byUtilization[0].candidateId, 'keepers');
  assert.notEqual(byValue[0].candidateId, byUtilization[0].candidateId);
});

test('an unknown strategy throws rather than falling back', () => {
  assert.throws(() => rankCandidates([], 'vibes'), /vibes/);
});

test('a missing strategy throws — naming the question is mandatory', () => {
  // There is deliberately no default. Defaulting would let "highest
  // utilization wins" become the answer by omission.
  assert.throws(() => rankCandidates([]), /strategy/i);
});

test('every advertised strategy is a callable comparator', () => {
  for (const [name, comparator] of Object.entries(RANKING_STRATEGIES)) {
    assert.equal(typeof comparator, 'function', `${name} must be a comparator`);
    assert.equal(comparator.length, 2, `${name} must take two results`);
  }
});

test('ranking does not mutate the input array', () => {
  const input = [result('a', { value: 1 }), result('b', { value: 2 })];
  const before = input.map((r) => r.candidateId);

  rankCandidates(input, 'value');

  assert.deepEqual(input.map((r) => r.candidateId), before);
});
