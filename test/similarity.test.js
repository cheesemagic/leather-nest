import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleDifferenceMm, spectrumCorrelation, rankMatches, colourDifference } from '../src/skins/similarity.js';

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

test('colourDifference ignores lightness, uses only a*/b*', () => {
  const a = { colourL: 10, colourA: 0, colourB: 0 };
  const b = { colourL: 90, colourA: 3, colourB: 4 };
  assert.equal(colourDifference(a, b), 5); // 3-4-5 triangle, lightness (10 vs 90) irrelevant
});

test('rankMatches weighs scale and colour equally -- a well-rounded pair beats one that is best on only one axis', () => {
  // Pairwise scale gaps (a,b,c sorted 4.0/4.5/9.0): (a,b)=0.5 best,
  // (b,c)=4.5 middle, (a,c)=5.0 worst.
  // Pairwise colour gaps, chosen independently: (b,c)=7.07 best,
  // (a,c)=63.6 middle, (a,b)=70.7 worst.
  // (a,b) is the outright best on scale but the outright worst on colour;
  // (b,c) is only middling on scale but the best on colour. Rank-summed,
  // (b,c) wins (1+0=1) over (a,b) (0+2=2) -- neither metric alone decides it.
  const skins = [
    { id: 'a', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0], colourA: 0, colourB: 0 },
    { id: 'b', species: 'cayman', dominantWavelengthMm: 4.5, radialSpectrum: [1, 0, 0], colourA: 50, colourB: 50 },
    { id: 'c', species: 'cayman', dominantWavelengthMm: 9.0, radialSpectrum: [1, 0, 0], colourA: 45, colourB: 45 },
  ];

  const groups = rankMatches(skins);
  const pairs = groups.find((g) => g.species === 'cayman').pairs;
  const top = pairs[0];
  assert.ok(
    (top.skinAId === 'b' && top.skinBId === 'c') || (top.skinAId === 'c' && top.skinBId === 'b'),
    `expected the well-rounded pair (b, c) first, got (${top.skinAId}, ${top.skinBId})`
  );
});

test('rankMatches puts a pair missing colour on either side after every pair it can judge on colour', () => {
  const skins = [
    { id: 'a', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0], colourA: 0, colourB: 0 },
    { id: 'b', species: 'cayman', dominantWavelengthMm: 4.1, radialSpectrum: [1, 0, 0], colourA: 50, colourB: 50 },
    // c has no colour recorded (an older signature, or colour_sample.py failed).
    { id: 'c', species: 'cayman', dominantWavelengthMm: 4.05, radialSpectrum: [1, 0, 0], colourA: null, colourB: null },
  ];

  const groups = rankMatches(skins);
  const pairs = groups.find((g) => g.species === 'cayman').pairs;
  const withColour = pairs.filter((p) => p.colourDifference != null);
  const withoutColour = pairs.filter((p) => p.colourDifference == null);
  assert.equal(withColour.length, 1);
  assert.equal(withoutColour.length, 2);
  assert.equal(pairs.indexOf(withColour[0]), 0, 'the judgeable pair should sort first');
});

test('rankMatches skips signature-less skins entirely, producing no NaN', () => {
  const skins = [
    { id: 'a1', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0] },
    { id: 'a2', species: 'cayman', dominantWavelengthMm: null, radialSpectrum: null },
    { id: 'a3', species: 'cayman', dominantWavelengthMm: 4.5, radialSpectrum: [1, 0, 0] },
  ];

  const groups = rankMatches(skins);
  const caymanGroup = groups.find((g) => g.species === 'cayman');

  assert.equal(caymanGroup.pairs.length, 1);
  assert.equal(caymanGroup.pairs[0].skinAId, 'a1');
  assert.equal(caymanGroup.pairs[0].skinBId, 'a3');
  for (const pair of caymanGroup.pairs) {
    assert.ok(!Number.isNaN(pair.scaleDifferenceMm));
    assert.ok(!Number.isNaN(pair.spectrumCorrelation));
  }
});
