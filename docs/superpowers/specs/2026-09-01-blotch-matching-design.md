# Blotch-Pattern Search & Placement: Design Spec

**Date:** 2026-09-01
**Status:** Approved for implementation planning

## Context

Cutting a matched pair of panels from one long snake or exotic skin means
finding two spots on the *same* photographed hide whose color/blotch
pattern read as a pair — today done by eye. This is the second of two
sub-projects toward that goal (the first, the die library, is already
built): given a die shape (the pattern piece) and a spot the user has
already decided to cut it from, search the rest of the same skin photo for
the best-matching second spot, and let the user do this for several dies
at once without any of the results overlapping.

This is a different algorithm from the earlier cross-skin scale-matching
sub-project (2D-FFT scale-size comparison *across* different skins) — this
one compares color/blotch pattern *within* one photographed skin, searching
translation and rotation for the best match.

## Goals

- Reuse the die library (already built) as the source of template shapes.
- Upload and calibrate a skin photo (reusing the existing calibration UI),
  then select a search-bounds region (reusing the existing region-select
  UI) so the search stays within the photographed skin instead of wasting
  time on background table/ruler/other skins in frame.
- Drag a die from the library onto the photo — each drop is a "reference"
  placement at the position the user chose (rotation fixed at the die's
  stored orientation for v1 — see Non-goals).
- For each reference, search the bounded region — translating **and
  rotating** the die shape — for the best color/blotch-pattern match.
- Enforce non-overlap as a hard constraint: no placement (reference or
  found match) may overlap any other already-placed reference or match.
- Support multiple dies in one session; color-code each template's border
  to its found match so multiple simultaneous placements stay
  distinguishable.
- Persist sessions (photo + calibration + search region + placements) with
  a timestamp. Manual delete only — no automatic expiry in v1.

## Non-goals

- Native camera capture or AR-based automatic scale calibration. Discussed
  and ruled out for this web app specifically — a browser can't access the
  focus-distance/depth data this would need (that's ARKit-class,
  native-app territory). See Future Work.
- Automatic skin/subject segmentation ("magic selection"). Would need
  either a real ML dependency or a native OS capability, both a bigger
  departure than fits this sub-project. Use the manual region-select tool
  for v1. See Future Work.
- Marker/QR-code based automatic calibration. A good idea, but it's an
  improvement to calibration across *every* tool in this project, not
  specific to blotch-matching — belongs in its own sub-project. See Future
  Work.
- Rotating a reference placement after dropping it, or moving/editing any
  placement after creation (delete-and-redo only, matching this project's
  established v1 precedent for the skins and dies inventories).
- Multiple candidate matches per template (v1 returns the single best).
- Cross-skin matching — this operates within one photographed skin only,
  unlike the cross-skin scale-matching sub-project.

## Architecture

Reuses `src/calibration-ui.js` and `src/region-select-ui.js` unchanged
(both already built — calibration from the photo-digitization sub-project,
region-select from cross-skin scale-matching). Reuses the die library's
stored polygons (`src/dies/store.js`) as the source of template shapes.

New pieces:

- `scripts/blotch_match.py` — given a die's polygon, a reference position,
  the skin photo, and the set of already-occupied placements, searches the
  bounded region (translating and rotating) for the best color-matching,
  non-overlapping spot. Masked, per-channel `cv2.matchTemplate` in Lab
  color space handles translation in one call per rotation angle tried;
  looping over rotation angles (every 15°, 24 angles) covers rotation.
  Same "Python does the CV, Node orchestrates" split as every other
  sub-project.
- `src/sessions/store.js` — file-based CRUD for sessions, modeled on
  `src/skins/store.js` (has a stored photo, unlike the die library).
- `server.js` — new `/sessions` routes.
- `public/match-blotches.html` + `src/match-blotches-app.js` — upload →
  calibrate → select search region → create the session, then a die
  palette (reusing the inline-SVG thumbnail rendering already built for
  `dies-app.js`) the user drags onto the displayed photo to add
  placements.

