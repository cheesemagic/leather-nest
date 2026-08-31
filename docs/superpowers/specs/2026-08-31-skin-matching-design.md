# Cross-Skin Scale-Pattern Matching: Design Spec

**Date:** 2026-08-31
**Status:** Approved for implementation planning

## Context

Cutting a matched pair of shoes from exotic skins (cayman, crocodile, and
other scaled species) requires two hides whose scale size and spacing are
close enough that the finished pair doesn't look mismatched. Today this is
done by eye across an inventory of separately-sourced hides, and it is slow.

This is a separate capability from photo digitization (which extracts a
single pattern piece's outline for nesting) and from a second, later
sub-project — matching regions **within** one long snake skin by natural
color/blotch pattern, which needs a different algorithm (color/blotch
similarity over a sliding window within one image, not scale-frequency
comparison across many images) and is explicitly out of scope here.

Scoped as decided during design: **cross-skin matching only** (compare
separately-photographed hides to each other), for scaled species generically
(cayman, crocodile, and whatever species come later — nothing here is
species-specific; the algorithm measures whatever periodicity is actually
present in the photographed sample).

## Goals

- Build up a persistent inventory of photographed skins over time (not a
  one-shot, single-session computation — matching only becomes useful once
  a batch exists).
- For each skin: photograph it, select a representative sample region (the
  panel area that would actually get cut), calibrate real-world scale via
  two ruler-clicks, and compute a scale-size/pattern signature.
- Given the inventory, rank which skins (within the same species) are the
  closest match to each other, with the primary, most interpretable signal
  being **scale size difference in real mm** — the specific pain point named
  ("different sized scales that don't match from one cayman to the next").
- Only ever compare skins of the same species to each other.

## Non-goals

- Snake within-skin color/blotch matching (separate future sub-project,
  different algorithm).
- Color or marking-based matching for scaled species — cayman/crocodile
  matching is scale size and spacing only, not color, per the workflow this
  was scoped against.
- A pattern library for reusable **pattern pieces** (that's the photo
  digitization sub-project's future work, a different kind of "library").
- Auto-detecting whether a skin is dyed/treated — the human decides what to
  photograph and compare; the software doesn't judge authenticity.

## Architecture

Reuses `src/calibration-ui.js` (already built and working, from the photo
digitization sub-project) unchanged for the two-point/real-distance
calibration interaction — this is exactly the reuse that module was written
for. A new, small region-selection interaction (drag a rectangle) is added
alongside it, since selecting a sample panel is new functionality
calibration-ui.js was never meant to cover.

A Python script computes each skin's signature via a 2D FFT of the selected
region (same "Python does the CV, Node orchestrates" split as digitization).
Signatures and metadata persist as plain files on disk — no database, this
is dozens-of-entries scale, not thousands, matching the project's established
minimal-dependency stance.

**Important, easy-to-miss detail, called out explicitly:** `data/skins/`
holds real photos of a real inventory — private business data, not source
code. **It must be gitignored, never committed** — this project has already
been pushed to a real GitHub remote once, so this is a real, not
hypothetical, risk.

```
leather-nest/
  scripts/
    skin_signature.py        # NEW: photo+region+calibration -> signature JSON
  src/
    calibration-ui.js          # REUSED, unchanged (from digitization sub-project)
    region-select-ui.js          # NEW: drag-a-rectangle region selection
    skins/
      store.js                   # NEW: file-based CRUD for skin records
      similarity.js                 # NEW: pure JS signature comparison, no image work
    match-skins-app.js               # NEW: browser logic for the skin-matching page
  public/
    match-skins.html                   # NEW: upload/inventory/results UI
  server.js                              # MODIFIED: new /skins routes
  data/
    skins/                                # NEW, GITIGNORED: one JSON + one photo per skin
  test/
    skin-signature.test.js                 # NEW: node:test, runs skin_signature.py
    similarity.test.js                       # NEW: node:test for pure-JS ranking logic
    fixtures/
      generate-periodic-test-image.py         # NEW: synthetic periodic-pattern fixtures
```

## Components

### `scripts/skin_signature.py`

Invoked as: `venv/bin/python3 scripts/skin_signature.py <image_path> <roi_x> <roi_y> <roi_w> <roi_h> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>`

1. Crop the image to the selected region (`roi_x/y/w/h`, pixel coordinates).
2. Convert to grayscale, apply a Hann window (reduces edge artifacts in the
   FFT — a hard rectangular crop otherwise introduces spurious frequencies).
3. Compute the 2D FFT, take the power spectrum (magnitude squared).
4. Radially average the power spectrum — bin by distance from the zero
   frequency, independent of orientation. This makes the signature
   **rotation-invariant**, which matters because two photos of the same
   scale pattern won't be shot at the identical angle.
5. Convert frequency bins to real-world wavelength using the calibration
   scale (mm/px from the two calibration points, same math as digitization).
6. Find the peak of the radial spectrum, excluding the DC/near-DC bins
   (those reflect large-scale brightness gradients across the photo, not
   the scale texture) — that peak's wavelength in mm is the headline
   `dominantWavelengthMm`.
7. Output JSON: `{"dominantWavelengthMm": ..., "radialSpectrum": [...]}` — the
   full radial profile is kept as a finer-grained fingerprint, not just the
   single peak number.

Same error-handling bar as digitization: a region too small or too
low-contrast to yield a meaningful FFT peak fails clearly on stderr, never a
silent wrong number.

### `src/region-select-ui.js`

A drag-a-rectangle interaction over an already-displayed image (the same
image `calibration-ui.js` is calibrating), independent of calibration state.
Exports something like `attachRegionSelect(container, imgSrc, onComplete)`,
calling `onComplete({roiX, roiY, roiWidth, roiHeight})` in natural pixel
coordinates once a rectangle is drawn — small, focused, single-purpose,
matching the existing module's shape so the two compose naturally on one
page.

### `src/skins/store.js`

Plain `fs`-based CRUD over `data/skins/<id>.json` + `data/skins/<id>.<ext>`
(the photo, kept for human recognition in the inventory list — the
signature alone isn't visually identifiable). Fields per record: `id`,
`label`, `species` (free text, not an enum — more species than cayman are
coming, and a fixed list would need maintenance for no benefit),
`dominantWavelengthMm`, `radialSpectrum`, `createdAt`.

### `src/skins/similarity.js`

Pure JS, no image processing. Given two signatures, computes:
- **Scale-size difference in mm** — `Math.abs(a.dominantWavelengthMm - b.dominantWavelengthMm)` — the primary, most interpretable ranking signal.
- **Spectrum correlation** — a secondary indicator comparing the two full radial profiles (e.g. normalized cross-correlation), surfaced separately rather than blended into one opaque score, so results stay explainable.

A ranking function takes the full inventory, groups by `species` (exact
string match — case-insensitive/trimmed), and within each group returns all
pairs sorted by scale-size difference ascending (closest match first).
Cross-species pairs are never computed or shown.

### `server.js` — new routes

- `POST /skins` — upload photo + region + calibration + label + species,
  run `skin_signature.py`, store the record, return it.
- `GET /skins` — list all stored skins (metadata + signature, for the
  inventory view).
- `DELETE /skins/:id` — remove a skin's JSON and photo.
- `GET /skins/matches` — ranked pairs, grouped by species, using
  `similarity.js`.

### `public/match-skins.html` + `src/match-skins-app.js`

Upload a photo → calibrate (reusing `calibration-ui.js` as-is) → select the
sample region (`region-select-ui.js`) → label + species tag → submit.
Separate views for: the inventory (list of stored skins with thumbnails,
labels, computed scale size) and match results (ranked pairs per species
group, showing both the mm difference and the spectrum correlation for each
pair).

## Error Handling

Same bar as the rest of this project: a region too small/low-contrast to
compute a meaningful signature fails clearly, never silently returns a
number that looks plausible but isn't. Cross-species comparison requests are
simply never made — there's no error case there, just a filter.

## Testing

Synthetic fixtures with a **known** periodic pattern (e.g., a grid of dots
at a known real-world spacing, generated the same way digitization's
rectangle fixture was — a small script, not hand-drawn bytes):

- A known-spacing fixture's computed `dominantWavelengthMm` matches the
  known spacing within tolerance.
- Two fixtures with genuinely different known spacings score as clearly
  different (discrimination).
- Two fixtures with the *same* known spacing, one rotated relative to the
  other, score as closely matching (rotation invariance — this is the
  property the radial-averaging step exists to guarantee, so it needs its
  own direct test, not just an incidental pass).
- `similarity.js`'s species-grouping/ranking logic gets its own `node:test`
  file — pure JS, no image fixtures needed, just constructed signature
  objects.

## Licensing / Attribution

Same as digitization: `opencv-python-headless`/`numpy` (already a project
dependency from that sub-project) used as ordinary pip dependencies, nothing
vendored, nothing adapted from either project's source.

## Future Work (separate design conversations)

- Snake within-skin color/blotch matching (sub-project, different
  algorithm: sliding-window color similarity search within one photographed
  skin, not cross-skin frequency comparison).
- Species-preset UI (a mode selector bundling snake vs. scaled-species
  matching into one tool) once the snake sub-project exists to unify with.
- Editing/renaming stored skin records after creation (v1 here covers
  create/list/delete only).
