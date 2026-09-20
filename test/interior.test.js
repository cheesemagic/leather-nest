// test/interior.test.js
// Interior cuts: holes, stitch guides, fringe slits, etched lines — anything
// a component needs cut or marked inside its own outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import {
  validateInteriorPaths,
  holeAreaMm2,
  isKnownKind,
  INTERIOR_KINDS,
} from '../src/interior.js';
import { exportToSVG, INTERIOR_COLORS, CUT_COLOR } from '../src/svg/export.js';
import { placedPoints, placedPolygon, boundingBox, polygonArea } from '../src/nesting/geometry.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const square = (x, y, size) => [
  { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];
const OUTLINE = rect(100, 60);
const HOLE = { kind: 'cut', closed: true, points: square(20, 20, 10) };
const STITCH = { kind: 'mark', closed: false, points: [{ x: 5, y: 5 }, { x: 95, y: 5 }] };

// --- what counts as a valid interior path -------------------------------

test('a hole and a stitch line inside the outline are accepted', () => {
  assert.deepEqual(validateInteriorPaths(OUTLINE, [HOLE, STITCH]), []);
});

test('a path reaching outside the outline is refused', () => {
  // A cut outside the piece is a cut through whatever leather is next to it.
  const escaping = { kind: 'cut', closed: true, points: square(90, 50, 30) };
  const problems = validateInteriorPaths(OUTLINE, [escaping]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /outside the component outline/);
});

test('an unknown operation is refused by name', () => {
  const problems = validateInteriorPaths(OUTLINE, [{ ...HOLE, kind: 'engrave' }]);
  assert.match(problems[0], /engrave/);
  assert.match(problems[0], /cut, score, mark/);
});

