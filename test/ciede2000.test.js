import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciede2000 } from '../src/skins/ciede2000.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula:
// Implementation notes, supplementary test data, and mathematical
// observations", Color Research & Application 30(1):21-30. Fetched from
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ and committed
// byte-for-byte -- these 34 pairs were chosen to break implementations at the
// hue-angle wraparound and the blue-region rotation.
const FIXTURE = path.join(__dirname, 'fixtures', 'ciede2000-sharma-testdata.txt');

function publishedPairs() {
  return fs
    .readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      const n = line.trim().split(/\s+/).map(Number);
      assert.equal(n.length, 7, `row ${i + 1} should hold 6 LAB values and an expected result`);
      assert.ok(n.every(Number.isFinite), `row ${i + 1} has a value that is not a number`);
      return { row: i + 1, labA: n.slice(0, 3), labB: n.slice(3, 6), expected: n[6] };
    });
}

test('the published fixture is present and intact', () => {
  // Guards the fixture itself: a truncated or re-saved file would otherwise
  // make the suite below pass on fewer pairs without anyone noticing.
  assert.equal(publishedPairs().length, 34);
});

test('every published pair matches, including the wraparound and blue-region cases', () => {
  for (const { row, labA, labB, expected } of publishedPairs()) {
    const actual = ciede2000(labA, labB);
    assert.ok(
      Math.abs(actual - expected) < 1e-4,
      `row ${row}: ${JSON.stringify(labA)} vs ${JSON.stringify(labB)} ` +
        `expected ${expected}, got ${actual.toFixed(4)}`
    );
  }
});

test('the result is symmetric', () => {
  // Not guaranteed by the published data, which only runs each pair one way,
  // but matching compares hides in whichever order the loop reaches them.
  for (const { row, labA, labB } of publishedPairs()) {
    assert.ok(
      Math.abs(ciede2000(labA, labB) - ciede2000(labB, labA)) < 1e-9,
      `row ${row} is not symmetric`
    );
  }
});

test('a colour compared with itself is zero', () => {
  assert.equal(ciede2000([50, 2.6772, -79.7751], [50, 2.6772, -79.7751]), 0);
  assert.equal(ciede2000([0, 0, 0], [0, 0, 0]), 0);
  // Pure black against pure white is emphatically not zero.
  assert.ok(ciede2000([0, 0, 0], [100, 0, 0]) > 50);
});

test('lightnessWeight 0 removes lightness from the result entirely', () => {
  // The claim the spec rests on: L enters only through S_L, and S_L
  // multiplies only the lightness term -- so with that term zeroed, two
  // colours differing ONLY in lightness are indistinguishable.
  assert.equal(ciede2000([20, 12, 30], [80, 12, 30], { lightnessWeight: 0 }), 0);

  // And a real chroma/hue difference is still measured, unchanged by whatever
  // lightness the two colours happen to carry.
  const dark = ciede2000([20, 12, 30], [20, 18, 26], { lightnessWeight: 0 });
  const mixed = ciede2000([20, 12, 30], [65, 18, 26], { lightnessWeight: 0 });
  assert.ok(dark > 0);
  assert.ok(Math.abs(dark - mixed) < 1e-9, 'lightness must not leak in through S_C, S_H or R_T');
});

test('lightnessWeight defaults to 1, so the published data validates the standard formula', () => {
  const a = [50, 2.6772, -79.7751];
  const b = [50, 0, -82.7485];
  assert.equal(ciede2000(a, b), ciede2000(a, b, { lightnessWeight: 1 }));
});