**Unlike every earlier script in this project, `blotch_match.py` reads its
input as a single JSON payload from stdin instead of flat positional CLI
args.** This is a deliberate departure, not an inconsistency: this
script's input is genuinely variable-shaped (an arbitrary-length polygon,
an arbitrary-length list of already-occupied placements to avoid) in a way
none of the earlier scripts' fixed handful of numbers ever were — a flat
positional-arg CLI doesn't scale to that shape. Node passes the payload via
`execFile`'s `input` option (already-available functionality, no new
dependency), the same way every other script is already invoked.

**Coordinate convention:** reference/match `x`/`y` are natural pixel
coordinates of the full uploaded photo — the same convention
`calibration-ui.js`/`region-select-ui.js` already produce and the browser
needs back to render results onto the same displayed image. The die's own
polygon (stored in mm, per the die library's convention) is converted to
pixel space inside `blotch_match.py` using the calibration's `mm_per_px` —
the one place that conversion happens.

**Search parameters are initial estimates, not yet validated against real
blotch photos** (unlike the FFT scale-matching thresholds, which got tuned
against real crocodile/ostrich photos this session) — expect the rotation
step, color space handling, and match-score threshold below to need
adjustment once this runs against real skins. Flagging this now so it
isn't mistaken for settled, measured behavior the way the FFT constants
were.

## Components

### `scripts/blotch_match.py`

Invoked as `venv/bin/python3 scripts/blotch_match.py` with a JSON payload
on stdin:

```json
{
  "imagePath": "...",
  "calibration": { "p1x": 0, "p1y": 0, "p2x": 200, "p2y": 0, "realDistanceMm": 100 },
  "searchRegion": { "roiX": 0, "roiY": 0, "roiWidth": 2000, "roiHeight": 1500 },
  "diePolygon": [{ "x": 0, "y": 0 }, { "x": 40, "y": 0 }, { "x": 40, "y": 20 }, { "x": 0, "y": 20 }],
  "referencePlacement": { "x": 500, "y": 400, "rotation": 0 },
  "occupied": [
    { "polygon": [...], "x": 900, "y": 700, "rotation": 0 }
  ]
}
```

`occupied` carries every prior placement in this session (both the
reference and the found match of each earlier template) — the *current*
`referencePlacement` is not included in `occupied` by the caller; the
script treats it as occupied itself, first, before searching.

Algorithm:

1. Load the image (EXIF-aware, same `IMREAD_IGNORE_ORIENTATION` fix as the
   rest of the project), convert the search region to Lab color space.
2. Rasterize `diePolygon` (converted to pixel space via `mm_per_px`) as a
   template + mask at 0° rotation.
3. Rasterize `referencePlacement` and every entry in `occupied` onto a
   single "occupied" boolean mask, sized to the search region.
4. For each rotation angle in `0, 15, 30, ..., 345`:
   - Rotate the template and its mask.
   - For each of the 3 Lab channels, run
     `cv2.matchTemplate(region_channel, rotated_template_channel, cv2.TM_CCOEFF_NORMED, mask=rotated_mask)`
     — one call covers every translation at this rotation.
   - Average the three channels' score maps into one score map.
   - Zero out any candidate position whose footprint (rotated template's
     mask, placed at that position) would overlap the occupied mask.
   - Track the best remaining (position, score) at this rotation.
5. Across all rotation angles, take the global best (position, rotation,
   score).
6. If no valid non-overlapping candidate exists, or the best score falls
   below `MIN_MATCH_SCORE` (initial value 0.3 — unvalidated, see note
   above), output `{"match": null, "reason": "..."}`.
7. Otherwise output `{"match": {"x": ..., "y": ..., "rotation": ..., "score": ...}}`,
   `x`/`y` in the same natural-pixel convention as the input.

Same error-handling bar as the rest of the project: a malformed payload, an
empty polygon, or a search region too small all fail with a clear message
on stderr, never a silent wrong answer.

### `src/sessions/store.js`

File-based CRUD over `data/sessions/<id>.json` + `data/sessions/<id><ext>`
(the skin photo), modeled directly on `src/skins/store.js`. Fields:
`id`, `createdAt`, `photoExt`, `calibration`, `searchRegion`, `placements`
(array of `{ dieId, dieName, color, reference: {x,y,rotation}, match:
{x,y,rotation,score} | null }`). Adds one function beyond the skins
store's shape: `addPlacement(id, { dieId, dieName, reference, match })` —
reads the record, assigns `color` itself (a fixed palette of ~10 distinct
hex colors, cycled by the placement's index — the client never sends or
manages color), appends to `placements`, rewrites the file, returns the
updated record. Same `SAFE_ID` path-traversal guard pattern as the skins
and dies stores.

### `server.js` — new routes

- `POST /sessions` — multipart: `photo` (file), `p1x`/`p1y`/`p2x`/`p2y`/
  `realDistanceMm` (calibration), `roiX`/`roiY`/`roiWidth`/`roiHeight`
  (search region) → creates the session (no placements yet), `200` with
  the record.
- `POST /sessions/:id/placements` — JSON body `{ dieId, x, y, rotation }`
  → looks up the die's polygon from `src/dies/store.js`, builds the
  `blotch_match.py` payload from the session's stored calibration/search
  region/existing placements, runs the script, appends the result via
  `addPlacement`, `200` with the updated session. `404` if the session or
  die id is unknown, `422` on a search failure.
- `GET /sessions` — `200` with all session records (metadata + placements).
- `GET /sessions/:id` — `200` with one session, `404` if unknown.
- `DELETE /sessions/:id` — `204` on success, `404` if unknown.
- `GET /sessions/:id/photo` — serves the stored skin photo, `404` if
  unknown.

### `public/match-blotches.html` + `src/match-blotches-app.js`

Upload a photo → calibrate (`attachCalibration`, unchanged) → select the
search-bounds region (`attachRegionSelect`, unchanged) → `POST /sessions`.
Below that: a die palette (`GET /dies`, rendered the same inline-SVG-
thumbnail way `dies-app.js` already does) the user drags onto the
displayed photo; each drop calls `POST /sessions/:id/placements` and
renders the result — the reference outline and its found match outline
drawn in the same color, a distinct color per template. A "no match found"
result renders as a clear message instead of a bogus outline. A sessions
list (`GET /sessions`) with delete buttons, matching the inventory-list
pattern already used by the skins and dies pages.

## Error Handling

Same bar as the rest of the project: bad calibration or a too-small search
region fail with the same clear messages the existing calibration/region
tools already produce; an unknown session or die id returns a clear `404`;
`blotch_match.py` failing (malformed payload, no valid non-overlapping
candidate, score below threshold) always returns a specific, human-readable
reason — never a silently wrong placement.

## Testing

- `test/blotch-match.test.js` — `node:test`, invoking the script via
  `execFileSync` with the `input` option for stdin. Synthetic fixtures:
  two same-colored patches at a known offset within a larger canvas
  (verifies the found match position/rotation), a rotated counterpart
  (verifies rotation search), and a canvas with no free room left
  (verifies a clean "no match" result rather than a forced overlap).
- `test/sessions-store.test.js` — CRUD, modeled on `test/skins-store.test.js`.
- `test/sessions-route.test.js` — route tests, modeled on
  `test/skins-route.test.js` / `test/dies-route.test.js`.
- No automated test for `match-blotches.html`/`match-blotches-app.js` —
  browser-only UI, same established precedent as every other page in this
  project.

## Licensing / Attribution

Same as the rest of the project: `opencv-python-headless`/`numpy` used as
ordinary dependencies, nothing vendored or adapted from elsewhere.

## Future Work (separate design conversations)

- A native iOS app with camera/AR access, using this project's backend as
  a service it calls (or as a reference implementation to port) — the
  user's stated longer-term goal, explicitly out of scope for this web
  app.
- Marker/QR-code based automatic calibration (removes the two-click ruler
  step) — a general improvement across every tool in this project, not
  specific to blotch-matching.
- Automatic skin/subject segmentation ("magic selection") instead of
  manual region-select — would need a real ML dependency or a native OS
  capability.
- Rotating or otherwise editing a reference placement after dropping it.
- Returning multiple candidate matches per template instead of one.
- Automatic session expiry/cleanup, if manual delete turns out not to be
  enough in practice.
