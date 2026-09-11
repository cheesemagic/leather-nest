# Jobs: Design Spec

**Date:** 2026-09-11
**Status:** Approved for implementation planning

## Context

Third sub-project of the UI design handoff (after design-system + landing
page, then the hide library; the phone-capture re-skin shipped separately
as a purely visual change). The handoff's mockup pairs "Patterns" and
"Jobs" on one screen. During brainstorming that pairing was split: the
pattern-library (dies) re-skin is small, purely visual, and has no
dependency on Jobs, so it becomes its own later sub-project. This spec
covers Jobs alone — the data model, the cut lifecycle, and the remaining-
area arithmetic that the hide-library sub-project explicitly deferred to
"the Jobs sub-project" when it stored `remainingAreaPct: 100` as a fixed
value no code path could yet change.

Per the same decision the hide library made, "Jobs" is not a new system —
it is the existing sessions store (`src/sessions/store.js`,
`POST`/`GET /sessions`, built for the blotch-matching sub-project),
re-skinned and extended. A session already holds nearly everything a job
needs: one photographed scrap, its calibration, its search region, and a
list of die placements. What it lacks is a link to the hide it was cut
from, a status, and a record of what it consumed.

## Goals

- Extend the sessions store with `hideId`, `status` (`"draft"`/`"cut"`),
  `cutAt`, and `consumedAreaMm2`, so a session becomes a durable record of
  work done rather than only a transient workspace.
- Marking a job Cut subtracts the area its placed pieces consumed from the
  linked hide's `remainingAreaPct` — closing the stub the hide library
  left behind.
- Make that subtraction reversible: un-cutting a job, or deleting a cut
  job, restores exactly the amount subtracted.
- A new page, `public/jobs.html`, listing every job with its hide, status,
  placement count, and dates, carrying the Mark-as-cut / Un-cut / Delete
  actions.
- A hide picker in `match-blotches.html`, so a session can be linked to a
  hide at creation.
- Add `polygonArea()` to `src/nesting/geometry.js` and use it for both the
  hide total and the placed pieces — replacing `hides-app.js`'s current
  bounding-box estimate, so the library page and the decrement arithmetic
  report the same number.

## Non-goals

- Renaming any internal identifier. Routes stay `/sessions`, the store
  stays `src/sessions/`, the data directory stays `data/sessions/`. Only
  the new page's title and user-facing copy say "Jobs" — the same "unify
  the data, don't rename the plumbing" spirit the hide library applied to
  skins/hides.
- The pattern-library (dies) re-skin onto Organic. Split out during
  brainstorming into its own sub-project; it shares the handoff's screen
  but shares no code or data with this work.
- Search and filtering on the jobs list. Job counts stay small for a
  single operator; YAGNI until they don't.
- Defects (scar/flaw regions) and the nest-workspace re-skin — still the
  Nest workspace sub-project's, unchanged by this spec.
- Editing a job's placements after it is cut, or any "recut" flow. A job
  is cut or it isn't; changing what was cut means un-cutting first.
- Any change to how placements are found (`blotch_match.py`, the
  reference/match search) or to the geometric nester in `src/nesting/`
  beyond the new `polygonArea()` export.

## Architecture

Reuses the existing stores and the existing cross-store precedent.
`createSessionsRoutes` in `server.js` already takes `diesDataDir` and
builds a die store internally; it gains `skinsDataDir` and builds a skin
store the same way. No new abstraction, no service layer — the
coordination between the two stores lives in the route handler that owns
the transition, exactly as the die lookup already does.

```
leather-nest/
  src/
    sessions/
      store.js              # MODIFIED: new fields, setStatus()
    skins/
      store.js               # MODIFIED: setRemainingAreaPct()
    nesting/
      geometry.js             # MODIFIED: new polygonArea() export
    hides-app.js               # MODIFIED: polygonArea() instead of bounding box
    jobs-app.js                 # NEW: browser logic for the jobs page
    match-blotches-app.js        # MODIFIED: hide picker, sends hideId
  public/
    jobs.html                     # NEW: job list + cut/un-cut/delete
    match-blotches.html            # MODIFIED: hide picker markup
  server.js                         # MODIFIED: hideId on create, status route,
                                    #           restore-on-delete, skins store wired in
  test/
    geometry.test.js                  # MODIFIED: polygonArea coverage
    sessions-store.test.js             # MODIFIED: new fields, setStatus
    skins-store.test.js                 # MODIFIED: setRemainingAreaPct
    sessions-route.test.js               # MODIFIED: the cut lifecycle
```

