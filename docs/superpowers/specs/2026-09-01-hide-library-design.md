# Hide Library: Design Spec

**Date:** 2026-09-01
**Status:** Approved for implementation planning

## Context

Second sub-project of the UI design handoff (after design-system +
landing page, already built and merged). The handoff's mockup calls this
screen "Hide library" — a card-grid inventory of every digitized hide with
how much of each is still usable. This project already has the underlying
inventory: the skins store (`src/skins/store.js`, `POST`/`GET /skins`),
built for the cross-skin scale-matching sub-project, and used today only
through `match-skins.html`'s bundled upload form — there is no dedicated
library/browsing page.

Per the earlier brainstorming decision, "Hides" is not a new system —
it's the existing skins store, re-skinned and extended. This sub-project
was reordered ahead of "Phone capture re-skin" because that sub-project's
"Save to library" action needs somewhere real to save an *outline* to, and
the skins store doesn't hold one today (it only holds a scale signature,
computed via a completely separate `skin_signature.py`/ROI/calibration
flow). This spec adds that missing outline field and the library page;
the phone-capture sub-project (next) will be the second way to reach the
outline-creation path this spec adds.

## Goals

- Extend the skins store with an outline polygon (mm points, from
  `digitize.py` — the same contour-outline pipeline the die library
  already uses) and a thickness field, so a hide can be represented by its
  real cuttable shape, not just its scale signature.
- Make the scale signature (`dominantWavelengthMm`/`radialSpectrum`)
  optional on the store — a hide can be created from just an outline, just
  a signature (today's only path, via `match-skins.html`, unchanged), or
  both.
- A new page, `public/hides.html`, showing every hide as a card: photo,
  species, size, thickness, remaining-area bar, capture date — searchable
  and filterable by species, per the mockup's section 1c.
- A new way to add a hide to the library from this page: photograph it,
  calibrate it, digitize its outline, enter species/thickness/name — no
  scale-signature step required.
- Fix `rankMatches()` (`src/skins/similarity.js`) to skip any hide with no
  signature instead of producing `NaN`-based comparisons — a direct
  consequence of making the signature optional; without this fix,
  `match-skins.html` would silently rank outline-only hides using garbage
  numbers instead of excluding them.

## Non-goals

- Defects (scar/flaw regions to avoid). The mockup's own state-management
  notes place this on the *nest workspace's* live client state (drawn as
  an interaction while nesting a specific hide, in "Defects mode"), not on
  the library/inventory record itself — the hide card design (section 1c)
  doesn't show defects at all. Belongs to the Nest workspace sub-project.
- Wiring a hide card's click-through to the nest workspace. The workspace
  isn't hide-aware yet (still unstyled `app.html`, doesn't load a specific
  hide by id) — that wiring is part of the Nest workspace sub-project.
  Cards in this sub-project are informational only.
- Attaching a scale signature to an already-outline-only hide after the
  fact (or vice versa). A real gap, not solved here — a hide gets whichever
  data its creation flow provided; there's no "add the other kind of data
  to an existing record" UI yet.
- Any change to `match-skins.html`/`match-skins-app.js` beyond the
  `similarity.js` fix above — its existing upload flow (signature-based,
  unchanged request shape) keeps working exactly as it does today.
- Computing "remaining area" from actual nesting history. No Jobs exist
  yet (a later sub-project) to have cut anything against a hide — every
  hide simply starts at 100% remaining, stored (not derived), so the Jobs
  sub-project can decrement it later when it exists.
- Renaming any internal identifier. Routes stay `/skins`, the store stays
  `src/skins/`, the data directory stays `data/skins/`. Only this new
  page's title, nav-adjacent copy, and user-facing labels say "Hides" —
  keeps this sub-project from touching the skin-matching code's own
  naming, and matches the "unify the data, don't rename the plumbing"
  spirit of the earlier decision to unify hides/skins in the first place.

## Architecture

