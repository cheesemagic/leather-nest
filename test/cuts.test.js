import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUTS, cutLabel } from '../src/skins/cuts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.join(__dirname, '..', 'docs', 'reference', 'leather-swatches.json');

test('every cut the supplier actually sells is offered', () => {
  // Same reason species.test.js exists: matching compares the exact string,
  // so a cut the app cannot record produces a hide that never pairs.
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const inCatalogue = [...new Set(catalogue.charts.map((c) => c.cut).filter(Boolean))];

  const missing = inCatalogue.filter((c) => c !== 'multispine' && !CUTS.includes(c));
  assert.deepEqual(missing, [], `cuts in the charts but not offered: ${missing.join(', ')}`);
});

test('multispine is not a cut and is not offered', () => {
  // A multispine stingray grew two spine rows instead of one -- a trait of
  // that individual animal, not a part of the body (operator, 2026-09-25).
  // Listing it as a cut would assert it came from somewhere else on the
  // animal and stop it pairing with any other stingray on that false basis.
  assert.ok(!CUTS.includes('multispine'));
  // And it really is in the charts, so this exclusion is deliberate rather
  // than an oversight this test would otherwise hide.
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  assert.ok(catalogue.charts.some((c) => c.cut === 'multispine'));
});

test('whole is offered, and leads the list', () => {
  // Thirty of the 39 charts describe a whole skin, so it is the common case
  // and belongs at the top of the dropdown rather than buried alphabetically.
  assert.equal(CUTS[0], 'whole');
});

test('there is no "unknown" value -- null already means that', () => {
  assert.ok(!CUTS.includes('unknown'));
  assert.ok(!CUTS.includes('none'));
  assert.ok(!CUTS.includes(''));
});

test('the tail of the list is sorted and free of duplicates', () => {
  const rest = CUTS.slice(1);
  assert.deepEqual(rest, [...rest].sort());
  assert.equal(new Set(CUTS).size, CUTS.length);
});

test('cutLabel title-cases every word, including multi-word cuts', () => {
  assert.equal(cutLabel('tail'), 'Tail');
  assert.equal(cutLabel('full quill'), 'Full Quill');
  assert.equal(cutLabel('whole'), 'Whole');
});
