# Photo Digitization Pipeline: Design Spec

**Date:** 2026-08-31
**Status:** Approved for implementation planning

## Context

`leather-nest` v0 proved the core nesting algorithm works, using two hardcoded
pattern shapes. To be actually useful, the user needs to bring in their real
pattern pieces. Their pattern pieces currently exist only as physical
templates (no digital files), and they want to photograph a piece on their
phone and have the software extract its outline automatically.

This is the first of three sub-projects toward that goal:

1. **Photo digitization pipeline** (this spec) — photo in, accurate polygon
   out. No persistence, no library, no nesting integration.
2. **Pattern library** (future) — save, name, browse, delete digitized
   patterns; decides whether/how source photos are retained.
3. **Nesting integration** (future) — let a nesting job pull patterns from
   the library instead of the hardcoded parts in `app.js`.

This spec covers only #1. It must produce a working, testable digitization
pipeline on its own, with clean seams for #2 and #3 to build on later.

## Goals

- Upload a phone photo of a pattern piece (photographed on a solid-color
  mat) through a web page.
- Calibrate real-world scale by clicking two points in the photo and
  entering the real-world distance between them (mm).
- Extract the piece's outline as a clean polygon, in mm, in the same
  `{x, y}[]` format used throughout the rest of the codebase.
- Show the extracted polygon back to the user so they can visually confirm
  it's correct before trusting it.

## Non-goals (this sub-project)

