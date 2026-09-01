# Die Library: Design Spec

**Date:** 2026-08-31
**Status:** Approved for implementation planning

## Context

Cutting shoe (or other leather-good) panels uses steel-rule dies in a
clicker press — one physical die per pattern piece shape. To later search a
skin photo for panels whose blotch/color pattern matches a given piece (the
blotch-matching sub-project, planned next), the app needs a way to
represent each die's outline digitally and reuse it as a draggable
template. This is the first of two sub-projects toward that goal: a
persistent library of named die shapes. The second (out of scope here) is
the search/placement tool that drags dies onto skin photos and finds
non-overlapping, color/blotch-matched pairs.

## Goals

- Add a die to a persistent library two ways: upload an SVG file (same
  polygon format the nesting tool already imports) or photograph the die
  and digitize it (reusing the existing calibration + digitize pipeline).
- Give each die a name.
- List the library with a visual thumbnail per die (rendered from its
  stored polygon, no photo storage required).
- Delete dies from the library.

## Non-goals

- The drag-and-drop search/placement tool itself (separate sub-project,
  spec'd next).
- Editing a die's shape after creation (delete and re-add if the die
  outline was wrong — v1 covers create/list/delete only, matching this
  project's established minimal-CRUD precedent from the skins inventory).
- Any relationship or grouping between dies (e.g. "this vamp + this quarter
  make a shoe") — the library is a flat list of independent shapes for now.

## Architecture

Reuses two already-built pieces of the project: `src/svg/parse.js`'s
`parseSVGPolygon` (from the core nesting sub-project) for the upload path,
and `scripts/digitize.py` + `src/calibration-ui.js` (from the photo
digitization sub-project) for the photograph path. Both paths converge on
the same output: a polygon in the project's standard `{x, y}[]` mm
convention, normalized to origin like everywhere else in the app.

Unlike the skins inventory (which stores a photo because a scale signature
isn't visually recognizable on its own), a die record stores only its
polygon — the polygon *is* its own thumbnail, rendered client-side as
inline SVG using `polygonToSVGPoints` (already in
`src/nesting/geometry.js`). This means no photo file storage or serving
route is needed for dies at all — simpler than the skins store.

Records persist as plain JSON files on disk, same minimal-dependency stance
as the rest of the project — no database.

**Same note as the skins inventory:** `data/dies/` holds real physical
tooling shapes — not sensitive in the way skin photos are, but still real
business data, not source code. It lives under the already-gitignored
`data/` directory (added in the skin-matching sub-project), so no
additional `.gitignore` change is needed.

```
leather-nest/
  src/
    dies/
      store.js              # NEW: file-based CRUD for die records
    dies-app.js              # NEW: browser logic for the die-library page
  public/
    dies.html                  # NEW: add/list/delete UI
  server.js                    # MODIFIED: new /dies routes
  data/
    dies/                        # NEW, already gitignored via data/: one JSON per die
  test/
    dies-store.test.js             # NEW: node:test, CRUD
    dies-route.test.js               # NEW: node:test, routes (both add-paths, list, delete)
```

## Components

### `src/dies/store.js`

Plain `fs`-based CRUD over `data/dies/<id>.json`, modeled directly on
`src/skins/store.js`'s `createStore(dataDir)` shape: `{ list, create,
remove }` (no `photoPath` — dies have no photo file). Fields per record:
`id` (`crypto.randomUUID()`), `name`, `polygon` (`{x,y}[]` mm), `createdAt`
(ISO 8601). Same `SAFE_ID` path-traversal guard pattern as the skins store,
applied to `remove`.

### `server.js` — new routes

- `POST /dies` — accepts either:
  - multipart with `name` + `svg` (file) → parses via `parseSVGPolygon`, or
  - multipart with `name` + `photo` (file) +
    `p1x`/`p1y`/`p2x`/`p2y`/`realDistanceMm` → runs `scripts/digitize.py`
    exactly as `/digitize` does today.

  Either path ends by calling `store.create({ name, polygon })` and
  returning `200` with the created record. `422` with a clear error on a
  parse/digitize failure, `400` on a malformed upload or missing
  `name`/shape input.
- `GET /dies` — `200` with the array of stored records.
- `DELETE /dies/:id` — `204` on success, `404` if `id` is unknown.

### `public/dies.html` + `src/dies-app.js`

A toggle between "Upload SVG" and "Photograph a die" (the latter reusing
`attachCalibration` exactly as `digitize-app.js` does), a name field, and a
submit button. Below that, the library list: each die rendered as a small
inline `<svg>` built from `polygonToSVGPoints(die.polygon)`, its name, and
a delete button.

## Error Handling

Same bar as the rest of the project: a bad SVG (no `points` attribute —
`parseSVGPolygon` already throws a clear error for this), a failed
digitize (blank photo, degenerate calibration — `digitize.py` already
fails clearly for these), or a missing name all return a specific,
human-readable error — never a silent wrong shape or a raw stack trace.

## Testing

- `test/dies-store.test.js` — `node:test`, modeled on
  `test/skins-store.test.js`: create/list/delete round-trip, id-based
  path-traversal rejection.
- `test/dies-route.test.js` — `node:test`, modeled on
  `test/skins-route.test.js`: `POST /dies` via the SVG path, `POST /dies`
  via the photo path (reusing an existing digitize test fixture), `GET
  /dies`, `DELETE /dies/:id`, and the 400/422 error paths.
- No automated test for `dies.html`/`dies-app.js` — browser-only UI, same
  precedent as `calibration-ui.js`/`digitize-app.js`/`match-skins-app.js`.

## Licensing / Attribution

Same as the rest of the project: no vendored code, nothing adapted from
elsewhere — `parseSVGPolygon` and `digitize.py` are already-existing
project code being reused as-is.

## Future Work (separate design conversation)

- The blotch-pattern search & placement tool: drag dies from this library
  onto a skin photo; for each dropped template, search the rest of the
  photo (translating and rotating the die shape) for the best
  color/blotch-matching spot, keeping every placed template and its found
  match from overlapping each other. Matching sessions (skin photo +
  placements + results) persist with a timestamp, manually deletable — no
  automatic expiry in v1.
- Editing a die's shape or name after creation.
- Grouping related dies (e.g. into a "shoe" made of several panels).
