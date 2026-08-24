# Leather Nesting v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a no-fit-polygon (NFP) based placement engine can nest irregular pattern pieces onto a rectangular sheet, respecting a grain-direction rotation constraint, and export a cut-ready SVG for LightBurn.

**Architecture:** A single-language local web app. A minimal Node `http` static server serves a browser page; all nesting computation (NFP + first-fit placement) runs client-side in plain JS, no build step, no bundler.

**Tech Stack:** Node.js (ESM), `clipper-lib` (npm, confirmed installed at `6.4.2`) for polygon boolean/Minkowski-sum operations, Node's built-in `node:test` for tests. No frontend framework, no Express, no Python.

**Spec:** `docs/superpowers/specs/2026-08-24-leather-nesting-design.md`

## Global Constraints

- No build step or bundler — files are loaded directly by Node and by the browser as plain `<script>`/ES modules.
- Single language: JavaScript only. Python/OpenCV is explicitly out of scope for v0 (spec Non-goals).
- v0's sheet is always an axis-aligned rectangle — containment is computed via simple AABB math, not a general inner-fit-polygon (spec Non-goals / this plan's Task 4).
- Exported SVG must match LightBurn's default vector-cut convention: millimeter units, `stroke="#FF0000"`, a hairline `stroke-width`, `fill="none"` (spec: `src/svg/export.js`).
- No code in this repo is adapted from SVGnest — `clipper-lib`'s own `Clipper.MinkowskiSum` and `Clipper.PointInPolygon` are used directly (spec Licensing/Attribution, amended 2026-08-24).
- Tests use Node's built-in `node:test` + `assert/strict` only — no test framework dependency.

---

### Task 1: Project scaffolding

**Files:**
- Create: `.gitignore`
- Modify: `package.json` (already exists with only `{"dependencies": {"clipper-lib": "^6.4.2"}}` from an earlier exploratory `npm install`)
- Create: `README.md`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: an installable project skeleton with `npm start` and `npm test` scripts wired up (scripts will fail until Tasks 4 and 6 create their targets — that's expected at this point)

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
```

- [ ] **Step 2: Replace `package.json` with the full project manifest**

```json
{
  "name": "leather-nest",
  "version": "0.1.0",
  "description": "Nest laser-cut leather pattern pieces onto irregular exotic-leather scrap offcuts.",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "clipper-lib": "^6.4.2"
  }
}
```

- [ ] **Step 3: Write `README.md`**

```markdown
# leather-nest

Nests laser-cut leather pattern pieces onto irregular exotic-leather scrap
offcuts, for a Thunder Laser Nova 51 (100W CO2, LightBurn).

See `docs/superpowers/specs/2026-08-24-leather-nesting-design.md` for the
v0 design.

## Run

    npm install
    npm start

Then open http://localhost:8080 in a browser.

## Test

    npm test
```

- [ ] **Step 4: Verify the manifest is valid and dependencies install cleanly**

Run: `npm install`
Expected: exits 0, no errors, `node_modules/clipper-lib` present.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json README.md
git commit -m "chore: project scaffolding (package.json, gitignore, README)"
```

---

### Task 2: Geometry utilities

**Files:**
- Create: `src/nesting/geometry.js`
- Test: `test/geometry.test.js`

**Interfaces:**
- Consumes: `ClipperLib` as a global (`globalThis.ClipperLib`) — this task's functions read it lazily inside function bodies, never at module load time, so it's safe regardless of when the global gets set relative to this module's import.
- Produces (all named exports from `src/nesting/geometry.js`):
  - `getClipperLib(): ClipperLib` — throws if the global isn't set
  - `SCALE: number` — the mm-to-integer scale factor used for all `clipper-lib` calls (`1000`)
  - `toClipperPath(polygon: {x,y}[]): ClipperLib.IntPoint[]`
  - `fromClipperPath(path: ClipperLib.IntPoint[]): {x,y}[]`
  - `rotatePolygon(polygon: {x,y}[], degrees: number): {x,y}[]`
  - `translatePolygon(polygon: {x,y}[], dx: number, dy: number): {x,y}[]`
  - `boundingBox(polygon: {x,y}[]): {minX,minY,maxX,maxY}`
  - `normalizeToOrigin(polygon: {x,y}[]): {x,y}[]` — shifts so the min corner is `(0,0)`
  - `polygonToSVGPoints(polygon: {x,y}[]): string` — e.g. `"0,0 40,0 40,20"`

