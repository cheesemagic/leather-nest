// test/nesting.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { nest } from '../src/nesting/index.js';
import { boundingBox, placedPolygon, polygonContains } from '../src/nesting/geometry.js';
import { resolveClearances } from '../src/nesting/clearance.js';

function intersectionArea(polyA, polyB) {
  const SCALE = 1000;
  const toClipper = (poly) =>
    poly.map((p) => new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE)));
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(toClipper(polyA), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(toClipper(polyB), ClipperLib.PolyType.ptClip, true);
  const solution = new ClipperLib.Paths();
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  let area = 0;
  for (const path of solution) {
    area += Math.abs(ClipperLib.Clipper.Area(path));
  }
  return area / (SCALE * SCALE);
}

test('two known rectangles nest onto a sheet without overlapping and within bounds', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const partA = {
    id: 'A',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
    allowedRotations: [0, 180],
  };
  const partB = {
    id: 'B',
    polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 50 }, { x: 0, y: 50 }],
    allowedRotations: [0, 180],
  };

  const result = nest(sheet, [partA, partB]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 2);

  const sheetBounds = boundingBox(sheet);
  const partsById = new Map([partA, partB].map((p) => [p.id, p]));
  const absolutePolygons = result.placements.map((placement) =>
    placedPolygon(partsById.get(placement.id), placement)
  );

  for (const poly of absolutePolygons) {
    const bounds = boundingBox(poly);
    assert.ok(bounds.minX >= sheetBounds.minX - 1e-6);
    assert.ok(bounds.minY >= sheetBounds.minY - 1e-6);
    assert.ok(bounds.maxX <= sheetBounds.maxX + 1e-6);
    assert.ok(bounds.maxY <= sheetBounds.maxY + 1e-6);
  }

  const overlap = intersectionArea(absolutePolygons[0], absolutePolygons[1]);
  assert.ok(overlap < 1e-3, `expected no overlap, got area ${overlap}`);
});

test('an oversized part produces noFit instead of throwing', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const partC = {
    id: 'C',
    polygon: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }],
    allowedRotations: [0],
  };

  const result = nest(sheet, [partC]);

  assert.deepEqual(result.noFit, ['C']);
  assert.equal(result.placements.length, 0);
});

test('a part with no allowedRotations (legacy record) still places instead of throwing', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const legacyPart = {
    id: 'D',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
    // no allowedRotations key, as on records predating the metadata feature
  };

  const result = nest(sheet, [legacyPart]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 1);
});

test('a part that fits the bounding box but not the real outline is reported noFit', () => {
  // A triangle occupying the lower-left half of a 100x100 bounding box.
  const triangleSheet = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  // 60x60 fits the 100x100 bounding box easily, but cannot fit inside the
  // triangle at any position.
  const part = {
    id: 'big-square',
    polygon: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
    ],
    allowedRotations: [0],
  };

  const result = nest(triangleSheet, [part]);

  assert.equal(result.placements.length, 0);
  assert.deepEqual(result.noFit, ['big-square']);
});

test('a part small enough for the real outline still places inside an irregular sheet', () => {
  const triangleSheet = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  const part = {
    id: 'small',
    polygon: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    allowedRotations: [0],
  };

  const result = nest(triangleSheet, [part]);

  assert.equal(result.noFit.length, 0);
  assert.equal(result.placements.length, 1);
});

function minGapBetween(polyA, polyB) {
  // Smallest distance between any vertex of one and any edge of the other,
  // which is enough for the axis-aligned rectangles used in these tests.
  const pointToSegment = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  };
  let min = Infinity;
  for (const [from, to] of [[polyA, polyB], [polyB, polyA]]) {
    for (const p of from) {
      for (let i = 0; i < to.length; i++) {
        min = Math.min(min, pointToSegment(p, to[i], to[(i + 1) % to.length]));
      }
    }
  }
  return min;
}

const SQUARE_20 = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

const WIDE_SHEET = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 100 },
  { x: 0, y: 100 },
];

