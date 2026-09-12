# Component Library: Design Spec

**Date:** 2026-09-12
**Status:** Approved for implementation planning

## Context

First sub-project of the scrap-to-product intelligence system. That brief
proposes inverting the usual question: instead of starting from a product
and asking what material it needs, start from the irregular scrap this app
already tracks and ask what the highest-value components are that can be
cut from it. Delivering that requires three things the app doesn't have —
a library of manufacturable components with economic metadata, a nester
that can place inside an irregular outline rather than a bounding box, and
a matching engine that ranks candidate layouts by value. Those are three
separate concerns with three separate risk profiles, so they were split
during brainstorming:

- **A — Component library (this spec).** Data and UI only, no algorithms.
- **B — Irregular containment.** Geometry only; `src/nesting/place.js`
  currently checks containment against the sheet's *axis-aligned bounding
  box* (`place.js:20-22`), not its true polygon, because it was built for
  rectangular sheets. Every utilization or value figure computed against a
  hide's bounding box would be fiction, so B is a correctness prerequisite
  for C.
- **C — Find Best Use.** The matching engine, the ranking strategies, and
  the results UI.

This spec covers A alone.

Per the decision this project has now made twice (skins→"Hides",
sessions→"Jobs"), components are not a new system. The dies store
(`src/dies/store.js`, `POST`/`GET /dies`) already holds exactly what a
component is: a named, manufacturable piece of geometry, created either by
uploading an SVG or by photographing and digitizing a physical die. This
sub-project extends that record with the economic and material metadata
the matching engine will need, and gives the page the Organic re-skin it
was already owed as a separately-queued sub-project — absorbing that work
rather than doing it twice.

## Goals

- Extend the dies store with the fields a value-aware matcher needs:
  `valuePerPiece`, `productFamily`, `allowedSpecies`, `thicknessMinMm`,
  `thicknessMaxMm`, `allowedRotations`, `demand`.
- Add a third creation path — width × height, which builds a rectangle —
  so seeding the real belt library (keepers, buckle tabs, accents) doesn't
  require authoring an SVG for what is four numbers.
- Add a metadata update path, so value and demand stay tunable without
  changing a component's id.
- Re-skin `public/dies.html` onto the Organic design system as the
  "Components" page: card grid, search, product-family filter tags.

## Non-goals

- Renaming any internal identifier. Routes stay `/dies`, the store stays
  `src/dies/`, the data directory stays `data/dies/`. Only the page's
  title, nav label, and user-facing copy say "Components" — the same
  "unify the data, don't rename the plumbing" spirit applied to
  skins/hides and sessions/jobs.
- Matching components against scraps, ranking layouts, computing value or
  utilization, and visual nesting. All of that is sub-project C, and none
  of it is implemented or stubbed here.
- Irregular-polygon containment in the nester. Sub-project B.
- Reverse search (component requirement → candidate scraps) and
  scrap-geometry analytics ("design products around recurring remnants").
  Both are explicitly deferred by the brief; this spec's only obligation
  is not to preclude them, which it satisfies by keeping components as
  first-class records with stable ids rather than as fields on a scrap.
- Editing a component's geometry. A component's shape is its identity; a
  changed shape invalidates any layout already computed against it, so a
  new shape means a new component.
- The fields the brief lists that nothing in A, B, or C would read:
  minimum grade, mirroring rules, defect tolerance,
  quantity-per-finished-product, priority, associated-finished-product.
  Each is cheap to add when something consumes it; unread schema rots.
- Any new dependency, framework, store, or design system.

## Architecture

Everything reuses what exists. `src/dies/store.js` gains fields and one
method; `handleCreateDie` in `server.js` gains a third branch alongside
the two it already has; `public/dies.html` and `src/dies-app.js` are
re-skinned following `public/hides.html`'s established conventions.