- [ ] **Step 1: Write the failing test file**

```javascript
// test/geometry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import {
  rotatePolygon,
  translatePolygon,
  boundingBox,
  normalizeToOrigin,
  polygonToSVGPoints,
  toClipperPath,
  fromClipperPath,
  getClipperLib,
} from '../src/nesting/geometry.js';

test('rotatePolygon rotates a point 90 degrees around the origin', () => {
  const square = [{ x: 1, y: 0 }];
  const rotated = rotatePolygon(square, 90);
  assert.ok(Math.abs(rotated[0].x - 0) < 1e-9);
  assert.ok(Math.abs(rotated[0].y - 1) < 1e-9);
});

test('translatePolygon shifts every point by dx, dy', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const translated = translatePolygon(polygon, 5, -2);
  assert.deepEqual(translated, [{ x: 5, y: -2 }, { x: 6, y: -1 }]);
});

test('boundingBox finds min/max x and y', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }];
  assert.deepEqual(boundingBox(polygon), { minX: 0, minY: 0, maxX: 40, maxY: 20 });
});

test('normalizeToOrigin shifts a polygon so its min corner is (0, 0)', () => {
  const polygon = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }];
  const normalized = normalizeToOrigin(polygon);
  assert.deepEqual(boundingBox(normalized), { minX: 0, minY: 0, maxX: 40, maxY: 20 });
});

test('polygonToSVGPoints formats a polygon as an SVG points attribute value', () => {
  const polygon = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }];
  assert.equal(polygonToSVGPoints(polygon), '0,0 40,0 40,20');
});

test('toClipperPath and fromClipperPath round-trip a polygon', () => {
  const polygon = [{ x: 1.5, y: 2.25 }, { x: 10, y: 0 }];
  const roundTripped = fromClipperPath(toClipperPath(polygon));
  assert.ok(Math.abs(roundTripped[0].x - 1.5) < 1e-6);
  assert.ok(Math.abs(roundTripped[0].y - 2.25) < 1e-6);
  assert.ok(Math.abs(roundTripped[1].x - 10) < 1e-6);
  assert.ok(Math.abs(roundTripped[1].y - 0) < 1e-6);
});

test('getClipperLib throws a clear error when the global is missing', () => {
  const original = globalThis.ClipperLib;
  delete globalThis.ClipperLib;
  assert.throws(() => getClipperLib(), /ClipperLib global not found/);
  globalThis.ClipperLib = original;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/geometry.test.js`
Expected: FAIL — `Cannot find module '../src/nesting/geometry.js'`

- [ ] **Step 3: Write `src/nesting/geometry.js`**

