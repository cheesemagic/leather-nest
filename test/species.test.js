import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES, speciesLabel } from '../src/skins/species.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.join(__dirname, '..', 'docs', 'reference', 'leather-swatches.json');

test('every species the supplier actually sells is offered', () => {
  // The list exists to track the supplier's catalogue. If a chart arrives
  // with a species the app cannot record, a hide of it cannot be entered
  // correctly -- and matching groups on the exact string, so a workaround
  // spelling would produce a hide that never pairs with anything.
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const inCatalogue = [...new Set(catalogue.charts.map((c) => c.species).filter(Boolean))];

  const missing = inCatalogue.filter((s) => !SPECIES.includes(s));
  assert.deepEqual(missing, [], `species in the charts but not offered: ${missing.join(', ')}`);
});

test('the list carries no species the supplier does not sell', () => {
  // The other direction, and the reason this file exists: the app shipped
  // "cayman" for months while every chart says "caiman". Matching would
  // never have paired the two.
  const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const inCatalogue = new Set(catalogue.charts.map((c) => c.species).filter(Boolean));

  const unknown = SPECIES.filter((s) => !inCatalogue.has(s));
  assert.deepEqual(unknown, [], `offered but in no chart: ${unknown.join(', ')}`);
});

test('the retired names are gone, and their replacements are present', () => {
  for (const retired of ['cayman', 'buffalo', 'cow', 'fish']) {
    assert.ok(!SPECIES.includes(retired), `${retired} should have been replaced`);
  }
  for (const replacement of ['caiman', 'bison', 'calf', 'arapaima']) {
    assert.ok(SPECIES.includes(replacement), `${replacement} should be offered`);
  }
});

test('the list is sorted and free of duplicates, so the dropdown reads predictably', () => {
  assert.deepEqual(SPECIES, [...SPECIES].sort());
  assert.equal(new Set(SPECIES).size, SPECIES.length);
});

test('speciesLabel title-cases every word, including multi-word species', () => {
  assert.equal(speciesLabel('python'), 'Python');
  assert.equal(speciesLabel('saltwater crocodile'), 'Saltwater Crocodile');
  assert.equal(speciesLabel('western diamond rattle snake'), 'Western Diamond Rattle Snake');
});