```
leather-nest/
  src/
    dies/
      store.js              # MODIFIED: new optional fields, update()
    dies-app.js              # MODIFIED: re-skin, component fields, dimensions mode, edit
  public/
    dies.html                 # MODIFIED: Organic re-skin, "Components"
  server.js                    # MODIFIED: dimensions branch, update route, field passthrough
  test/
    dies-store.test.js           # MODIFIED: new fields, update()
    dies-route.test.js            # MODIFIED: dimensions mode, update route, regressions
```

### Data model

`create()` accepts a superset of fields. `name` and `polygon` stay
required; everything below is optional and stored explicitly (as `null`
or its stated default) rather than left absent, for a stable greppable
shape:

| field | default | consumed by |
|---|---|---|
| `valuePerPiece` | `null` | C's value ranking |
| `productFamily` | `null` | browsing and filtering; C's grouping |
| `allowedSpecies` | `null` (= any species) | C's eligibility filter |
| `thicknessMinMm` | `null` (= no minimum) | C's eligibility filter |
| `thicknessMaxMm` | `null` (= no maximum) | C's eligibility filter |
| `allowedRotations` | `[0, 90, 180, 270]` | `src/nesting/place.js` already |
| `demand` | `0` | C's demand strategy |

Area, width, and height are **derived, never stored** — `polygonArea()`
and `boundingBox()` compute them from the polygon, and storing them would
invite drift against the one source of truth.

`allowedRotations` defaults permissive so packing is good by default; a
component whose grain or scale direction actually matters gets restricted
per-component. It is the one new field existing code already reads —
`place.js:31` iterates `part.allowedRotations` — so populating it now
costs nothing and unblocks B and C.

`allowedSpecies` is an array of lowercase species names. It arrives from
the form as a comma-separated string (`cayman, crocodile`) and is split
and trimmed server-side; the form is already multipart, and that is
friendlier to type than JSON. An empty value means "any species", stored
as `null` rather than `[]` so "unconstrained" and "constrained to nothing"
stay distinguishable.

**Backward compatibility.** Existing die records have none of these
fields and read back as `undefined`. This is safe by inspection rather
than by assumption: the only consumers of `/dies` are
`src/match-blotches-app.js`'s die palette and `server.js`'s placement
handler, and both read only `name` and `polygon`, which are unchanged and
always present. `public/app.html` does not use dies at all. This change is
purely additive — unlike the skins and sessions extensions, no existing
dereference can break, because no field's domain changes.

## Components

### `src/dies/store.js` (modified)

`create({ name, polygon, valuePerPiece, productFamily, allowedSpecies,
thicknessMinMm, thicknessMaxMm, allowedRotations, demand })` — all
parameters except `name` and `polygon` optional, defaulted per the table
above.

`update(id, fields)` — merges metadata into an existing record and
returns it, or `null` for an unknown id. It reads only `name`,
`valuePerPiece`, `productFamily`, `allowedSpecies`, `thicknessMinMm`,
`thicknessMaxMm`, `allowedRotations`, and `demand`; `polygon`, `id`, and
`createdAt` are never written. Name is metadata (typo fixes); shape is
identity.

`list()` and `remove()` unchanged.

### `server.js` — `POST /dies` (modified)

`handleCreateDie` today branches on which file arrived: an SVG upload, or
a photo plus calibration and ROI. It gains a third arm for width × height,
selected by those fields being present when no file is. Branching on
input presence rather than an explicit mode field keeps existing callers
byte-for-byte unchanged — `dies-app.js` sends no mode field today, and no
existing caller sends `widthMm`/`heightMm`.

- **SVG** (existing, untouched): parses via `parseSVGPolygon`.
- **Photo** (existing, untouched): requires calibration and all four ROI
  fields, runs `digitize.py`.
- **Dimensions** (new): `widthMm` and `heightMm`, both required to be
  positive finite numbers, build the rectangle
  `[{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}]` in mm — the same `{x, y}`
  point shape `digitize.py` emits and `boundingBox`/`polygonArea` expect.

All three arms pass the new metadata fields through to `store.create()`.