```javascript
export function getClipperLib() {
  if (!globalThis.ClipperLib) {
    throw new Error(
      'ClipperLib global not found — load clipper-lib before using nesting ' +
        'functions (see public/index.html <script> tag or test setup).'
    );
  }
  return globalThis.ClipperLib;
}

export const SCALE = 1000;

export function toClipperPath(polygon) {
  const ClipperLib = getClipperLib();
  return polygon.map(
    (p) => new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
  );
}

export function fromClipperPath(path) {
  return path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

export function rotatePolygon(polygon, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return polygon.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
}

export function translatePolygon(polygon, dx, dy) {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function boundingBox(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function normalizeToOrigin(polygon) {
  const bounds = boundingBox(polygon);
  return translatePolygon(polygon, -bounds.minX, -bounds.minY);
}

export function polygonToSVGPoints(polygon) {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/geometry.test.js`
Expected: PASS, 7/7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/geometry.js test/geometry.test.js
git commit -m "feat: add polygon geometry utilities"
```

---

### Task 3: NFP calculation

**Files:**
- Create: `src/nesting/nfp.js`
- Test: `test/nfp.test.js`

**Interfaces:**
- Consumes: `getClipperLib`, `toClipperPath`, `fromClipperPath` from `src/nesting/geometry.js` (Task 2)
- Produces: `computeNFP(stationaryPolygon: {x,y}[], movingPolygon: {x,y}[]): {x,y}[][]` — an array of NFP polygons (may be more than one region; for the convex inputs used in v0, expect exactly one). A point strictly inside one of these polygons means placing `movingPolygon`'s own origin-referenced position there would overlap `stationaryPolygon`; a point on the boundary means they touch without overlapping.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/nfp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { computeNFP } from '../src/nesting/nfp.js';
import { boundingBox, toClipperPath, SCALE } from '../src/nesting/geometry.js';

test('computeNFP of two axis-aligned squares matches the expected Minkowski sum bounds', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];

  const nfpPolygons = computeNFP(stationary, moving);

  assert.equal(nfpPolygons.length, 1);
  const bounds = boundingBox(nfpPolygons[0]);
  assert.ok(Math.abs(bounds.minX - -4) < 1e-3, `minX was ${bounds.minX}`);
  assert.ok(Math.abs(bounds.minY - -4) < 1e-3, `minY was ${bounds.minY}`);
  assert.ok(Math.abs(bounds.maxX - 10) < 1e-3, `maxX was ${bounds.maxX}`);
  assert.ok(Math.abs(bounds.maxY - 10) < 1e-3, `maxY was ${bounds.maxY}`);
});

test('a clearly overlapping reference point falls inside the NFP, a clear one falls outside', () => {
  const stationary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const moving = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const nfpPolygons = computeNFP(stationary, moving);
  const nfpPath = toClipperPath(nfpPolygons[0]);

  const overlappingPoint = new ClipperLib.IntPoint2(0, 0);
  const clearPoint = new ClipperLib.IntPoint2(20 * SCALE, 20 * SCALE);

  assert.equal(ClipperLib.Clipper.PointInPolygon(overlappingPoint, nfpPath), 1);
  assert.equal(ClipperLib.Clipper.PointInPolygon(clearPoint, nfpPath), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/nfp.test.js`
Expected: FAIL — `Cannot find module '../src/nesting/nfp.js'`

- [ ] **Step 3: Write `src/nesting/nfp.js`**

```javascript
import { getClipperLib, toClipperPath, fromClipperPath } from './geometry.js';

export function computeNFP(stationaryPolygon, movingPolygon) {
  const ClipperLib = getClipperLib();

  // NFP(A, B) = A ⊕ (-B): the Minkowski sum of the stationary polygon with
  // the moving polygon reflected through its own reference point (origin).
  // Exact for convex polygons — all of v0's hardcoded test shapes.
  const reflectedMoving = movingPolygon.map((p) => ({ x: -p.x, y: -p.y }));
  const patternPath = toClipperPath(reflectedMoving);
  const stationaryPath = toClipperPath(stationaryPolygon);

  const solutionPaths = ClipperLib.Clipper.MinkowskiSum(patternPath, stationaryPath, true);

  return solutionPaths.map(fromClipperPath);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/nfp.test.js`