### Data model

`create()` accepts an optional `hideId` and writes four new fields on
every record (the `hideId` it was given, plus three the store sets
itself):

| field | on create | after Cut |
|---|---|---|
| `hideId` | the given id, or `null` | unchanged |
| `status` | `"draft"` | `"cut"` |
| `cutAt` | `null` | ISO timestamp |
| `consumedAreaMm2` | `null` | the mm² subtracted |

Storing `consumedAreaMm2` on the job is what makes reversibility honest:
un-cutting restores precisely what was subtracted, rather than
recomputing a figure that could drift if the hide's outline or the job's
placements changed in between.

Existing records on disk lack all four fields. They read back as
`undefined`, and every consumer treats a missing `status` as `"draft"`
and a missing `hideId` as unlinked — the same forward-compatible contract
the hide library established when it made the scale signature optional.

### `polygonArea(polygon)` — `src/nesting/geometry.js`

Shoelace formula over the polygon's `{x, y}` points, returning absolute
area in mm² (absolute, so winding order doesn't matter). Rotation and
translation preserve area, so a die's raw polygon area is exact for every
placement of it — no need to transform before measuring.

## Components

### `src/sessions/store.js` (modified)

`create({ calibration, searchRegion, photoPath, photoExt, hideId })` —
`hideId` optional, stored as `null` when absent. Adds `status: "draft"`,
`cutAt: null`, `consumedAreaMm2: null` to every new record.

`setStatus(id, { status, cutAt, consumedAreaMm2 })` — writes the three
transition fields together and returns the updated record, or `null` for
an unknown id. One method rather than three setters, because the three
fields only ever change together and a partial write is always a bug.

`list()`, `addPlacement()`, `remove()`, `photoPath()` unchanged.

### `src/skins/store.js` (modified)

`setRemainingAreaPct(id, pct)` — clamps to `[0, 100]`, persists, returns
the updated record or `null` for an unknown id. The clamp lives here
rather than in the caller so no code path can persist a nonsensical
percentage.

### `server.js` (modified)

`createSessionsRoutes(dataDir, diesDataDir, skinsDataDir)` — gains the
third directory and builds a skin store from it.

`POST /sessions` — reads an optional `hideId` field, passes it to
`store.create()`. Every existing field and behavior unchanged.

`POST /sessions/:id/status` (new) — JSON body `{ status }`. POST rather
than PATCH to match the existing flat method+URL routing, which handles
only GET/POST/DELETE today.

- `status: "cut"` on a draft job: computes consumed area, applies the
  decrement, stamps `cutAt`, stores `consumedAreaMm2`.
- `status: "draft"` on a cut job: restores the stored `consumedAreaMm2`,
  nulls `cutAt` and `consumedAreaMm2`.
- Cutting an already-cut job, or un-cutting a draft: `400`. This is the
  one hard failure in the lifecycle, and it is what protects the
  arithmetic from double-subtracting.
- Any other `status` value: `400`.
- Unknown session id: `404`.

`DELETE /sessions/:id` — when the job being deleted is `"cut"`, restores
its `consumedAreaMm2` to the linked hide before removing the record.
Otherwise unchanged.

`GET /sessions`, `GET /sessions/:id`, `GET /sessions/:id/photo`,
`POST /sessions/:id/placements` — unchanged.

### The decrement

Consumed area for a job is the sum, over its placements, of
`polygonArea(placement.polygon) × instances`, where `instances` is 1 plus
one more when that placement carries a `match` (the blotch-matched twin —
`addPlacement` stores `reference` always and `match` when the search found
one).

The percentage subtracted is
`consumedAreaMm2 / polygonArea(hide.outlinePolygon) × 100`, applied
against the hide's current `remainingAreaPct` and clamped to `[0, 100]`.
Restoring adds the same figure back, recomputed from the stored
`consumedAreaMm2` against the same hide outline.

Every case where the arithmetic cannot be performed degrades quietly —
the status transition still succeeds, only the decrement is skipped:

- the job has no `hideId` (an unlinked job is legitimate)
- the linked hide has no `outlinePolygon` (a signature-only hide has no
  geometry to measure — a real possibility since the hide library made
  the outline optional)
- the linked hide no longer exists (deleted since the job was created)

The alternative — failing the transition — would leave an operator unable
to record work they actually did because of a bookkeeping gap, which is
the wrong trade for a single-operator tool.

### `public/jobs.html` + `src/jobs-app.js` (new)

Organic-styled, following `hides.html`'s conventions: nav, page header
with a count, card grid. Each card shows the scrap photo (`.washed`), the
linked hide's label (or "—" when unlinked), the placement count, a status
tag (`.tag-neutral` for draft, `.tag-accent` for cut), the created date,
and the cut date when present. Actions per card: **Mark as cut** /
**Un-cut** (whichever the current status allows) and **Delete**.

Hide labels come from a single `GET /skins` fetch joined client-side by
`hideId` — one request for the whole list rather than one per card.

### `public/match-blotches.html` + `src/match-blotches-app.js` (modified)

A `<select>` populated from `GET /skins`, showing each hide's label and
species, with an empty default meaning "not linked". Its value is sent as
`hideId` in the existing session-creation FormData. No other change to
the blotch-matching flow.

### `src/hides-app.js` (modified)

`hideFootprintAreaMm2()` calls `polygonArea(hide.outlinePolygon)` instead
of multiplying bounding-box dimensions. The card's displayed size stays
bounding-box-derived (it is a "how big is this piece of leather"
dimension, correctly the bounding box); only the usable-area total
changes, so it agrees with what the decrement arithmetic uses.

## Error Handling

Same bar as the rest of the project. `400` for an invalid or
non-transitioning `status` value, with a message naming the current and
requested status. `404` for an unknown session id. A malformed JSON body
returns `400` via the existing parse-failure pattern. Store methods return
`null` for unknown ids rather than throwing, matching every other store in
the project.

## Testing

- `test/geometry.test.js` — `polygonArea()` on a known rectangle and a
  right triangle; area is unchanged by `rotatePolygon()` and
  `translatePolygon()`; winding order doesn't flip the sign.
- `test/sessions-store.test.js` — `create()` defaults `status` to
  `"draft"` and the other new fields to `null`; `hideId` round-trips when
  given; `setStatus()` writes all three transition fields and returns
  `null` for an unknown id.
- `test/skins-store.test.js` — `setRemainingAreaPct()` persists, clamps
  above 100 and below 0, returns `null` for an unknown id.
- `test/sessions-route.test.js` — the lifecycle, against real records:
  cutting a job with placements decrements the linked hide by the expected
  percentage; un-cutting restores it to exactly its prior value; deleting
  a cut job restores it; double-cutting returns `400`; un-cutting a draft
  returns `400`; a job with no `hideId` cuts cleanly with no decrement; a
  job on a signature-only hide cuts cleanly with no decrement; `POST
  /sessions` still creates a session when no `hideId` is sent.
- No automated test for `jobs.html`/`jobs-app.js` — browser-only UI, the
  established precedent for every page in this project.

## Licensing / Attribution

Nothing vendored or adapted. `polygonArea()` is the shoelace formula,
standard textbook geometry, written directly rather than pulled from a
dependency — `clipper-lib` offers an area function, but it requires the
scale-and-convert round trip `toClipperPath()` performs, which is more
machinery than a five-line sum needs.

## Future Work (separate design conversations)

- The pattern-library (dies) re-skin onto Organic — split from this
  sub-project during brainstorming.
- The nest-workspace re-skin (`app.html`) plus its new nesting
  capabilities (quantity, kerf/spacing, manual drag-and-rotate, defect
  avoidance), including the hide-card click-through the hide library
  deferred.
- Attaching a scale signature to an outline-only hide, or an outline to a
  signature-only one, after creation.
- Whether `match-skins.html` and `match-blotches.html` fold into the new
  design and navigation at all — deferred during the design-system
  sub-project, still unscheduled.
