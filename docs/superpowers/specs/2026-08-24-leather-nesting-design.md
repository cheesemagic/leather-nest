# leather-nest v0: Design Spec

**Date:** 2026-08-24
**Status:** Approved for implementation planning

## Problem

Exotic leather offcuts (gator, ostrich, snake, etc.) are expensive, irregularly
shaped, and never identical from one scrap to the next. Fitting laser-cut
pattern pieces (hat components, jewelry backings, leather-good panels) onto
these scraps by eye wastes material that costs real money. Generic nesting
software either assumes uniform rectangular stock (most open-source nesters)
or is built for industrial hide-cutting lines with CCD vision systems
(TrusterCNC, ProNest) — priced and scaled for factories, not a one-operator
shop with a desktop laser.

Target hardware: Thunder Laser Nova 51, 100W CO2, Ruida controller, driven by
LightBurn.

## Goals (v0)

- Prove that a no-fit-polygon (NFP) based placement engine can nest irregular
  pattern pieces onto a sheet, respecting a grain-direction rotation
  constraint, and export a cut-ready SVG that LightBurn can open directly.
- Keep the whole stack in one language (JavaScript) with minimal dependencies.

## Non-goals (v0) — explicitly deferred

- Photo-based scrap digitization (turning a photo of a real scrap into a
  traced outline) — a future design pass, likely involving OpenCV/Python,
  once this core loop is proven.
- Defect-zone marking UI (clicking flaws on a photographed scrap to exclude
  them from placement).
- Pattern library / import of arbitrary user pattern files — v0 uses two
  hardcoded pattern shapes.
- Genetic-algorithm packing optimization (SVGnest's full GA loop) — v0 uses a
  simpler first-fit placement over the NFP data. Packing-density optimization
  is a follow-up once placement correctness is proven.
- Cost tracking / scrap provenance logging.

## Architecture

A single-language local web app: a minimal Node static file server serves a
browser page; all nesting computation runs client-side in JS. No Python, no
Electron, no external services, no build step.

```
leather-nest/
  server.js              # ~10-line Node http static server (stdlib only)
  public/
    index.html            # loads src/app.js as an ES module
  src/
    app.js                 # renders sheet + nested parts, "Export SVG" button
    nesting/
      nfp.js                # no-fit-polygon calculation (clipper-lib
                             # MinkowskiSum — see Licensing/Attribution)
      place.js               # v0 first-fit placement using NFP + rotation
                              # constraints
      index.js                # orchestrates nfp.js + place.js
    svg/
      parse.js                 # SVG path -> polygon (mm coordinates)
      export.js                 # placement result -> LightBurn-ready SVG
  test/
    nesting.test.js            # node:test assertions (see Testing)
  package.json
  README.md
```

## Components

### `src/nesting/nfp.js`

Computes the no-fit-polygon between a stationary polygon (an already-placed
part) and a moving polygon (the part being placed) via Minkowski sum, using
`clipper-lib`'s built-in `Clipper.MinkowskiSum` directly (not adapted from
SVGnest — see Licensing/Attribution below for why). Exact for convex
polygons, which covers all of v0's hardcoded test shapes.

- **Input:** two polygons, each an array of `{x, y}` points in millimeters.
- **Output:** the NFP as an array of polygons (may be non-convex, may contain
  holes).

### `src/nesting/place.js`

v0 placement algorithm: first-fit. For each part (in a fixed input order),
tries each allowed rotation, computes the NFP against the sheet boundary and
all previously-placed parts, and places the part at the first valid position
found when scanning candidate points from the sheet's bottom-left corner
(standard first-fit convention). No packing-density search or GA optimization
in v0.

- **Input:** sheet polygon, ordered list of parts. Each part is
  `{ id, polygon: [{x,y}, ...], allowedRotations: [degrees, ...] }`. Grain
  direction constrains `allowedRotations` to `[0, 180]` for grain-sensitive
  parts (free rotation `[0, 90, 180, 270]` or finer is allowed for parts
  without a grain constraint).
- **Output:** either a placement result
  `[{ id, x, y, rotation }, ...]` (one entry per successfully placed part) or
  a `noFit` result identifying which part(s) could not be placed, when not
  everything fits.

### `src/nesting/index.js`

Thin orchestration: takes the sheet and parts list, calls `nfp.js` and
`place.js`, returns the placement result described above.

### `src/svg/parse.js` and `src/svg/export.js`

`parse.js` converts an SVG `<path>`/`<polygon>` into the `{x,y}`-array polygon
format used internally (mm coordinates). `export.js` takes a placement result
and renders it to an SVG file matching LightBurn's default vector-cut
convention: mm units, `stroke="#FF0000"` (LightBurn's default cut-line color),
`stroke-width` set to a hairline (0.01mm), `fill="none"`.

### `public/index.html` + `src/app.js`

Minimal browser UI. On load: defines the two hardcoded test pattern polygons
and a hardcoded sheet rectangle, calls `nesting/index.js`, renders the sheet
and placed parts to an inline SVG preview. An "Export SVG" button triggers
`svg/export.js` and downloads the resulting file.

### `server.js`

A minimal Node `http` module static file server (no Express — avoids an
unnecessary dependency for serving a handful of static files). Serves
`public/` and `src/` so the browser can load ES modules without hitting
`file://` CORS restrictions.

## Data Flow

1. `app.js` defines: sheet rectangle (mm) + two hardcoded pattern polygons
   (mm, each with `allowedRotations`).
2. `nesting/index.js` computes placement via NFP + first-fit.
3. `app.js` renders the result as an inline SVG preview in the browser.
4. On "Export SVG" click, `svg/export.js` renders the same placement result
   to a downloadable, LightBurn-ready SVG file.

## Error Handling (v0 scope)

If a part cannot be placed on the sheet (no valid NFP-derived position
exists), `place.js` returns a `noFit` result identifying the unplaced part(s)
rather than throwing. `app.js` renders a plain "does not fit" state in the UI
instead of crashing or silently dropping the part.

## Testing

Ponytail's one-runnable-check rule applies: non-trivial branchy logic (the
NFP/placement code) gets one test file, no framework, using Node's built-in
`node:test` + `assert`:

1. **Happy path:** two known small rectangles nest onto a known sheet without
   overlapping and within sheet bounds.
2. **No-fit path:** a part larger than the sheet produces a `noFit` result
   rather than throwing.

## Licensing / Attribution

**Amended 2026-08-24, during implementation planning:** the original draft
of this spec called for adapting NFP-calculation code from SVGnest
(MIT-licensed). While translating the design into concrete implementation
tasks, `clipper-lib`'s own `Clipper.MinkowskiSum` function (confirmed present
in the installed `clipper-lib@6.4.2` package) turned out to be sufficient to
compute exact NFPs for v0's convex test shapes directly — no SVGnest code
needs to be ported. This is simpler and avoids maintaining an adapted copy of
SVGnest's more elaborate orbiting-NFP algorithm, which only earns its
complexity once concave/hole shapes are in scope (see Future Work). As a
result, no code in this repo is adapted from SVGnest, and no `NOTICE` file is
needed — `clipper-lib` is used only as a normal npm dependency (its own
Boost Software License ships with the package, as with any dependency).
SVGnest remains a useful reference if/when concave-polygon NFP support
becomes necessary.

## Future Work (separate design conversations)

- Photo-based scrap digitization (likely Python/OpenCV, per the earlier
  Approach C discussion — justified once this feature actually exists).
- Defect-zone marking UI.
- Pattern library / arbitrary pattern import.
- Genetic-algorithm packing density optimization.
- Cost/provenance tracking per scrap.
