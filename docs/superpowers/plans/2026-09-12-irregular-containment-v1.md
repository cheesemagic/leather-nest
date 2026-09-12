# Irregular Containment & Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nester place parts only where they genuinely lie inside
the sheet outline — not merely inside its bounding box — and give each part
a clearance requirement around its own cut line.

**Architecture:** Two pure functions in `src/nesting/geometry.js`
(`polygonContains`, `inflatePolygon`), consumed by a `src/nesting/place.js`
that keeps its existing structure: precompute per-rotation data once, then
cheap tests inside the grid scan. Containment replaces the axis-aligned
check as the *authority* while the AABB stays as a free pre-filter.
Clearance is applied by inflating each part once per rotation into a "test
shape" used for fit testing only — the reported placement is always the
true polygon.

**Tech Stack:** Node.js (`node --test`), `clipper-lib` (already a
dependency, already used). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-irregular-containment-design.md`

## Global Constraints

- The existing rectangular-sheet consumer (`public/app.html` via
  `src/app.js`) must behave **exactly** as it does today at zero
  clearance, including flush placement against all four edges.
- Containment is **boundary-inclusive**: a point exactly on the outline
  counts as inside. This is load-bearing, not cosmetic — see Task 1.
- Clearances are **not shared** between neighbours. Each part inflates by
  its *full* clearance, so a part needing 8 mm beside one needing 2 mm
  leaves 10 mm between them.
- Placements always report the **true** polygon. The inflated shape exists
  only for fit testing and must never leak into output.
- The placement *heuristic* does not change. Bottom-left-fill, first valid
  position wins, `GRID_STEP_MM = 1`. This work changes which positions are
  valid, not how they are searched.
- No matching, ranking, value scoring, utilization reporting, cutting-method
  modeling, or export changes — all later sub-projects.

---

## Task 1: `polygonContains` and `inflatePolygon`

**Files:**
- Modify: `src/nesting/geometry.js`
- Test: `test/geometry.test.js`

**Interfaces:**
- Consumes: the existing `getClipperLib`, `toClipperPath`,
  `fromClipperPath`, `SCALE` from the same module.
- Produces:
  - `pointInPolygon(pt, polygon)` → boolean, boundary-inclusive.
  - `polygonContains(outer, inner)` → boolean.
  - `inflatePolygon(polygon, mm)` → polygon grown outward by `mm`;
    returns the input unchanged for `mm <= 0` or non-finite.

  Tasks 2 and 3 (`place.js`) consume `polygonContains` and
  `inflatePolygon`.

**Why boundary-inclusive matters.** A naive ray-cast is not merely
ambiguous on the boundary, it is *asymmetric*: measured against a
rectangle at integer coordinates, a point flush on the left edge reads
inside while a point flush on the right edge reads outside. `place.js`
computes `maxX = sheetBounds.maxX - width` precisely so a part *can* sit
flush right, so a naive implementation silently rejects every flush-right
placement in the existing nest workspace, with no error anywhere. The
explicit on-segment check below is what prevents that.

- [ ] **Step 1: Write the failing tests**

Add to `test/geometry.test.js`. Add `pointInPolygon`, `polygonContains`,
and `inflatePolygon` to the existing import list from
`../src/nesting/geometry.js`, then append:

```js
const RECT = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

// A C-shape: 100x60 with a notch bitten out of the middle of the top edge.
const C_SHAPE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 70, y: 60 },
  { x: 70, y: 25 },
  { x: 30, y: 25 },
  { x: 30, y: 60 },
  { x: 0, y: 60 },
];

test('pointInPolygon treats every boundary point as inside, on all four edges', () => {
  assert.equal(pointInPolygon({ x: 50, y: 30 }, RECT), true, 'interior');
  assert.equal(pointInPolygon({ x: 0, y: 30 }, RECT), true, 'left edge');
  assert.equal(pointInPolygon({ x: 100, y: 30 }, RECT), true, 'right edge');
  assert.equal(pointInPolygon({ x: 50, y: 0 }, RECT), true, 'bottom edge');
  assert.equal(pointInPolygon({ x: 50, y: 60 }, RECT), true, 'top edge');
  assert.equal(pointInPolygon({ x: 0, y: 0 }, RECT), true, 'corner');
  assert.equal(pointInPolygon({ x: 101, y: 30 }, RECT), false, 'just outside');
});

test('polygonContains accepts a part flush against each edge of a rectangle', () => {
  const part = (x, y) => [
    { x, y },
    { x: x + 10, y },
    { x: x + 10, y: y + 10 },
    { x, y: y + 10 },
  ];
  assert.equal(polygonContains(RECT, part(0, 0)), true, 'flush bottom-left');
  assert.equal(polygonContains(RECT, part(90, 0)), true, 'flush bottom-right');
  assert.equal(polygonContains(RECT, part(0, 50)), true, 'flush top-left');
  assert.equal(polygonContains(RECT, part(90, 50)), true, 'flush top-right');
  assert.equal(polygonContains(RECT, part(95, 0)), false, 'hanging off the right');
});