Reuses three already-built pieces: `scripts/digitize.py` (contour
outline, same pipeline the die library already uses for its photo-add
path), `src/calibration-ui.js` + `src/region-select-ui.js` (the same
photo→calibrate→select-region chain `src/dies-app.js` already uses for
its photo-add path), and `src/skins/store.js` (extended, not replaced).

**`POST /skins` gains a second creation mode**, distinguished by an
explicit `captureType` form field — `"signature"` (today's only value,
also the default when the field is absent, so `match-skins-app.js`'s
existing FormData, which never sends this field, keeps working
byte-for-byte unchanged) or `"outline"` (new). This mirrors the existing
precedent in `handleCreateDie` (`server.js`), which already branches one
route on which of two payload shapes it receives (SVG upload vs.
photo+calibrate+ROI) — same idea, made explicit here via a field rather
than implicit via which files are present, since both modes send a
`photo` file.

- `captureType: "signature"` (existing, untouched): requires
  `label`/`species`/`photo`/ROI fields/calibration fields, runs
  `skin_signature.py`, calls `store.create({ label, species,
  dominantWavelengthMm, radialSpectrum, photoPath, photoExt })`.
- `captureType: "outline"` (new): requires `label`/`species`/`thicknessMm`/
  `photo`/calibration fields, optionally ROI fields (region-select before
  digitizing — a hide photo may have background clutter the same way a
  die photo can, per the die-library sub-project's own bugfix this
  session), runs `digitize.py`, calls `store.create({ label, species,
  thicknessMm, outlinePolygon, photoPath, photoExt })`.

**`src/skins/store.js`'s `create()`** accepts a superset of fields, all
except `label`/`species`/`photoPath`/`photoExt` now optional:
`dominantWavelengthMm`, `radialSpectrum`, `outlinePolygon`, `thicknessMm`.
Every new record also gets `remainingAreaPct: 100` unconditionally (not a
caller-supplied field — no code path has any other value to give it yet).
Existing records on disk are unaffected: they already carry
`dominantWavelengthMm`/`radialSpectrum`, and simply lack the new optional
fields, which is exactly the "optional" contract this change establishes.

**`src/skins/similarity.js`'s `rankMatches()`** filters out any skin
missing `dominantWavelengthMm` before grouping/pairing, so a
signature-less hide is cleanly excluded from ranking rather than producing
`Math.abs(undefined - x) === NaN` comparisons that would otherwise sort
unpredictably and silently corrupt real rankings.

```
leather-nest/
  src/
    skins/
      store.js              # MODIFIED: create() accepts new optional fields + fixed remainingAreaPct
      similarity.js          # MODIFIED: rankMatches() skips signature-less skins
    hides-app.js               # NEW: browser logic for the hide-library page
  public/
    hides.html                  # NEW: search/filter/grid + add-a-hide UI
  server.js                        # MODIFIED: POST /skins branches on captureType
  scripts/
    digitize.py                     # UNCHANGED, reused as-is
  test/
    skins-store.test.js               # MODIFIED: new fields, remainingAreaPct default
    skins-route.test.js                # MODIFIED: new captureType="outline" path
    similarity.test.js                  # MODIFIED: signature-less-skin exclusion
```

## Components

### `src/skins/store.js` (modified)

`create({ label, species, dominantWavelengthMm, radialSpectrum,
outlinePolygon, thicknessMm, photoPath, photoExt })` — all params except
`label`/`species`/`photoPath`/`photoExt` are optional (`undefined` if not
given, stored as `null` in the JSON record for a stable, greppable shape
rather than a missing key). Adds `remainingAreaPct: 100` to every new
record. `list()`/`remove()`/`photoPath()` unchanged.

### `src/skins/similarity.js` (modified)

`rankMatches(skins)` — first line of the function becomes `skins =
skins.filter((s) => s.dominantWavelengthMm != null);` before the existing
species-grouping/pairing logic, which is otherwise untouched.

### `server.js` — `POST /skins` (modified)

