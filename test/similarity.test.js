import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleDifferenceMm, spectrumCorrelation, rankMatches } from '../src/skins/similarity.js';

test('scaleDifferenceMm returns the absolute difference in mm', () => {
  assert.equal(scaleDifferenceMm({ dominantWavelengthMm: 5 }, { dominantWavelengthMm: 8 }), 3);
  assert.equal(scaleDifferenceMm({ dominantWavelengthMm: 8 }, { dominantWavelengthMm: 5 }), 3);
});

test('spectrumCorrelation returns 1 for identical spectra', () => {
  const spectrum = [0.1, 0.5, 1.0, 0.3, 0.05];
  assert.ok(Math.abs(spectrumCorrelation(spectrum, spectrum) - 1) < 1e-9);
});

test('spectrumCorrelation returns -1 for inverted spectra', () => {
  const a = [0, 1, 2, 3, 4];
  const b = [4, 3, 2, 1, 0];
  assert.ok(Math.abs(spectrumCorrelation(a, b) - -1) < 1e-9);
});

test('spectrumCorrelation is lower for clearly different spectra than for near-identical ones', () => {
  const a = [1, 0, 0, 0, 0];
  const b = [0.9, 0.1, 0, 0, 0];
  const c = [0, 0, 0, 0, 1];
  assert.ok(spectrumCorrelation(a, b) > spectrumCorrelation(a, c));
});

test('rankMatches groups by species (case-insensitive/trimmed) and sorts pairs ascending by scale difference', () => {
  const skins = [
    { id: 'a1', species: 'Cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0] },
    { id: 'a2', species: ' cayman ', dominantWavelengthMm: 4.5, radialSpectrum: [1, 0, 0] },
    { id: 'a3', species: 'cayman', dominantWavelengthMm: 9.0, radialSpectrum: [1, 0, 0] },
    { id: 'b1', species: 'Crocodile', dominantWavelengthMm: 4.1, radialSpectrum: [1, 0, 0] },
  ];

  const groups = rankMatches(skins);
  const caymanGroup = groups.find((g) => g.species === 'cayman');
  const crocGroup = groups.find((g) => g.species === 'crocodile');

  assert.equal(caymanGroup.pairs.length, 3);
  assert.equal(crocGroup.pairs.length, 0);
  assert.ok(caymanGroup.pairs[0].scaleDifferenceMm <= caymanGroup.pairs[1].scaleDifferenceMm);
  assert.ok(caymanGroup.pairs[1].scaleDifferenceMm <= caymanGroup.pairs[2].scaleDifferenceMm);
  assert.equal(caymanGroup.pairs[0].scaleDifferenceMm, 0.5); // a1 vs a2, the closest pair
});

test('rankMatches never produces a cross-species pair', () => {
  const skins = [
    { id: 'a1', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0] },
    { id: 'b1', species: 'crocodile', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0] },
  ];
  const groups = rankMatches(skins);
  for (const group of groups) {
    assert.equal(group.pairs.length, 0);
  }
});
