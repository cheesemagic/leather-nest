# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local web app that nests laser-cut leather pattern pieces onto irregular
exotic-leather scrap offcuts, targeting a Thunder Laser Nova 51 (100W CO2)
driven by LightBurn. Single operator, desktop laser — not an industrial
hide-cutting system.

## Commands

```
npm install                              # Node deps (clipper-lib, formidable)
npm start                                # runs server.js, http://localhost:8080
npm test                                 # node --test (all test/*.test.js)
node --test test/nesting.test.js         # run a single test file
python3 -m venv venv && venv/bin/pip install -r requirements.txt   # one-time, for photo digitization
```

There is no build step and no test runner dependency — `node --test` is
Node's built-in runner. The server calls `venv/bin/python3` directly; the
venv never needs activating.

## Architecture

**Single-language core, one Python escape hatch.** Nesting, matching, and UI
logic are plain ES modules (`type: "module"` in package.json) run both in
Node (server, tests) and the browser (loaded as `<script type="module">`
directly from `src/`, no bundler). `server.js` is a stdlib-only
`node:http` server — no Express. Photo-based digitization (turning a photo
into a traced outline, or computing a scale signature) is the one place that
shells out to Python/OpenCV, via `child_process.execFile` in `server.js`
calling scripts in `scripts/`.

**Data model:** three independent flat-file JSON stores, all built on the
same pattern (see `src/skins/store.js`, `src/dies/store.js`,
`src/sessions/store.js`): one `.json` record per entity in a data directory
(default `data/{skins,dies,sessions}/`, overridable via `createServer()`
options — tests always override to a temp dir), `crypto.randomUUID()` ids,
an associated photo file stored alongside the record when relevant. No
database.

- **Skins/Hides** (`src/skins/`) — despite the internal name "skins", the
  user-facing feature is "Hides" (`public/hides.html`). One record can carry
  a scale signature (`dominantWavelengthMm`/`radialSpectrum`, from
  `skin_signature.py`, used by `src/skins/similarity.js`'s `rankMatches()`
  for cross-skin scale matching), an outline polygon (from `digitize.py`,
  the cuttable shape), or both — `POST /skins`'s `captureType` field
  (`"signature"` default, or `"outline"`) selects which pipeline runs.
  Deliberately not renamed to "hides" internally — see
  `docs/superpowers/specs/2026-09-01-hide-library-design.md` for why routes
  and the data directory keep the old name.
- **Dies** (`src/dies/`) — reusable pattern-piece shapes, created either by
  uploading an SVG directly (`src/svg/parse.js`) or by photo + calibration +
  region-select, digitized the same way hide outlines are.
- **Sessions** (`src/sessions/`) — a working session against one photographed
  scrap: calibration + search region + a list of die placements. Each
  placement search shells out to `scripts/blotch_match.py` (visual
  scrap-texture matching, not the NFP geometric nester) to find where on the
  scrap a die's reference placement best matches by appearance.

**Nesting engine** (`src/nesting/`) is the original, separate v0 feature —
geometric bin-packing, unrelated to the blotch-matching session flow above.
`nfp.js` computes no-fit-polygons via `clipper-lib`'s `Clipper.MinkowskiSum`
(exact for convex polygons only — see the licensing note in
`docs/superpowers/specs/2026-08-24-leather-nesting-design.md` for why this
project does *not* use SVGnest's orbiting-NFP code). `place.js` is a
first-fit placement scan; `index.js` just orchestrates the two.

**Photo pipeline shared across features:** `src/calibration-ui.js` (click
two points of known real-world distance to get a px→mm scale) and
`src/region-select-ui.js` (drag a ROI before digitizing) are reused as-is
across the dies photo-add flow, the hides outline-add flow, and standalone
`public/digitize.html`/`public/match-*.html` pages. Don't reimplement this
chain per feature — wire into the existing pair the way `src/dies-app.js`
and `src/hides-app.js` do.

**Frontend:** no framework, no bundler. Each `public/*.html` page pairs with
one `src/*-app.js` module loaded directly as an ES module. `public/index.html`
is the public landing page; the nesting tool itself lives at `public/app.html`.
`server.js`'s `serveStatic` serves any file under the repo root by path
(with a path-traversal guard), so `public/`, `src/`, and their assets are all
directly browser-reachable — no separate static/build directory.

**Route pattern:** `server.js` is a single flat `http.createServer` callback
matching on method + `req.url` (regex for `:id` segments), no router
library. Each feature's route handlers are grouped by a `createXRoutes(dataDir)`
factory closing over that feature's store — follow this pattern for new
routes rather than introducing a router dependency.

## Testing conventions

- `node:test` + `assert` only, no test framework/library.
- Route tests spin up a real server on an ephemeral port via
  `test/helpers/with-server.js`'s `withServer(fn, { withDataDir, ... })`,
  which gives each test an isolated temp data directory and tears it down
  after.
- Fixture images under `test/fixtures/` are generated by the
  `test/fixtures/generate-*.py` scripts (not committed as opaque binaries
  without a source) — regenerate rather than hand-editing if a fixture needs
  to change.
- Browser-only UI (page wiring in `src/*-app.js`) has no automated test
  coverage by established convention in this repo; don't add one unless
  asked.

## Design/planning docs

Feature work in this repo goes through a spec → plan pair under
`docs/superpowers/{specs,plans}/`, dated and named per sub-project (e.g.
`2026-09-01-hide-library-design.md` / `2026-09-01-hide-library-v1.md`).
These documents record *why*, including reordering decisions and explicit
non-goals — check them before assuming a missing feature is an oversight
rather than a deferred, documented decision.