Reads `captureType` from the form fields (default `"signature"` if
absent). Branches:
- `"signature"`: exactly today's existing code path, unchanged.
- `"outline"`: requires `label`, `species`, `thicknessMm`, `photo`,
  `p1x`/`p1y`/`p2x`/`p2y`/`realDistanceMm`; `roiX`/`roiY`/`roiWidth`/
  `roiHeight` optional (passed through to `digitize.py` only if all four
  are present, same optional-ROI convention `digitize.py` itself already
  implements). Runs `DIGITIZE_SCRIPT` (already a `server.js` constant),
  parses its `{ polygon }` result as `outlinePolygon`, calls
  `store.create({ label, species, thicknessMm, outlinePolygon, photoPath,
  photoExt })`. `422` on a digitize failure (existing script error
  messages), `400` on missing required fields.

`GET /skins`, `GET /skins/matches`, `GET /skins/:id/photo`,
`DELETE /skins/:id` — all unchanged.

### `public/hides.html` + `src/hides-app.js` (new)

Header: title "Hides" + subtitle (count + total usable area, derived from
the list — count of records, sum of each hide's own footprint area ×
`remainingAreaPct/100`), search input (filters by species/label/id
client-side as you type), species filter tags (`.tag`, derived from the
distinct species present in the list — no hardcoded species list), "Add a
hide" button opening the add-form.

Add-a-hide form: name, species, thickness (mm) fields, a photo input
chaining `attachCalibration` → `attachRegionSelect` (identical wiring to
`dies-app.js`'s photo-mode path), submits `POST /skins` with
`captureType: "outline"` and all the fields above.

Card grid: one card per hide — photo (`.washed`), id chip, species
(heading), "size · thickness" (size computed from the outline's own
bounding box when present, else "—"), remaining-area bar (`remainingAreaPct`,
defaults 100), capture date. A hide created via the *old* signature-only
path (no `outlinePolygon`) still renders a card — size shows "—" instead
of a dimension, since there's no outline to measure.

## Error Handling

Same bar as the rest of the project: a failed digitize (blank photo,
degenerate calibration, no region selected when one's needed) returns
`digitize.py`'s own clear stderr message via the existing `422` path,
already proven correct by the die library and skin-signature routes. A
missing required field (`label`/`species`/`thicknessMm` for the outline
mode) returns `400` with a specific message, matching
`handleCreateDie`'s existing pattern. `captureType` values other than
`"signature"`/`"outline"` return `400`.

## Testing

- `test/skins-store.test.js` — extend with: `create()` accepts and
  persists `outlinePolygon`/`thicknessMm`, defaults `remainingAreaPct` to
  `100`, omitted optional fields round-trip as `null` through `list()`.
- `test/skins-route.test.js` — extend with: `POST /skins` with
  `captureType: "outline"` creates a record with the outline/thickness
  fields and no signature fields; `captureType` omitted still exercises
  the existing signature path unchanged (regression coverage for the
  default); a `400` for a missing `thicknessMm` in outline mode.
- `test/similarity.test.js` (new or extended, wherever `rankMatches`'s
  existing coverage lives) — a signature-less skin in a species group is
  excluded from every pair, and does not produce a `NaN` anywhere in the
  result.
- No automated test for `hides.html`/`hides-app.js` — browser-only UI,
  same established precedent as every other page in this project.

## Licensing / Attribution

Same as the rest of the project: `digitize.py`, `calibration-ui.js`, and
`region-select-ui.js` are already-existing project code being reused
as-is — nothing vendored or adapted from elsewhere.

## Future Work (separate design conversations)

- Attaching a scale signature to an outline-only hide (or an outline to a
  signature-only one) after creation.
- Defects (scar/flaw regions) — Nest workspace sub-project.
- Wiring a hide card's click-through into the nest workspace once it's
  hide-aware.
- Computing/decrementing real remaining area when a job is marked Cut —
  Jobs/Pattern-library sub-project.
