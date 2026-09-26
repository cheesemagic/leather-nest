import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINISHES, finishLabel } from '../src/skins/finishes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.join(__dirname, '..', 'docs', 'reference', 'leather-swatches.json');

const charts = () => JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')).charts;

test('every finish the supplier actually sells is offered', () => {
  const inCatalogue = [...new Set(charts().map((c) => c.finish).filter(Boolean))];
  const missing = inCatalogue.filter((f) => !FINISHES.includes(f));
  assert.deepEqual(missing, [], `finishes in the charts but not offered: ${missing.join(', ')}`);
});

test('the list carries no finish the supplier does not sell', () => {
  const inCatalogue = new Set(charts().map((c) => c.finish).filter(Boolean));
  const unknown = FINISHES.filter((f) => !inCatalogue.has(f));
  assert.deepEqual(unknown, [], `offered but in no chart: ${unknown.join(', ')}`);
});

test('semi-gloss is gone, and cannot come back by accident', () => {
  // It shipped for months and appears in none of the 39 charts -- invented on
  // our side (operator, 2026-09-26). This test is the reason it stays gone.
  assert.ok(!FINISHES.includes('semi-gloss'));
  assert.ok(!charts().some((c) => c.finish === 'semi-gloss'), 'nor is it in the catalogue');
});

test('there is no "unknown" value -- null already means that', () => {
  for (const notAValue of ['unknown', 'none', '']) {
    assert.ok(!FINISHES.includes(notAValue));
  }
});

test('the two hand-painted variants stay distinct', () => {
  // Recorded as printed. Collapsing them is the supplier's call, not ours.
  assert.ok(FINISHES.includes('hand-painted'));
  assert.ok(FINISHES.includes('hand-painted two-tone'));
});

test('the list is ordered commonest first and free of duplicates', () => {
  const counts = new Map();
  for (const c of charts()) {
    if (c.finish) counts.set(c.finish, (counts.get(c.finish) ?? 0) + 1);
  }
  const frequencies = FINISHES.map((f) => counts.get(f) ?? 0);
  assert.deepEqual(
    frequencies,
    [...frequencies].sort((a, b) => b - a),
    `not ordered by chart count: ${FINISHES.map((f, i) => `${f}=${frequencies[i]}`).join(', ')}`
  );
  assert.equal(new Set(FINISHES).size, FINISHES.length);
});

test('finishLabel title-cases every word, including the hyphenated ones', () => {
  assert.equal(finishLabel('matte'), 'Matte');
  assert.equal(finishLabel('pebble grain'), 'Pebble Grain');
  assert.equal(finishLabel('hand-painted two-tone'), 'Hand-painted Two-tone');
});
