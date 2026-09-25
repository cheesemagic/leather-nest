import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleDifferenceMm,
  spectrumCorrelation,
  rankMatches,
  colourDifference,
  cutsCanPair,
} from '../src/skins/similarity.js';

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

test('colourDifference still ignores lightness entirely', () => {
  // Was an assertion that a 3-4-5 triangle returns exactly 5 -- true of
  // straight-line distance in a*/b*, and only of that. The property that
  // actually matters survived the move to CIEDE2000 and is asserted here
  // instead: an 80-point swing in lightness changes nothing.
  const dark = { colourL: 10, colourA: 12, colourB: 30 };
  const same = { colourL: 90, colourA: 12, colourB: 30 };
  assert.equal(colourDifference(dark, same), 0);

  const other = { colourA: 18, colourB: 26 };
  assert.equal(
    colourDifference(dark, { ...other, colourL: 10 }),
    colourDifference(dark, { ...other, colourL: 90 })
  );
});

test('colourDifference is a real ΔE00, not a straight line through a*/b*', () => {
  const a = { colourL: 50, colourA: 2.6772, colourB: -79.7751 };
  const b = { colourL: 50, colourA: 0, colourB: -82.7485 };
  // Sharma pair 1. Straight-line distance here is ~4.0; ΔE00 is 2.0425,
  // because the formula corrects hard in the blue region. The gap between
  // those two numbers is the whole reason for the change.
  assert.ok(Math.abs(colourDifference(a, b) - 2.0425) < 1e-4);
  assert.ok(Math.hypot(a.colourA - b.colourA, a.colourB - b.colourB) > 3.9);
});

test('colourDifference is symmetric and zero against itself', () => {
  const a = { colourL: 43, colourA: 17, colourB: 26 };
  const b = { colourL: 61, colourA: 9, colourB: 31 };
  assert.equal(colourDifference(a, a), 0);
  assert.equal(colourDifference(a, b), colourDifference(b, a));
});

test('a hide with no recorded lightness is still comparable', () => {
  // rankMatches() gates on colourA/colourB only, so a record carrying those
  // without colourL can reach here. At weight 0 it cannot affect the answer.
  const withL = { colourL: 43, colourA: 17, colourB: 26 };
  const withoutL = { colourA: 17, colourB: 26 };
  const other = { colourL: 50, colourA: 9, colourB: 31 };
  assert.equal(colourDifference(withoutL, other), colourDifference(withL, other));
  assert.ok(Number.isFinite(colourDifference(withoutL, other)));
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

// Two hides differing ONLY in cut, so nothing but the gate can separate them.
function pairOfCuts(cutA, cutB) {
  const base = {
    species: 'caiman',
    radialSpectrum: [0.1, 0.5, 1, 0.5, 0.1],
    colourA: 12,
    colourB: 20,
  };
  return [
    { ...base, id: 'a', cut: cutA, dominantWavelengthMm: 3.2 },
    { ...base, id: 'b', cut: cutB, dominantWavelengthMm: 3.25 },
  ];
}

test('cutsCanPair refuses two known different cuts and allows everything else', () => {
  assert.equal(cutsCanPair({ cut: 'tail' }, { cut: 'belly' }), false);
  assert.equal(cutsCanPair({ cut: 'tail' }, { cut: 'tail' }), true);
  // An unknown cut cannot rule a pair out -- it can only leave it unverified.
  assert.equal(cutsCanPair({ cut: 'tail' }, { cut: null }), true);
  assert.equal(cutsCanPair({ cut: null }, { cut: null }), true);
  // A record predating the field entirely, not just one holding a null.
  assert.equal(cutsCanPair({ cut: 'tail' }, {}), true);
});

test('a caiman tail and a caiman belly never pair, however close their scales', () => {
  // The whole reason this field exists. The supplier sells "Caiman Tail
  // Matte" and "Argentine Caiman Belly Matte", both as species "caiman", so
  // without the gate these two rank as a good match on a close measurement.
  const groups = rankMatches(pairOfCuts('tail', 'belly'));
  assert.equal(groups.length, 1, 'the species group still exists');
  assert.equal(groups[0].species, 'caiman');
  assert.deepEqual(groups[0].pairs, [], 'but it contains no pair');
});

test('two hides of the same cut pair, with nothing unverified', () => {
  const groups = rankMatches(pairOfCuts('tail', 'tail'));
  assert.equal(groups[0].pairs.length, 1);
  assert.deepEqual(groups[0].pairs[0].unverified, []);
});

test('an unknown cut on either side pairs, but says it could not be checked', () => {
  assert.deepEqual(rankMatches(pairOfCuts('tail', null))[0].pairs[0].unverified, ['cut']);
  assert.deepEqual(rankMatches(pairOfCuts(null, null))[0].pairs[0].unverified, ['cut']);
});

test('pairs with an unverified cut sort after every fully-judged pair', () => {
  // The flagged pairs are deliberately the BEST on scale, so only the
  // partition can put them last -- otherwise they would rank first.
  const base = {
    species: 'caiman',
    radialSpectrum: [0.1, 0.5, 1, 0.5, 0.1],
    colourA: 12,
    colourB: 20,
  };
  const groups = rankMatches([
    { ...base, id: 'known-1', cut: 'tail', dominantWavelengthMm: 3.0 },
    { ...base, id: 'known-2', cut: 'tail', dominantWavelengthMm: 3.9, colourA: 19 },
    { ...base, id: 'unknown', cut: null, dominantWavelengthMm: 3.01 },
  ]);

  const pairs = groups[0].pairs;
  assert.equal(pairs.length, 3, 'tail+tail, and each tail with the unknown');
  assert.deepEqual(pairs[0].unverified, [], 'the judged pair comes first');
  assert.equal(pairs[0].scaleDifferenceMm.toFixed(2), '0.90');
  assert.ok(
    pairs.slice(1).every((p) => p.unverified.length > 0),
    'both flagged pairs follow it, despite being closer on scale'
  );
});

test('flagged pairs are still ranked among themselves', () => {
  const base = {
    species: 'python',
    cut: null,
    radialSpectrum: [0.2, 0.6, 1, 0.6, 0.2],
    colourA: 5,
    colourB: 9,
  };
  const groups = rankMatches([
    { ...base, id: 'p1', dominantWavelengthMm: 5.0 },
    { ...base, id: 'p2', dominantWavelengthMm: 5.1 },
    { ...base, id: 'p3', dominantWavelengthMm: 9.0 },
  ]);

  const pairs = groups[0].pairs;
  assert.ok(pairs.every((p) => p.unverified.length > 0));
  assert.equal(pairs[0].scaleDifferenceMm.toFixed(2), '0.10', 'closest first within the partition');
});