test('a job-level clearance separates placed parts by at least that much', () => {
  const parts = [
    { id: 'A', polygon: SQUARE_20, allowedRotations: [0] },
    { id: 'B', polygon: SQUARE_20, allowedRotations: [0] },
  ];

  const result = nest(WIDE_SHEET, parts, { clearanceMm: 6 });

  assert.equal(result.placements.length, 2);
  const placedPolys = result.placements.map((p) =>
    placedPolygon(parts.find((q) => q.id === p.id), p)
  );
  const gap = minGapBetween(placedPolys[0], placedPolys[1]);
  assert.ok(gap >= 6 - 1e-6, `gap was ${gap}`);
});

test('clearances are NOT shared: 8mm beside 2mm leaves 10mm, not 5mm', () => {
  const parts = [
    { id: 'needy', polygon: SQUARE_20, allowedRotations: [0], clearanceMm: 8 },
    { id: 'modest', polygon: SQUARE_20, allowedRotations: [0], clearanceMm: 2 },
  ];

  const result = nest(WIDE_SHEET, parts);

  assert.equal(result.placements.length, 2);
  const placedPolys = result.placements.map((p) =>
    placedPolygon(parts.find((q) => q.id === p.id), p)
  );
  const gap = minGapBetween(placedPolys[0], placedPolys[1]);
  assert.ok(gap >= 10 - 1e-6, `expected >= 10mm, got ${gap}`);
});

test("a part's own clearanceMm overrides the job default", () => {
  const parts = [
    { id: 'A', polygon: SQUARE_20, allowedRotations: [0], clearanceMm: 0 },
    { id: 'B', polygon: SQUARE_20, allowedRotations: [0], clearanceMm: 0 },
  ];

  const result = nest(WIDE_SHEET, parts, { clearanceMm: 30 });

  const placedPolys = result.placements.map((p) =>
    placedPolygon(parts.find((q) => q.id === p.id), p)
  );
  assert.ok(
    minGapBetween(placedPolys[0], placedPolys[1]) < 1,
    'parts overriding to 0 should nest flush despite the job default'
  );
});

test('a part is never placed straddling a notch even when its edges are exactly collinear with the notch walls (collinear-edge false-accept regression)', () => {
  // C-shaped sheet with a notch cut from the middle of the top: air occupies
  // x 30..70, y 25..60. Before the polygonContains fix, an all-integer grid
  // scan could place a part flush against the notch walls (collinear edges)
  // that reads as "contained" by the cheap tests alone while half its area
  // sits over the notch. Concretely: G at (30, 20) used to be accepted.
  const notchedSheet = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 70, y: 60 },
    { x: 70, y: 25 },
    { x: 30, y: 25 },
    { x: 30, y: 60 },
    { x: 0, y: 60 },
  ];
  const partF = {
    id: 'F',
    polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }],
    allowedRotations: [0],
  };
  const partG = {
    id: 'G',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }],
    allowedRotations: [0],
  };

  const result = nest(notchedSheet, [partF, partG]);

  const gPlacement = result.placements.find((p) => p.id === 'G');
  assert.ok(!gPlacement || !(gPlacement.x === 30 && gPlacement.y === 20), 'G must not be placed at (30, 20), which sits over the notch');

  // Stronger check: whatever got placed, none of it may sit outside the
  // sheet's true outline.
  const partsById = new Map([partF, partG].map((p) => [p.id, p]));
  for (const placement of result.placements) {
    const poly = placedPolygon(partsById.get(placement.id), placement);
    assert.equal(
      polygonContains(notchedSheet, poly),
      true,
      `placed part ${placement.id} must lie entirely within the sheet`
    );
  }
});

test('Infinity clearanceMm is treated as 0 rather than crashing', () => {
  const parts = [{ id: 'A', polygon: SQUARE_20, allowedRotations: [0] }];

  const flush = nest(WIDE_SHEET, parts, { clearanceMm: 0 });
  const infinite = nest(WIDE_SHEET, parts, { clearanceMm: Infinity });

  assert.deepEqual(infinite.placements, flush.placements);
});

test('a finite but absurd clearanceMm reports noFit instead of crashing clipper', () => {
  // 1e18 passes Number.isFinite but overflows clipper's coordinate range,
  // where clipper reports the error by calling alert() — it throws in Node
  // and returns silently in a browser. Unlike Infinity (spec: treat as 0),
  // this is a real request that simply cannot be satisfied, so the honest
  // answer is noFit rather than quietly ignoring the clearance.
  const parts = [{ id: 'A', polygon: SQUARE_20, allowedRotations: [0] }];

  const result = nest(WIDE_SHEET, parts, { clearanceMm: 1e18 });

  assert.deepEqual(result.noFit, ['A']);
  assert.equal(result.placements.length, 0);
});