test('polygonContains rejects a part spanning a concavity even when every vertex is inside', () => {
  // Both ends sit on the arms of the C; the middle crosses the notch.
  const spanner = [
    { x: 20, y: 40 },
    { x: 80, y: 40 },
    { x: 80, y: 50 },
    { x: 20, y: 50 },
  ];
  for (const pt of spanner) {
    assert.equal(pointInPolygon(pt, C_SHAPE), true, `vertex ${pt.x},${pt.y} is inside`);
  }
  assert.equal(polygonContains(C_SHAPE, spanner), false);
});

test('polygonContains accepts a part that fits inside one arm of the concavity', () => {
  const inArm = [
    { x: 5, y: 30 },
    { x: 25, y: 30 },
    { x: 25, y: 55 },
    { x: 5, y: 55 },
  ];
  assert.equal(polygonContains(C_SHAPE, inArm), true);
});

test('polygonContains returns false for degenerate input rather than throwing', () => {
  assert.equal(polygonContains(RECT, [{ x: 1, y: 1 }, { x: 2, y: 2 }]), false);
  assert.equal(polygonContains([{ x: 0, y: 0 }], RECT), false);
});

test('inflatePolygon grows a rectangle by the given mm on every side', () => {
  const grown = inflatePolygon(
    [
      { x: 0, y: 0 },
      { x: 35, y: 0 },
      { x: 35, y: 12 },
      { x: 0, y: 12 },
    ],
    0.6
  );
  const b = boundingBox(grown);
  assert.ok(Math.abs(b.maxX - b.minX - 36.2) < 1e-6, `width ${b.maxX - b.minX}`);
  assert.ok(Math.abs(b.maxY - b.minY - 13.2) < 1e-6, `height ${b.maxY - b.minY}`);
});