Expected: PASS, 2/2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/nesting/nfp.js test/nfp.test.js
git commit -m "feat: add no-fit-polygon calculation via clipper-lib Minkowski sum"
```

---

### Task 4: Placement algorithm and nesting orchestrator

**Files:**
- Create: `src/nesting/place.js`
- Create: `src/nesting/index.js`
- Test: `test/nesting.test.js`

**Interfaces:**
- Consumes: `getClipperLib`, `boundingBox`, `rotatePolygon`, `normalizeToOrigin`, `translatePolygon`, `toClipperPath`, `SCALE` from `src/nesting/geometry.js` (Task 2); `computeNFP` from `src/nesting/nfp.js` (Task 3)
- Produces:
  - `src/nesting/place.js`: `GRID_STEP_MM: number` (`1`), `place(sheetPolygon: {x,y}[], parts: {id:string, polygon:{x,y}[], allowedRotations:number[]}[]): { placements: {id,x,y,rotation}[], noFit: string[] }`
  - `src/nesting/index.js`: `nest(sheetPolygon, parts)` — same signature and return shape as `place()`; this is the stable public entry point Task 6's browser UI imports.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/nesting.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { nest } from '../src/nesting/index.js';
import {
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  translatePolygon,
} from '../src/nesting/geometry.js';

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

function absolutePolygon(part, placement) {
  const normalized = normalizeToOrigin(rotatePolygon(part.polygon, placement.rotation));
  return translatePolygon(normalized, placement.x, placement.y);
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
    absolutePolygon(partsById.get(placement.id), placement)
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/nesting.test.js`
Expected: FAIL — `Cannot find module '../src/nesting/index.js'`

- [ ] **Step 3: Write `src/nesting/place.js`**

```javascript
import {
  getClipperLib,
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  translatePolygon,
  toClipperPath,
  SCALE,
} from './geometry.js';
import { computeNFP } from './nfp.js';

export const GRID_STEP_MM = 1;

export function place(sheetPolygon, parts) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;

  // v0 assumes a rectangular sheet, so containment is a simple AABB check
  // against sheetBounds rather than a general inner-fit-polygon (see spec
  // Non-goals). computeNFP is only used for part-vs-placed-part overlap.
  const placed = [];
  const placements = [];
  const noFit = [];

  for (const part of parts) {
    let accepted = null;

    for (const rotation of part.allowedRotations) {
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));
      const partBounds = boundingBox(normalized);
      const width = partBounds.maxX;
      const height = partBounds.maxY;

      if (width > sheetWidth || height > sheetHeight) {
        continue;
      }

      const maxX = sheetBounds.maxX - width;
      const maxY = sheetBounds.maxY - height;
      const forbiddenRegions = placed.flatMap((p) => computeNFP(p.polygon, normalized));

      let found = null;
      // Bottom-left-fill scan: rows from sheet minY upward, left to right
      // within each row, first valid position wins.
      for (let y = sheetBounds.minY; y <= maxY && !found; y += GRID_STEP_MM) {
        for (let x = sheetBounds.minX; x <= maxX && !found; x += GRID_STEP_MM) {
          const clipperPoint = new ClipperLib.IntPoint2(
            Math.round(x * SCALE),
            Math.round(y * SCALE)
          );
          const overlapsPlacedPart = forbiddenRegions.some(
            (region) =>
              ClipperLib.Clipper.PointInPolygon(clipperPoint, toClipperPath(region)) === 1
          );
          if (!overlapsPlacedPart) {
            found = { x, y, rotation, polygon: translatePolygon(normalized, x, y) };
          }
        }
      }

      if (found) {
        accepted = found;
        break;
      }
    }

    if (accepted) {
      placed.push({ polygon: accepted.polygon });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
    } else {
      noFit.push(part.id);
    }
  }

  return { placements, noFit };
}
```

- [ ] **Step 4: Write `src/nesting/index.js`**

```javascript
import { place } from './place.js';

export function nest(sheetPolygon, parts) {
  return place(sheetPolygon, parts);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/nesting.test.js`