test('clearance holds a part off the sheet edge', () => {
  const parts = [{ id: 'A', polygon: SQUARE_20, allowedRotations: [0] }];

  const flush = nest(WIDE_SHEET, parts);
  const inset = nest(WIDE_SHEET, parts, { clearanceMm: 5 });

  assert.equal(flush.placements[0].x, 0);
  assert.ok(inset.placements[0].x >= 5 - 1e-6, `x was ${inset.placements[0].x}`);
  assert.ok(inset.placements[0].y >= 5 - 1e-6, `y was ${inset.placements[0].y}`);
});

test('resolveClearances output feeds nest() with unshared die clearances', () => {
  // Proves the two halves agree on the field name and on B's unshared
  // semantics: two 8mm dies leave 16mm, not 8mm.
  const components = [
    { id: 'A', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: 8 },
    { id: 'B', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: 8 },
    { id: 'C', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: null },
  ];

  const { parts, noDie } = resolveClearances(components, { method: 'die' });
  assert.deepEqual(noDie, ['C'], 'the untooled component never reaches the nester');

  const result = nest(WIDE_SHEET, parts);

  assert.equal(result.placements.length, 2);
  assert.deepEqual(result.noFit, [], 'noFit stays empty — C was excluded, not unfittable');

  const placedPolys = result.placements.map((p) =>
    placedPolygon(parts.find((q) => q.id === p.id), p)
  );
  const gap = minGapBetween(placedPolys[0], placedPolys[1]);
  assert.ok(gap >= 16 - 1e-6, `expected >= 16mm between two 8mm dies, got ${gap}`);
});