test('every problem is reported, not just the first', () => {
  // Four bad paths should send the operator round the loop once, not four times.
  const bad = [
    { kind: 'nope', closed: true, points: square(20, 20, 10) },
    { kind: 'cut', closed: true, points: square(200, 200, 10) },
    { kind: 'cut', closed: false, points: [{ x: 1, y: 1 }] },
    { kind: 'cut', closed: true, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
  ];
  assert.equal(validateInteriorPaths(OUTLINE, bad).length, 4);
});

test('a path with a broken coordinate is refused rather than drawn as NaN', () => {
  const problems = validateInteriorPaths(OUTLINE, [
    { kind: 'cut', closed: false, points: [{ x: 1, y: 1 }, { x: NaN, y: 2 }] },
  ]);
  assert.match(problems[0], /not a real coordinate/);
});

test('the three operations are the ones the exporter can colour', () => {
  for (const kind of Object.keys(INTERIOR_KINDS)) {
    assert.ok(isKnownKind(kind));
    assert.ok(INTERIOR_COLORS[kind], `no colour for ${kind}`);
  }
  // Interior cuts share the outline's colour: both go all the way through.
  assert.equal(INTERIOR_COLORS.cut, CUT_COLOR);
  assert.notEqual(INTERIOR_COLORS.score, INTERIOR_COLORS.mark);
});

// --- the placement frame, which is where this goes wrong ----------------

test('a hole keeps its exact position within the piece, at every rotation', () => {
  // The bug this guards: normalising a hole to its OWN bounding box puts it
  // at the piece's corner. Checking only that it stays INSIDE the piece is
  // not enough — a hole at the corner is still inside — so this pins where
  // it actually lands. The 100x60 piece is placed at 15,25 with a 10mm hole
  // whose near corner sits 20,20 in from the piece's own origin.
  const part = { id: 'p', polygon: OUTLINE, interiorPaths: [HOLE] };

  // Rotation 0: no turning, so the hole sits 20,20 in from the placement.
  const flat = boundingBox(placedPoints(part, { id: 'p', x: 15, y: 25, rotation: 0 }, HOLE.points));
  assert.equal(flat.minX, 35, 'hole should be 20mm in from the piece origin');
  assert.equal(flat.minY, 45);

  for (const rotation of [0, 90, 180, 270]) {
    const placement = { id: 'p', x: 15, y: 25, rotation };
    const ob = boundingBox(placedPolygon(part, placement));
    const hb = boundingBox(placedPoints(part, placement, HOLE.points));

    // Still inside...
    assert.ok(hb.minX >= ob.minX - 1e-9 && hb.maxX <= ob.maxX + 1e-9, `rotation ${rotation}: escaped in x`);
    assert.ok(hb.minY >= ob.minY - 1e-9 && hb.maxY <= ob.maxY + 1e-9, `rotation ${rotation}: escaped in y`);
    // ...and never flush against the piece's corner, which is where a
    // self-normalised hole always ends up.
    const atCorner = Math.abs(hb.minX - ob.minX) < 1e-9 && Math.abs(hb.minY - ob.minY) < 1e-9;
    assert.ok(!atCorner, `rotation ${rotation}: hole collapsed onto the piece corner`);
    // The 10mm hole must keep its size through the transform.
    assert.ok(Math.abs(hb.maxX - hb.minX - 10) < 1e-9, `rotation ${rotation}: hole changed size`);
  }
});

test('placedPolygon is placedPoints applied to the outline', () => {
  // One transform, not two that can drift apart.
  const part = { id: 'p', polygon: OUTLINE };
  const placement = { id: 'p', x: 7, y: 11, rotation: 90 };
  assert.deepEqual(placedPolygon(part, placement), placedPoints(part, placement, OUTLINE));
});

// --- what gets exported --------------------------------------------------

const SHEET = rect(300, 200);
const PLACEMENTS = [{ id: 'p', x: 10, y: 10, rotation: 0 }];
const partWith = (paths) => ({ id: 'p', polygon: OUTLINE, interiorPaths: paths });

test('a component with no interior cuts exports exactly as before', () => {
  const plain = exportToSVG(SHEET, PLACEMENTS, [{ id: 'p', polygon: OUTLINE }]);
  const empty = exportToSVG(SHEET, PLACEMENTS, [partWith([])]);
  assert.equal(plain, empty);
});

test('a hole exports as a closed shape, a stitch line as an open one', () => {
  const svg = exportToSVG(SHEET, PLACEMENTS, [partWith([HOLE, STITCH])]);
  // Outline plus hole are polygons; the stitch guide is an open path.
  assert.equal([...svg.matchAll(/<polygon /g)].length, 3);
  assert.equal([...svg.matchAll(/<path d=/g)].length, 1);
  assert.match(svg, new RegExp(`stroke="${INTERIOR_COLORS.mark.replace('#', '#')}"`));
});

test('stitch guides and etch lines are a different colour from cuts', () => {
  const svg = exportToSVG(SHEET, PLACEMENTS, [partWith([STITCH])]);
  // If a stitch guide came out in the cut colour the laser would cut along it.
  const markLine = /<path d="[^"]+" stroke="([^"]+)"/.exec(svg);
  assert.equal(markLine[1], INTERIOR_COLORS.mark);
  assert.notEqual(markLine[1], CUT_COLOR);
});

// --- kerf, which runs backwards inside a hole ----------------------------

const holeBounds = (svg) => {
  const polygons = [...svg.matchAll(/<polygon points="([^"]+)" stroke="#FF0000"/g)];
  // The second red polygon is the hole; the first is the piece outline.
  const points = polygons[1][1].split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
  return boundingBox(points);
};

test('a hole is cut SMALLER than drawn, not larger', () => {
  // The beam eats the edge of whatever it follows. Outside a piece that means
  // cutting wide; inside a hole it means cutting narrow. Getting this
  // backwards makes every hole a full kerf too big.
  const plain = holeBounds(exportToSVG(SHEET, PLACEMENTS, [partWith([HOLE])]));
  const cut = holeBounds(
    exportToSVG(SHEET, PLACEMENTS, [partWith([HOLE])], { method: 'laser', kerfMm: 0.4 })
  );

  const drawn = plain.maxX - plain.minX;
  const actual = cut.maxX - cut.minX;
  assert.equal(drawn, 10);
  assert.ok(actual < drawn, `hole was cut ${actual}mm, larger than the drawn ${drawn}mm`);
  assert.ok(Math.abs(actual - 9.6) < 0.01, `expected 9.6mm, got ${actual}`);
});

test('a hole too small to survive the beam is dropped, not cut at full size', () => {
  const tiny = { kind: 'cut', closed: true, points: square(20, 20, 0.4) };
  const svg = exportToSVG(SHEET, PLACEMENTS, [partWith([tiny])], {
    method: 'laser', kerfMm: 0.6,
  });
  // Only the piece outline should remain in the cut colour.
  assert.equal([...svg.matchAll(/<polygon points="[^"]+" stroke="#FF0000"/g)].length, 1);
});

test('stitch guides are never kerf-shifted — nothing is being removed', () => {
  const plain = exportToSVG(SHEET, PLACEMENTS, [partWith([STITCH])]);
  const cut = exportToSVG(SHEET, PLACEMENTS, [partWith([STITCH])], {
    method: 'laser', kerfMm: 0.5,
  });
  const line = (svg) => /<path d="([^"]+)"/.exec(svg)[1];
  assert.equal(line(plain), line(cut));
});

// --- what the operator actually gets ------------------------------------

test('hole area is reported, and only for holes', () => {
  const paths = [HOLE, STITCH, { kind: 'score', closed: true, points: square(50, 20, 10) }];
  // 10x10 hole = 100mm^2. The score groove and the stitch guide remove nothing.
  assert.equal(holeAreaMm2(paths), 100);
  assert.equal(holeAreaMm2([]), 0);
});

test('a hole does not change how much hide the piece occupies', () => {
  // The piece still takes up its full outline; the hole is waste trapped
  // inside it. Nesting and utilization are deliberately unaffected.
  assert.equal(polygonArea(OUTLINE), 6000);
  assert.equal(holeAreaMm2([HOLE]), 100);
});
