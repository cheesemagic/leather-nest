// test/svg-visible.test.js
// An exported file has to be openable by a person, not just by a laser.
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { exportToSVG } from '../src/svg/export.js';
import { fringedStrip, fringeToSVG } from '../src/fringe.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const PART = { id: 'p', polygon: rect(50, 50), allowedRotations: [0] };
const PLACEMENTS = [{ id: 'p', x: 10, y: 10, rotation: 0 }];

// How wide the thinnest line would render if the drawing filled 1000 pixels.
function thinnestLineInPixels(svg) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
  const widths = [...svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => parseFloat(m[1]));
  return (Math.min(...widths) / Math.max(viewBox[2], viewBox[3])) * 1000;
}

test('lines are visible on a job the size of a real hide', () => {
  // The bug: a fixed 0.01mm hairline on an 826mm hide rendered at 0.012 of a
  // pixel, so the file opened as a blank white page with 841 shapes
  // invisibly inside it.
  const svg = exportToSVG(rect(830, 880), [{ id: 'p', x: 100, y: 100, rotation: 0 }], [PART]);
  assert.ok(thinnestLineInPixels(svg) > 1, `renders at ${thinnestLineInPixels(svg).toFixed(3)}px`);
});

test('lines are visible on a job the size of a single part', () => {
  const svg = exportToSVG(rect(60, 60), PLACEMENTS, [PART]);
  assert.ok(thinnestLineInPixels(svg) > 1, `renders at ${thinnestLineInPixels(svg).toFixed(3)}px`);
});

test('a small job is not drawn absurdly heavily', () => {
  // Scaling has to cut both ways: a thick line on a 60mm part would swamp it.
  const svg = exportToSVG(rect(60, 60), PLACEMENTS, [PART]);
  const stroke = parseFloat(/stroke-width="([^"]+)"/.exec(svg)[1]);
  assert.ok(stroke < 1, `${stroke}mm of stroke on a 60mm job`);
});

test('interior cuts and stitch guides are visible too', () => {
  const withHoles = {
    ...PART,
    interiorPaths: [
      { kind: 'cut', closed: true, points: rect(6, 6).map((p) => ({ x: p.x + 10, y: p.y + 10 })) },
      { kind: 'mark', closed: false, points: [{ x: 5, y: 40 }, { x: 45, y: 40 }] },
    ],
  };
  const svg = exportToSVG(rect(830, 880), [{ id: 'p', x: 100, y: 100, rotation: 0 }], [withHoles]);
  assert.ok(thinnestLineInPixels(svg) > 1, 'every line, not just the outline');
});

test('a fringe file is visible at strip size', () => {
  const svg = fringeToSVG(fringedStrip({ lengthMm: 300, widthMm: 60, fringeDepthMm: 45 }));
  assert.ok(thinnestLineInPixels(svg) > 1, `renders at ${thinnestLineInPixels(svg).toFixed(3)}px`);
});