test('inflatePolygon returns the polygon unchanged for zero, negative, or non-finite mm', () => {
  for (const mm of [0, -3, NaN, undefined]) {
    assert.deepEqual(inflatePolygon(RECT, mm), RECT, `mm=${mm}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/geometry.test.js`
Expected: FAIL — `pointInPolygon`, `polygonContains`, and `inflatePolygon`
are not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/nesting/geometry.js`, after `boundingBox`:

```js
// Coordinates are millimetres and clipper works at 0.001mm, so a nanometre
// of slop absorbs floating-point drift from rotation without admitting any
// real gap.
const ON_SEGMENT_EPSILON = 1e-9;

function isOnSegment(pt, a, b) {
  const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
  if (Math.abs(cross) > ON_SEGMENT_EPSILON) return false;
  return (
    pt.x >= Math.min(a.x, b.x) - ON_SEGMENT_EPSILON &&
    pt.x <= Math.max(a.x, b.x) + ON_SEGMENT_EPSILON &&
    pt.y >= Math.min(a.y, b.y) - ON_SEGMENT_EPSILON &&
    pt.y <= Math.max(a.y, b.y) + ON_SEGMENT_EPSILON
  );
}

// Boundary-inclusive: a point exactly on an edge counts as inside. The
// on-segment pass runs FIRST because ray casting is not merely ambiguous on
// the boundary, it is asymmetric — a half-open convention reads a point
// flush on the left edge as inside and one flush on the right edge as
// outside. place.js deliberately allows a part to sit flush against the
// far edge, so without this pass every such placement would be rejected.
export function pointInPolygon(pt, polygon) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (isOnSegment(pt, polygon[j], polygon[i])) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Strict crossing only: collinear or merely touching segments do not count,
// which is what lets a part sit flush against the outline.
function segmentsProperlyCross(p1, p2, p3, p4) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True when `inner` lies entirely within `outer`. Both conditions are
// required: the vertex test alone admits a part spanning a concavity with
// all its corners on material, and the edge test alone admits a part
// sitting entirely outside.
export function polygonContains(outer, inner) {
  if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
  if (outer.length < 3 || inner.length < 3) return false;

  for (const pt of inner) {
    if (!pointInPolygon(pt, outer)) return false;
  }
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j];
      const d = outer[(j + 1) % outer.length];
      if (segmentsProperlyCross(a, b, c, d)) return false;
    }
  }
  return true;
}

// Grows a polygon outward by `mm` on every side. Used to apply a part's
// clearance: the inflated shape is what gets fit-tested, while the true
// polygon is what gets cut.
export function inflatePolygon(polygon, mm) {
  if (!(mm > 0)) return polygon;
  const ClipperLib = getClipperLib();
  const offset = new ClipperLib.ClipperOffset();
  offset.AddPath(toClipperPath(polygon), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, mm * SCALE);
  if (!solution.length) return polygon;

  let largest = solution[0];
  for (const path of solution) {
    if (Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(largest))) {
      largest = path;
    }
  }
  return fromClipperPath(largest);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/geometry.test.js`
Expected: PASS (all tests, including every pre-existing one).

- [ ] **Step 5: Commit**

```bash
git add src/nesting/geometry.js test/geometry.test.js
git commit -m "feat(nesting): add boundary-inclusive polygonContains and inflatePolygon"
```

---

## Task 2: real containment in `place.js`

**Files:**
- Modify: `src/nesting/place.js`
- Test: `test/nesting.test.js`

**Interfaces:**
- Consumes: `polygonContains` from Task 1.
- Produces: `place(sheetPolygon, parts)` unchanged in signature, but a part
  is now placed only where it genuinely lies inside `sheetPolygon`. Task 3
  adds the clearance option on top.

No clearance in this task — containment only, so the correctness-critical
change is reviewable on its own.

- [ ] **Step 1: Write the failing test**

Add to `test/nesting.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/nesting.test.js`
Expected: FAIL — the 60×60 part is currently accepted, because the AABB
check only compares against the triangle's 100×100 bounding box.

- [ ] **Step 3: Write the implementation**

In `src/nesting/place.js`:

Add `polygonContains` to the existing import from `./geometry.js`.

Replace the comment block at the top of `place()` (the "v0 assumes a
rectangular sheet" note, which is no longer true):

```js
  // Containment is tested against the sheet's true outline via
  // polygonContains. The axis-aligned bounds below are kept only as a free
  // pre-filter — they reject far-outside positions before any real work,
  // but they are never the authority on whether a part fits.
```

Inside the scan, the candidate is currently accepted on the overlap test
alone. Add the containment test alongside it:

```js
          if (!overlapsPlacedPart) {
            const candidate = placedPolygon(part, { x, y, rotation });
            if (polygonContains(sheetPolygon, candidate)) {
              found = { x, y, rotation, polygon: candidate };
            }
          }
```

Order matters for cost: the NFP point test is a single cheap lookup, so it
stays first and the more expensive containment test only runs on positions
that survive it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/nesting.test.js`
Expected: PASS — including every pre-existing test. The two-rectangles
case, the oversized-part case, and the legacy-rotations case must all
still pass: for a rectangular sheet, exact containment gives the identical
answer to the AABB check, which is why the existing consumer is unaffected.

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nesting/place.js test/nesting.test.js
git commit -m "feat(nesting): place parts inside the true outline, not its bounding box"
```

---

## Task 3: per-part clearance

**Files:**
- Modify: `src/nesting/place.js`
- Modify: `src/nesting/index.js`
- Test: `test/nesting.test.js`

**Interfaces:**
- Consumes: `inflatePolygon` from Task 1; the containment wiring from
  Task 2.
- Produces: `place(sheetPolygon, parts, { clearanceMm = 0 })` and
  `nest(sheetPolygon, parts, options)`. A part may override the job
  default with its own `part.clearanceMm`.

**The coordinate convention, which the implementation depends on.** The
scan's `(x, y)` stays the position of the **true** part's origin. The
inflated test shape is *not* re-normalized: built from the origin-normalized
true shape, it spans `(-c, -c)` to `(w + c, h + c)` relative to that same
origin. That keeps three things consistent without any offset arithmetic:
the reported polygon (`placedPolygon`, unchanged), the NFP (whose moving
polygon is expressed relative to the same reference point), and the scan
bounds.

- [ ] **Step 1: Write the failing tests**

Add to `test/nesting.test.js`:

```js
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

test('clearance holds a part off the sheet edge', () => {
  const parts = [{ id: 'A', polygon: SQUARE_20, allowedRotations: [0] }];

  const flush = nest(WIDE_SHEET, parts);
  const inset = nest(WIDE_SHEET, parts, { clearanceMm: 5 });

  assert.equal(flush.placements[0].x, 0);
  assert.ok(inset.placements[0].x >= 5 - 1e-6, `x was ${inset.placements[0].x}`);
  assert.ok(inset.placements[0].y >= 5 - 1e-6, `y was ${inset.placements[0].y}`);
});
```

`placedPolygon` is already exported from `../src/nesting/geometry.js`; add
it to that file's existing import list if it isn't there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/nesting.test.js`
Expected: FAIL — `nest()` takes no options, so clearance is ignored and
parts nest flush.

- [ ] **Step 3: Write the implementation**

In `src/nesting/index.js`:

```js
import { place } from './place.js';

export function nest(sheetPolygon, parts, options) {
  return place(sheetPolygon, parts, options);
}
```

In `src/nesting/place.js`, add `inflatePolygon` and `translatePolygon` to
the existing import from `./geometry.js`, then change the signature:

```js
export function place(sheetPolygon, parts, options = {}) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;
  const defaultClearanceMm = options.clearanceMm;
```

Inside the `for (const part of parts)` loop, before the rotation loop:

```js
    // Clearances are not shared between neighbours: each part reserves its
    // full clearance around its own cut line, so an 8mm part beside a 2mm
    // part ends up 10mm away. Inflating each by its FULL clearance (rather
    // than half) is what produces that.
    const rawClearance = part.clearanceMm ?? defaultClearanceMm;
    const clearanceMm = rawClearance > 0 ? rawClearance : 0;
```

Inside the rotation loop, replace the bounds and forbidden-region setup:

```js
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));

      // The test shape carries the clearance and is deliberately NOT
      // re-normalized: expressed relative to the true part's origin it
      // spans (-c,-c)..(w+c,h+c), which keeps the scan position, the NFP's
      // reference point, and the reported polygon on one shared origin.
      const testShape = inflatePolygon(normalized, clearanceMm);
      const testBounds = boundingBox(testShape);
      const testWidth = testBounds.maxX - testBounds.minX;
      const testHeight = testBounds.maxY - testBounds.minY;

      if (testWidth > sheetWidth || testHeight > sheetHeight) {
        continue;
      }

      const minX = sheetBounds.minX - testBounds.minX;
      const minY = sheetBounds.minY - testBounds.minY;
      const maxX = sheetBounds.maxX - testBounds.maxX;
      const maxY = sheetBounds.maxY - testBounds.maxY;
      const forbiddenRegions = placed.flatMap((p) => computeNFP(p.testPolygon, testShape));
      const forbiddenClipperPaths = forbiddenRegions.map(toClipperPath);
```

Change the scan's loop bounds to start at `minY`/`minX` (they previously
started at `sheetBounds.minY`/`sheetBounds.minX`):