Expected: PASS, 2/2 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/nesting/place.js src/nesting/index.js test/nesting.test.js
git commit -m "feat: add first-fit placement and nesting orchestrator"
```

---

### Task 5: SVG parse and export

**Files:**
- Create: `src/svg/parse.js`
- Create: `src/svg/export.js`
- Test: `test/svg.test.js`

**Interfaces:**
- Consumes: `boundingBox`, `rotatePolygon`, `normalizeToOrigin`, `translatePolygon`, `polygonToSVGPoints` from `src/nesting/geometry.js` (Task 2)
- Produces:
  - `src/svg/parse.js`: `parseSVGPolygon(svgString: string): {x,y}[]` — parses an SVG `<polygon points="...">` element (straight-edge shapes only; curved `<path>` parsing is future work, see spec Non-goals on pattern import)
  - `src/svg/export.js`: `exportToSVG(sheetPolygon: {x,y}[], placements: {id,x,y,rotation}[], parts: {id,polygon,allowedRotations}[]): string` — renders only the placed part outlines (not the sheet boundary) as a LightBurn-ready SVG string

- [ ] **Step 1: Write the failing test file**

```javascript
// test/svg.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSVGPolygon } from '../src/svg/parse.js';
import { exportToSVG } from '../src/svg/export.js';

test('parseSVGPolygon extracts points from a <polygon> element', () => {
  const svg = '<polygon points="0,0 40,0 40,20 0,20" />';
  const polygon = parseSVGPolygon(svg);
  assert.deepEqual(polygon, [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ]);
});

test('parseSVGPolygon throws a clear error when no points attribute is found', () => {
  assert.throws(() => parseSVGPolygon('<rect width="10" height="10" />'), /No <polygon points/);
});