test('a failed part short-circuits later parts of the same component', () => {
  // The sheet fits exactly one 80x50. The 2nd and 3rd are doomed the moment
  // the 1st is placed, so they must be reported noFit without scanning.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const parts = [
    { id: 'big#0', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#1', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#2', componentId: 'big', polygon: big, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.equal(result.placements.length, 1);
  assert.deepEqual(result.noFit, ['big#1', 'big#2']);
});

test('the skip is per-component: a different component is still tried', () => {
  // This is the test that fails if the skip is global rather than keyed on
  // componentId — the small part fits easily and must still be placed.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const small = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
  const parts = [
    { id: 'big#0', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#1', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'small#0', componentId: 'small', polygon: small, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.deepEqual(result.noFit, ['big#1']);
  assert.ok(
    result.placements.some((p) => p.id === 'small#0'),
    'a different component must still be scanned after big failed'
  );
});

test('parts without componentId are never skipped', () => {
  // Backward compatibility: identical parts with no componentId each get
  // their own scan, exactly as before this feature.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const parts = [
    { id: 'a', polygon: big, allowedRotations: [0] },
    { id: 'b', polygon: big, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.equal(result.placements.length, 1);
  assert.deepEqual(result.noFit, ['b']);
});

test('a coarser gridStepMm lands placements on multiples of that step', () => {
  // The grid step is a packing-QUALITY knob, not a correctness one: every
  // placement still passes the same containment and overlap checks, so a
  // coarse layout is genuinely cuttable — it just packs less tightly.
  // Measured on a real hide: 1mm found 277 keepers in 172s, 5mm found 234
  // in 5.5s. Both are real layouts.
  const sheet = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const small = [{ x: 0, y: 0 }, { x: 13, y: 0 }, { x: 13, y: 13 }, { x: 0, y: 13 }];
  const parts = Array.from({ length: 8 }, (_, i) => ({
    id: `s#${i}`,
    polygon: small,
    allowedRotations: [0],
  }));

  const coarse = nest(sheet, parts, { gridStepMm: 10 });

  assert.ok(coarse.placements.length > 0);
  for (const p of coarse.placements) {
    assert.equal(p.x % 10, 0, `x=${p.x} is not on the 10mm grid`);
    assert.equal(p.y % 10, 0, `y=${p.y} is not on the 10mm grid`);
  }
});

test('omitting gridStepMm reproduces the 1mm result exactly', () => {
  // The nester's own default stays 1mm, so src/app.js and every existing
  // caller are untouched by this option existing.
  const sheet = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const small = [{ x: 0, y: 0 }, { x: 13, y: 0 }, { x: 13, y: 13 }, { x: 0, y: 13 }];
  const parts = Array.from({ length: 5 }, (_, i) => ({
    id: `s#${i}`,
    polygon: small,
    allowedRotations: [0],
  }));

  const omitted = nest(sheet, parts);
  const explicit = nest(sheet, parts, { gridStepMm: 1 });

  assert.deepEqual(omitted.placements, explicit.placements);
});

test('a non-positive or non-finite gridStepMm falls back to 1mm instead of hanging', () => {
  // A step of 0 would loop forever and NaN would exit immediately, placing
  // nothing. Same guard as clearanceMm, for the same reason.
  const sheet = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const small = [{ x: 0, y: 0 }, { x: 13, y: 0 }, { x: 13, y: 13 }, { x: 0, y: 13 }];
  const parts = [{ id: 'a', polygon: small, allowedRotations: [0] }];
  const baseline = nest(sheet, parts).placements;

  for (const gridStepMm of [0, -5, NaN, Infinity, 'big', null]) {
    const result = nest(sheet, parts, { gridStepMm });
    assert.deepEqual(result.placements, baseline, `gridStepMm=${String(gridStepMm)}`);
  }
});

test('many parts of one component all place when they all fit', () => {
  // Found by mutation testing: marking a component failed on SUCCESS instead
  // of on failure caps every component at one piece — and the whole suite
  // still passed, because no other test had two successes sharing a
  // componentId. For a feature whose entire job is "how many of these fit",
  // that bug would be catastrophic and completely silent.
  const sheet = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
  const small = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  const parts = Array.from({ length: 5 }, (_, i) => ({
    id: `s#${i}`,
    componentId: 's',
    polygon: small,
    allowedRotations: [0],
  }));

  const result = nest(sheet, parts);

  assert.equal(result.placements.length, 5, 'a success must not poison its own component');
  assert.deepEqual(result.noFit, []);
});

test('a componentId-less failure does not short-circuit a later componentId-less part', () => {
  // Also found by mutation testing: skipping on an undefined componentId
  // needs THREE parts to show up. With only two (one fits, one fails) the
  // bug is invisible, because there is no third part left to wrongly skip.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const small = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
  const parts = [
    { id: 'first-big', polygon: big, allowedRotations: [0] },
    { id: 'doomed-big', polygon: big, allowedRotations: [0] },
    { id: 'small-after', polygon: small, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.deepEqual(result.noFit, ['doomed-big']);
  assert.ok(
    result.placements.some((p) => p.id === 'small-after'),
    'a part with no componentId must still be scanned after an earlier one failed'
  );
});

test('big parts are placed before small ones, whatever order they arrive in', () => {
  // Placement is greedy, so whatever goes first gets the run of the sheet.
  // Big parts need big gaps and cannot use the scraps small ones leave;
  // small parts can always use the scraps big ones leave. Feeding them in
  // arrival order lets the component store decide the layout.
  //
  // Measured on mixed jobs, biggest-first against smallest-first: 64.2% of
  // the real offcut against 58.5%, a rectangle 74.7% against 64.6%. Positive
  // on every hide tried.
  const sheet = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }];
  const big = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 100 }, { x: 0, y: 100 }];
  const small = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];

  // Small parts first, deliberately: enough of them to carpet the sheet and
  // leave nowhere for a big one if they are taken at their word.
  const parts = [
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, componentId: 's', polygon: small, allowedRotations: [0],
    })),
    { id: 'b0', componentId: 'b', polygon: big, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts, { clearanceMm: 1, gridStepMm: 5 });
  const placedBig = result.placements.some((p) => p.id === 'b0');
  assert.ok(placedBig, 'the big part was crowded out by parts fed in before it');
});

test('parts of the same size keep their original order', () => {
  // Stable, so parts of one component stay together and the skip that
  // short-circuits a failed component still fires.
  const sheet = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 100 }, { x: 0, y: 100 }];
  const square = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const parts = ['a', 'b', 'c', 'd'].map((id) => ({
    id, componentId: id, polygon: square, allowedRotations: [0],
  }));

  const result = nest(sheet, parts, { clearanceMm: 1, gridStepMm: 5 });
  assert.deepEqual(result.placements.map((p) => p.id), ['a', 'b', 'c', 'd']);
});