```js
      for (let y = minY; y <= maxY && !found; y += GRID_STEP_MM) {
        for (let x = minX; x <= maxX && !found; x += GRID_STEP_MM) {
```

And change the acceptance body so containment is tested against the
inflated shape while the reported polygon stays true:

```js
          if (!overlapsPlacedPart) {
            const placedTestShape = translatePolygon(testShape, x, y);
            if (polygonContains(sheetPolygon, placedTestShape)) {
              found = {
                x,
                y,
                rotation,
                polygon: placedPolygon(part, { x, y, rotation }),
                testPolygon: placedTestShape,
              };
            }
          }
```

Finally, record the test shape alongside the true one so later parts can
compute their NFPs against it:

```js
    if (accepted) {
      placed.push({ polygon: accepted.polygon, testPolygon: accepted.testPolygon });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/nesting.test.js`
Expected: PASS — all tests, including Task 2's containment tests and every
pre-existing one. At zero clearance `inflatePolygon` returns the polygon
unchanged, so `testShape === normalized`, `testBounds` equals the old
`partBounds`, and the scan bounds reduce to exactly today's values.

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nesting/place.js src/nesting/index.js test/nesting.test.js
git commit -m "feat(nesting): add per-part clearance with unshared semantics"
```

---

## Self-Review Notes

- **Spec coverage:** `polygonContains` + `inflatePolygon` with
  boundary-inclusive semantics (Task 1), containment against the true
  outline (Task 2), per-part unshared clearance with a job default
  (Task 3). Every spec Goal maps to a task. The spec's Non-goals —
  cutting-method modeling, export kerf compensation, matching/ranking,
  defect regions, packing-quality changes — are untouched.
- **Type consistency:** `polygonContains(outer, inner)` and
  `inflatePolygon(polygon, mm)` are called in Tasks 2-3 exactly as Task 1
  defines them. `part.clearanceMm` and `options.clearanceMm` are spelled
  identically in the implementation and the tests. `placed` entries gain
  `testPolygon`, consumed only by `computeNFP` in the same file.
- **Backward compatibility:** at zero clearance the inflation is an
  identity, so Task 3's scan bounds equal today's. For a rectangular sheet,
  exact containment agrees with the AABB check, so `public/app.html` is
  unaffected — guarded by the pre-existing nesting tests, which must pass
  unchanged in both Tasks 2 and 3.
- **The test that pins the design decision:** "clearances are NOT shared"
  is the one test a half-inflation implementation fails. The uniform-
  clearance test passes either way, so without the mixed 8/2 case the
  wrong model ships looking correct.