test('exportToSVG renders placements as red hairline-stroke polygons sized to the sheet', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const parts = [
    {
      id: 'A',
      polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
      allowedRotations: [0, 180],
    },
  ];
  const placements = [{ id: 'A', x: 5, y: 5, rotation: 0 }];

  const svg = exportToSVG(sheet, placements, parts);

  assert.match(svg, /width="100mm"/);
  assert.match(svg, /height="60mm"/);
  assert.match(svg, /stroke="#FF0000"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /points="5,5 45,5 45,25 5,25"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/svg.test.js`
Expected: FAIL — `Cannot find module '../src/svg/parse.js'`

- [ ] **Step 3: Write `src/svg/parse.js`**

```javascript
export function parseSVGPolygon(svgString) {
  const match = svgString.match(/points\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('No <polygon points="..."> found in SVG string');
  }
  return match[1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
}
```

- [ ] **Step 4: Write `src/svg/export.js`**

```javascript
import {
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  translatePolygon,
  polygonToSVGPoints,
} from '../nesting/geometry.js';

export function exportToSVG(sheetPolygon, placements, parts) {
  const bounds = boundingBox(sheetPolygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  const polygonsMarkup = placements
    .map(({ id, x, y, rotation }) => {
      const part = partsById.get(id);
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));
      const absolute = translatePolygon(normalized, x, y);
      return `  <polygon points="${polygonToSVGPoints(absolute)}" stroke="#FF0000" stroke-width="0.01" fill="none" />`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
${polygonsMarkup}
</svg>`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/svg.test.js`
Expected: PASS, 3/3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/svg/parse.js src/svg/export.js test/svg.test.js
git commit -m "feat: add SVG polygon parsing and LightBurn-ready export"
```

---

### Task 6: Static server and browser UI (end-to-end proof)

**Files:**
- Create: `server.js`
- Create: `public/index.html`
- Create: `src/app.js`
- No automated test — v0's browser UI is verified manually (spec's Testing section scopes `node:test` to the nesting logic only)

**Interfaces:**
- Consumes: `nest` from `src/nesting/index.js` (Task 4); `boundingBox`, `rotatePolygon`, `normalizeToOrigin`, `translatePolygon`, `polygonToSVGPoints` from `src/nesting/geometry.js` (Task 2); `parseSVGPolygon` from `src/svg/parse.js` (Task 5); `exportToSVG` from `src/svg/export.js` (Task 5)
- Produces: a running local server at `http://localhost:8080` serving a page that renders the two hardcoded test parts nested onto the hardcoded sheet, with a working "Export SVG" download button. Nothing else depends on this task's outputs — it's the final integration point.

- [ ] **Step 1: Write `server.js`**

```javascript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/public/index.html' : req.url;
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`leather-nest dev server running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Write `public/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>leather-nest</title>
  </head>
  <body>
    <h1>leather-nest v0</h1>
    <div id="preview"></div>
    <button id="export-btn">Export SVG</button>
    <script src="/node_modules/clipper-lib/clipper.js"></script>
    <script type="module" src="/src/app.js"></script>
  </body>
</html>
```

Note: the classic (non-module) `<script>` tag loading `clipper-lib` must come before the `<script type="module">` tag — classic scripts run immediately during parsing, module scripts are deferred until after, so `window.ClipperLib` is guaranteed to exist before `app.js` runs.

- [ ] **Step 3: Write `src/app.js`**

```javascript
import { nest } from './nesting/index.js';
import {
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  translatePolygon,
  polygonToSVGPoints,
} from './nesting/geometry.js';
import { parseSVGPolygon } from './svg/parse.js';
import { exportToSVG } from './svg/export.js';

const sheet = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const parts = [
  {
    id: 'A',
    polygon: parseSVGPolygon('<polygon points="0,0 40,0 40,20 0,20" />'),
    allowedRotations: [0, 180],
  },
  {
    id: 'B',
    polygon: parseSVGPolygon('<polygon points="0,0 30,0 30,50 0,50" />'),
    allowedRotations: [0, 180],
  },
];

const result = nest(sheet, parts);
const partsById = new Map(parts.map((p) => [p.id, p]));

function renderPreview(sheetPolygon, placements) {
  const bounds = boundingBox(sheetPolygon);
  const sheetMarkup = `<polygon points="${polygonToSVGPoints(sheetPolygon)}" stroke="#000000" stroke-width="0.5" fill="none" />`;
  const partsMarkup = placements
    .map(({ id, x, y, rotation }) => {
      const part = partsById.get(id);
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));
      const absolute = translatePolygon(normalized, x, y);
      return `<polygon points="${polygonToSVGPoints(absolute)}" stroke="#FF0000" stroke-width="0.5" fill="none" />`;
    })
    .join('');
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return `<svg width="500" height="${(500 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">${sheetMarkup}${partsMarkup}</svg>`;
}

const previewEl = document.getElementById('preview');

if (result.noFit.length > 0) {
  previewEl.textContent = `Does not fit: ${result.noFit.join(', ')}`;
} else {
  previewEl.innerHTML = renderPreview(sheet, result.placements);
}

document.getElementById('export-btn').addEventListener('click', () => {
  const svgContent = exportToSVG(sheet, result.placements, parts);
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nested-parts.svg';
  a.click();
  URL.revokeObjectURL(url);
});
```

- [ ] **Step 4: Run the full automated test suite one more time**

Run: `npm test`
Expected: PASS, all tests across `test/geometry.test.js`, `test/nfp.test.js`, `test/nesting.test.js`, `test/svg.test.js` green.

- [ ] **Step 5: Manually verify the end-to-end loop**

Run: `npm start`

Then:
1. Open `http://localhost:8080` in a browser.
2. Confirm the page shows an inline SVG with a black rectangle outline (the sheet) and two red rectangles nested inside it, not overlapping each other.
3. Click "Export SVG". Confirm a `nested-parts.svg` file downloads.
4. Open the downloaded file in a text editor. Confirm it contains exactly two `<polygon>` elements, each with `stroke="#FF0000"` and `fill="none"`, in millimeter-scaled coordinates, and does **not** contain the black sheet-boundary polygon (only cut lines belong in the exported file).
5. Stop the server (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add server.js public/index.html src/app.js
git commit -m "feat: add static server and browser UI for end-to-end nesting proof"
```