- Saving, naming, or reusing digitized patterns (sub-project #2).
- Deleting or retaining the uploaded photo beyond the single request that
  processes it — this endpoint is stateless.
- Wiring digitized patterns into an actual nesting job (sub-project #3).
- Live webcam capture — upload-only, per the user's stated workflow (phone
  photo, then upload).
- A printed calibration mat or fiducial marker — ruler-click calibration
  only, per the user's stated preference for "whatever's easiest to build."
- Handling patterns photographed against cluttered/inconsistent
  backgrounds — a solid-color mat is assumed, per the user's confirmed
  workflow.

## Architecture

The existing single-language-JS constraint from v0 is deliberately broken
here: contour extraction from a real photo is genuinely hard to get right
in pure JS, and OpenCV already solves it well. A small Python script does
the actual computer-vision work; the existing Node server gains one new
route that shells out to it. This was anticipated in the v0 spec's Future
Work section ("likely Python/OpenCV, once this feature actually exists") —
this is that point.

```
leather-nest/
  scripts/
    digitize.py              # NEW: photo + calibration -> polygon (mm), JSON on stdout
  server.js                   # MODIFIED: adds POST /digitize route
  public/
    digitize.html              # NEW: upload + calibration-click UI
  src/
    digitize-app.js             # NEW: browser logic for the digitize page
  test/
    digitize.test.js             # NEW: node:test, runs the real script against a fixture
    fixtures/
      generate-test-image.py      # NEW: one-time script generating the test fixture
      test-rectangle.png           # NEW: checked-in fixture (generated, not hand-drawn)
  requirements.txt              # NEW: opencv-python, numpy
```

**New dependencies:**
- Python (`opencv-python`, `numpy`) via `pip install -r requirements.txt` —
  a one-time manual setup step, documented in the README, analogous to
  `npm install`.
- `formidable` (npm) — parses the multipart file upload. Hand-rolling
  multipart/form-data parsing correctly (boundary detection, binary
  safety, streaming) is a real bug farm; this is the one place so far in
  the project where a new npm dependency is justified over writing it
  ourselves.

## Components

### `scripts/digitize.py`

Invoked as: `python3 scripts/digitize.py <image_path> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>`
(pixel coordinates for the two calibration points, as given by the browser).

Algorithm:
1. Read the image (`cv2.imread`). If it fails to load, exit 1 with a clear
   stderr message.
2. Convert to grayscale, then Otsu-threshold it (`cv2.threshold` with
   `THRESH_OTSU`) — automatic, adapts to actual lighting rather than a
   fixed brightness cutoff.
3. **Threshold-direction ambiguity, resolved without asking the user to
   care about it:** run `cv2.findContours` (`RETR_EXTERNAL`,
   `CHAIN_APPROX_SIMPLE`) against BOTH the normal and inverted threshold
   (since we don't know in advance whether the pattern piece is darker or
   lighter than the mat). From all contours found across both attempts,
   discard any whose area is below 1% or above 90% of the total image
   area (excludes noise specks and the image border / whole-mat
   contours), then take the single largest remaining contour as the
   pattern piece. If nothing survives this filter, exit 1 with: "No clear
   pattern outline detected — check lighting/contrast against the mat."
4. Simplify the contour with `cv2.approxPolyDP` (epsilon as a small
   fraction of the contour's perimeter — smooths pixel-level jaggies
   without losing real shape detail; exact epsilon fraction is an
   implementation/tuning detail, refined against the test fixture during
   the implementation plan).
5. Compute the calibration scale: pixel distance between the two given
   points, divided into the given real-world mm distance. If the two
   points are identical (zero pixel distance), exit 1 with: "Calibration
   points must be distinct."
6. Convert every contour point from pixels to mm using that scale, then
   normalize so the polygon's own minimum corner sits at `(0, 0)` —
   matching the same origin convention `normalizeToOrigin` already
   establishes elsewhere in this codebase, so the output composes cleanly
   with the rest of the system later.
7. Print `{"polygon": [{"x": ..., "y": ...}, ...]}` to stdout and exit 0.

All error paths: non-zero exit code, human-readable message on stderr,
nothing on stdout.

### `server.js` — `POST /digitize`

- Parses the incoming multipart request with `formidable`: fields
  `p1x, p1y, p2x, p2y, realDistanceMm` (numbers) and a file field `photo`.
  `formidable` writes the uploaded photo to a temp path automatically.
- Spawns `python3 scripts/digitize.py <tempImagePath> <p1x> <p1y> <p2x> <p2y> <realDistanceMm>`
  via `child_process.execFile` (arguments passed as an array, never
  interpolated into a shell string — avoids shell injection from
  attacker-controlled input, even though this is a local single-user
  tool, this costs nothing to do right).
- On exit 0: parses stdout as JSON, responds `200` with
  `{"polygon": [...]}`.
- On non-zero exit: responds `422` with `{"error": "<stderr message>"}`.
- Always deletes the temp uploaded file afterward, regardless of outcome
  — per this sub-project's stateless/ephemeral scope; persistence is
  sub-project #2's concern.

### `public/digitize.html` + `src/digitize-app.js`

- A file input (`<input type="file" accept="image/*">`) for the photo.
- Once a photo is selected, it's displayed and the user clicks two points
  on it (in the photo's natural pixel coordinates, accounting for any
  CSS display scaling); each click drops a visible marker. After two
  clicks, a text input appears for "real-world distance between these
  points (mm)" plus a "Digitize" button.
- On submit: builds a `FormData` with the photo file and the five
  calibration values, `fetch`-POSTs to `/digitize`.
- On success: renders the returned polygon as its own small SVG (using
  the existing `polygonToSVGPoints` convention from `geometry.js`),
  labeled with its bounding-box width/height in mm — a separate rendering
  from the source photo, not an overlay back onto it. This is simpler
  than back-converting mm to photo-pixel-space for an overlay and is
  sufficient to visually confirm correctness (does the shape look right,
  are the dimensions plausible).
- On failure: displays the server's error message plainly.

## Error Handling

Every failure mode (bad image, no detectable outline, degenerate
calibration) surfaces as a clear, specific message to the user — never a
silent wrong answer, never a raw stack trace. This mirrors the error
philosophy already established in v0 (`place.js`'s `noFit` handling).

## Testing

A `node:test` file (`test/digitize.test.js`) invokes the real
`scripts/digitize.py` via `child_process.execFileSync` against a checked-in
synthetic fixture — not a mock, the actual script, actual OpenCV, actual
subprocess boundary:

- `test/fixtures/test-rectangle.png`: a known black rectangle (e.g.
  200×100px) on a white background, generated once by
  `test/fixtures/generate-test-image.py` (checked into the repo as a
  binary artifact, not hand-drawn — the generation script is what's
  reviewed for correctness, not the PNG bytes themselves).
- Known calibration points and a known real-world distance are chosen
  such that the expected output rectangle's mm dimensions are easy to
  hand-verify (e.g., calibration points 200px apart with a 100mm real
  distance yields a 0.5mm/px scale, so the 200×100px rectangle should
  extract to roughly 100mm×50mm).
- Assert the extracted polygon's bounding box matches the expected mm
  dimensions within a small tolerance (accounting for `approxPolyDP`
  simplification and anti-aliasing at the rectangle's edges).
- A second test asserts the "no clear outline" error path: run the script
  against a uniform blank image (no contour at all) and assert non-zero
  exit + the expected stderr message.
- A third test asserts the "degenerate calibration" error path: identical
  calibration points, expect non-zero exit + the expected stderr message.

## Licensing / Attribution

`opencv-python` (Apache 2.0) and `numpy` (BSD) are used as ordinary pip
dependencies, not vendored — no code in this repo is adapted from either
project, consistent with how `clipper-lib` is used in v0.

## Future Work (sub-projects #2 and #3, separate design conversations)

- Persistent pattern library: storage format (likely one JSON file per
  pattern, or one JSON file listing many — a database is unwarranted at
  this personal-tool scale), naming, browsing/deleting, and a decision on
  whether source photos are retained.
- Nesting integration: a UI to select library patterns for a nesting job,
  replacing the two hardcoded parts in `app.js`.
- Possible future hardening: handling non-solid backgrounds, multiple
  pieces in one photo, or barrel/lens distortion correction — none of
  these are in scope until a real need for them shows up.