A rectangle is a conservative approximation of a rounded real-world
keeper: it slightly over-estimates the area consumed, so a layout that
fits as rectangles fits in reality. Under-packing honestly beats
over-promising.

### `server.js` — `POST /dies/:id` (new)

JSON body of metadata fields; calls `store.update()`. `404` for an
unknown id. POST rather than PATCH to match the existing flat method+URL
routing, which handles only GET/POST/DELETE — the same reasoning the jobs
status route followed.

`GET /dies` and `DELETE /dies/:id` unchanged.

### `public/dies.html` + `src/dies-app.js` (modified)

Re-skinned onto Organic following `public/hides.html`'s conventions: nav,
page header with a count, search input, product-family filter tags, card
grid.

**Card**: the existing SVG shape preview, the component name, a
product-family tag, value per piece, derived size (`W × H mm` from the
polygon's bounding box), and demand when non-zero. Plus Edit and Delete.

**Search and filters**: search matches name, product family, and id as
you type. Product-family tags are derived from the families actually
present in the list — no hardcoded taxonomy, the same way the hides page
derives its species tags.

**Add form**: name, a three-way creation mode (SVG upload / photograph /
dimensions), and the metadata fields. The photo mode keeps its existing
`attachCalibration` → `attachRegionSelect` chain untouched.

**Edit**: opens the metadata fields for an existing component and submits
to `POST /dies/:id`. Geometry is not offered.

## Error Handling

The existing bar. `400` for a missing name (unchanged message). `400`
when none of an SVG, a photo, or a width/height pair arrived — extending
the current message rather than replacing it. `400` for a non-positive or
non-finite `widthMm`/`heightMm`, naming the field. `422` on a digitize
failure, carrying `digitize.py`'s own stderr (unchanged). `404` for an
update to an unknown id. Store methods return `null` for unknown ids
rather than throwing, matching every other store here.

## Testing

Project convention throughout: `node --test`, real HTTP through the
`withServer` helper, real records on disk, real subprocesses for the photo
path.

- `test/dies-store.test.js` — `create()` defaults every new field
  correctly (including `allowedRotations` to all four angles and `demand`
  to `0`); given values round-trip through `list()`; `update()` changes
  metadata while leaving `polygon`, `id`, and `createdAt` untouched;
  `update()` returns `null` for an unknown id.
- `test/dies-route.test.js` — dimensions mode creates a rectangle whose
  bounding box matches the requested mm; a request with none of the three
  inputs returns `400`; a non-positive dimension returns `400`; the
  update route round-trips a value and demand change; `404` for an unknown
  id on update; and **regression coverage that the SVG and photo paths
  still produce exactly what they produce today**, since this change
  touches the handler they share.
- No automated test for `dies.html`/`dies-app.js` — browser-only UI, the
  established precedent for every page in this project.

## Licensing / Attribution

Nothing vendored or adapted. All reused code (`parseSVGPolygon`,
`digitize.py`, `calibration-ui.js`, `region-select-ui.js`,
`public/styles.css`) is existing project code.

## Future Work (separate design conversations)

- **Sub-project B** — irregular-polygon containment in `place.js`, so
  parts can be nested inside a true hide outline rather than its bounding
  box.
- **Sub-project C** — Find Best Use: eligibility filtering by species and
  thickness, candidate layout generation, ranking strategies (highest
  value, highest utilization, current demand), and the results UI with a
  visual proposed layout. The ranking must be a pluggable function over a
  set of candidate layouts, so that "highest utilization wins" is never
  hard-coded.
- Reverse search: component requirement → candidate scraps.
- Scrap-geometry analytics: mining accumulated hide and remnant outlines
  for recurring usable geometries, to suggest components worth designing.
- Remnant-value awareness: preferring a layout that leaves one large
  contiguous remnant over one that leaves several unusable fragments.
- The deferred component fields — minimum grade, mirroring rules, defect
  tolerance, quantity-per-finished-product, priority,
  associated-finished-product — each when something reads it.
