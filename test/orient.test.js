// test/orient.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { nestBestOrientation, DEFAULT_ORIENTATIONS } from '../src/nesting/orient.js';
import { placedPolygon, polygonContains, polygonArea, toClipperPath, SCALE } from '../src/nesting/geometry.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
// A chevron. Chosen because a turned hide genuinely WINS on it — 5 pieces
// facing as drawn, 8 at 30 degrees — which is what forces the mapping code
// to run at all. An earlier fixture let every piece fit at 0 degrees, so the
// winner was always 0, the mapping returned early, and four deliberate bugs
// planted in it were caught by nothing.
const WEDGE = [
  { x: 0, y: 0 }, { x: 60, y: 0 }, { x: 160, y: 120 }, { x: 260, y: 0 },
  { x: 320, y: 0 }, { x: 190, y: 200 }, { x: 130, y: 200 },
];
const PART = rect(50, 30);
const partsOf = (n, polygon, rotations = [0, 90]) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p#${i}`, componentId: 'p', polygon, allowedRotations: rotations, clearanceMm: 1,
  }));

const overlapArea = (a, b) => {
  const c = new ClipperLib.Clipper();
  c.AddPath(toClipperPath(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toClipperPath(b), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.reduce((t, p) => t + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SCALE * SCALE);
};

// --- the frame mapping, which is the whole risk in this file -------------

test('every piece lands on the ORIGINAL hide, not the rotated one', () => {
  // Nesting happens on a turned copy of the hide, so the placements come
  // back in that turned frame and have to be mapped home. Get it wrong and
  // every piece is reported somewhere it does not sit — and a cut file would
  // hand that to the laser. This repo has had exactly that bug once before,
  // in blotch_match.py, where a rotation convention was mirrored.
  const part = PART;
  for (const orientations of [1, 2, 4, 6]) {
    const r = nestBestOrientation(WEDGE, partsOf(40, part), { clearanceMm: 1, gridStepMm: 5, orientations });
    assert.ok(r.placements.length > 0, `${orientations} orientations placed nothing`);
    for (const placement of r.placements) {
      const shape = placedPolygon({ polygon: part }, placement);
      assert.ok(
        polygonContains(WEDGE, shape),
        `at ${orientations} orientations, a piece fell outside the hide`
      );
    }
  }
});

test('mapped-back pieces do not overlap each other', () => {
  const part = PART;
  const r = nestBestOrientation(WEDGE, partsOf(40, part), { clearanceMm: 1, gridStepMm: 5, orientations: 6 });
  const shapes = r.placements.map((p) => placedPolygon({ polygon: part }, p));
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      assert.ok(overlapArea(shapes[i], shapes[j]) < 0.5, `pieces ${i} and ${j} overlap`);
    }
  }
});

test('pieces keep their size and shape through the mapping', () => {
  // A sign error in the rotation would still produce plausible-looking
  // placements; area is what catches a shape that has been reflected or
  // skewed rather than moved.
  const part = PART;
  const r = nestBestOrientation(WEDGE, partsOf(40, part), { clearanceMm: 1, gridStepMm: 5, orientations: 6 });
  assert.ok(r.orientationDegrees !== 0, 'this fixture must win on a TURNED hide to test the mapping');
  for (const placement of r.placements) {
    const area = polygonArea(placedPolygon({ polygon: part }, placement));
    assert.ok(Math.abs(area - 1500) < 0.01, `piece area came back as ${area}, not 1500`);
  }
});

// --- what it is for -----------------------------------------------------

test('trying more orientations never places fewer pieces', () => {
  // The whole point: it keeps the best, so more tries cannot do worse.
  const one = nestBestOrientation(WEDGE, partsOf(40, PART), { clearanceMm: 1, gridStepMm: 5, orientations: 1 });
  const many = nestBestOrientation(WEDGE, partsOf(40, PART), { clearanceMm: 1, gridStepMm: 5, orientations: 6 });
  assert.ok(
    many.placements.length > one.placements.length,
    `6 orientations placed ${many.placements.length}, 1 placed ${one.placements.length}`
  );
});

test('one orientation is the old behaviour, unrotated', () => {
  const r = nestBestOrientation(WEDGE, partsOf(40, PART), { clearanceMm: 1, gridStepMm: 5, orientations: 1 });
  assert.equal(r.orientationDegrees, 0);
});

test('it reports which orientation won', () => {
  const r = nestBestOrientation(WEDGE, partsOf(40, PART), { clearanceMm: 1, gridStepMm: 5, orientations: 6 });
  assert.equal(typeof r.orientationDegrees, 'number');
  // Half a turn only: a hide turned 180 presents the same shape to a
  // bottom-left scan as the original.
  assert.ok(r.orientationDegrees >= 0 && r.orientationDegrees < 180);
});

test('parts that do not fit are still reported', () => {
  const r = nestBestOrientation(rect(50, 50), partsOf(3, rect(200, 200)), { clearanceMm: 1, gridStepMm: 5, orientations: 4 });
  assert.equal(r.placements.length, 0);
  assert.equal(r.noFit.length, 3);
});

test('a nonsense orientation count falls back to one run rather than none', () => {
  for (const orientations of [0, -3, 0.4, NaN]) {
    const r = nestBestOrientation(WEDGE, partsOf(4, PART), { clearanceMm: 1, gridStepMm: 5, orientations });
    assert.ok(r.placements.length > 0, `orientations=${orientations} placed nothing`);
  }
});

test('the default is a real number of tries', () => {
  assert.ok(DEFAULT_ORIENTATIONS > 1, 'a default of 1 would disable the feature');
});

test('it keeps the BEST orientation, not merely the last one tried', () => {
  // Without this, "keep the best" and "keep whichever ran last" are
  // indistinguishable — more tries still tends to beat one try either way,
  // so every other test here passes against a version that simply returns
  // the final run.
  const orientations = 6;
  const chosen = nestBestOrientation(WEDGE, partsOf(40, PART), {
    clearanceMm: 1, gridStepMm: 5, orientations,
  });

  // Run each candidate angle on its own and find the real maximum.
  let bestCount = 0;
  for (let i = 0; i < orientations; i++) {
    const single = nestBestOrientation(WEDGE, partsOf(40, PART), {
      clearanceMm: 1, gridStepMm: 5, orientations: 1, forceDegrees: (180 / orientations) * i,
    });
    bestCount = Math.max(bestCount, single.placements.length);
  }

  assert.equal(
    chosen.placements.length,
    bestCount,
    `kept a layout of ${chosen.placements.length} when ${bestCount} was available`
  );
});
