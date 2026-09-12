# Irregular Containment & Spacing: Design Spec

**Date:** 2026-09-12
**Status:** Approved for implementation planning

## Context

Second sub-project of the scrap-to-product intelligence system, after the
component library. That system's premise is to start from an irregular
scrap and ask what the highest-value components are that can be cut from
it — which requires knowing, honestly, what actually fits.

Today it doesn't. `src/nesting/place.js:20-22` says so outright:

> v0 assumes a rectangular sheet, so containment is a simple AABB check
> against sheetBounds rather than a general inner-fit-polygon.

That was correct for v0, whose sheet was a rectangle. It is wrong for a
hide. A hide's bounding box is substantially larger than the hide, so
every utilization percentage and dollar figure computed against it would
be fiction. This sub-project makes containment real, and is a correctness
prerequisite for "Find Best Use" (sub-project C).

A spike was run before this design to settle the algorithm, because the
obvious approach turned out not to work — see Approach Evidence below.

## Goals

- Parts are placed only where they genuinely lie inside the sheet outline,
  not merely inside its bounding box.
- Support a configurable clearance around each part's cut line, set
  per-part with a job-level default, so a job can respect laser kerf plus
  handling gap, or the differing physical footprints of individual clicker
  dies.
- Preserve today's behavior exactly for the existing rectangular-sheet
  consumer (`public/app.html`), including flush placement against every
  edge.

## Non-goals

- Modeling cutting method (laser vs. clicker die). Deliberately sequenced
  as its own sub-project immediately after this one: it touches a
  component field ("do I own a die for this piece?"), a job field, routes,
  and UI, and folding a cross-store data-model change into this
  correctness-critical geometry would mean reviewing the two together.
  `place()` takes a clearance number either way; the method model becomes
  what *computes* that number.
- Kerf compensation on the exported cut path. A laser job wants its path
  offset outward by half the kerf so parts come out at true size; a die
  job must not be offset at all. That is `exportToSVG`'s concern, not the
  nester's, and is untouched here.
- Matching, ranking, value scoring, utilization reporting, and the results
  UI — all sub-project C.
- Defect/scar regions to nest around. Still the Nest workspace
  sub-project's.
- Improving packing *quality*. The placement heuristic stays exactly what
  it is (bottom-left-fill, first valid position wins). This sub-project
  changes which positions are *valid*, not how they are searched.
- Any new dependency. `clipper-lib` is already present and already used.

## Approach Evidence (from the spike)

Four candidates were measured against a synthetic 655 × 417 mm hide with
two concavities, placing a 35 × 12 mm keeper, sweeping 60–250 vertices and
1–2 mm grid steps. Clipper's exact difference was ground truth.

| Approach | Correctness | Full-grid cost |
|---|---|---|
| **Vertex-and-edge test** (chosen) | **100%** at every setting | 2.0–4.4 s @1 mm |
| Vertices-only | 99.7–99.9%, all errors false-*accept* | 0.3–1.0 s |
| Clipper difference per position | 100% (baseline) | 22.6 s |
| Inner-fit polygon via Minkowski | **74.5%**, 513 false accepts | 1.3 s |

Three findings drove this design:

**The inner-fit polygon approach does not work here.** It was the expected
winner — precompute the valid-reference-point region once per rotation,
reducing the scan to one cheap point test, mirroring how the code already
handles part-vs-part overlap. It produced 513 false accepts out of 2,014
sampled positions, because `clipper-lib`'s Minkowski sum is not reliable
on the non-convex region the construction requires. This is consistent
with `src/nesting/nfp.js`'s own note that its NFP is "exact for convex
polygons." Recorded here so it is not re-attempted.

**Vertices-only is fast but wrong in the dangerous direction.** Every one
of its errors was a false *accept*: a part spanning a concavity with all
of its corners on leather. For a tool whose output is "cut here," that
means cutting material that is not there.

**The chosen test is both exact and ~7× faster than clipper's.** Cost is
bounded further by the fact that the scan already breaks on first fit, so
a full-grid traversal is the worst case, paid only when a part does not
fit anywhere.

## Architecture

Two pure functions in `src/nesting/geometry.js`, consumed by a
`src/nesting/place.js` that keeps its existing structure. The file already
precomputes per-rotation data once and then does cheap per-position tests
inside the scan; containment and spacing slot into that same rhythm rather
than changing it.

```
leather-nest/
  src/
    nesting/
      geometry.js          # MODIFIED: polygonContains(), inflatePolygon()
      place.js              # MODIFIED: real containment, spacing option
      index.js               # MODIFIED: pass options through
  test/
    geometry.test.js            # MODIFIED: containment + inflation coverage
    nesting.test.js              # MODIFIED: irregular sheets, spacing, regressions
```

### `polygonContains(outer, inner)` — new

True when every vertex of `inner` lies inside `outer` **and** no edge of
`inner` crosses any edge of `outer`. Both conditions are required: the
vertex test alone admits a part spanning a concavity, and the edge test
alone admits a part entirely outside a hole.

**Containment is boundary-inclusive.** A point lying exactly on the
outline counts as inside, via an explicit on-segment check performed
*before* the ray cast. This is not a nicety — it is load-bearing, and
verifying it changed the design:

A naive ray-cast is not merely ambiguous on the boundary, it is
*asymmetric*. Measured against a rectangle at integer coordinates, a point
flush on the left edge reads inside while a point flush on the right edge
reads outside, because ray casting uses a half-open convention. Since
`place.js` computes `maxX = sheetBounds.maxX - width` specifically so a
part *can* sit flush against the right edge, a naive implementation would
have silently rejected every flush-right placement in the existing nest
workspace — a regression with no error message anywhere.

Boundary-inclusive is also the convention the file already follows:
`place.js:57-59` documents that a point on an NFP boundary is treated as
touching-and-allowed because it "enables flush nesting." Edge-crossing
uses strict inequalities, so collinear or touching edges correctly do not
count as crossings.

### `inflatePolygon(polygon, mm)` — new

Grows a polygon outward by `mm` using `ClipperOffset` with miter joins,
returning the grown polygon. Verified against the motivating case: a
35 × 12 mm keeper inflated by 0.6 mm yields 36.2 × 13.2 mm and remains
four vertices. `mm` of `0` returns the polygon unchanged.

### `place(sheetPolygon, parts, options)` — modified

Signature gains a third parameter, `{ clearanceMm = 0 }`, the job-level
default. An individual part may override it with its own
`part.clearanceMm`. `nest()` passes the options through. The default of `0`
preserves today's behavior exactly.

Per part and rotation, before the grid scan:

1. Rotate and normalize as today.
2. Inflate by this part's effective clearance
   (`part.clearanceMm ?? options.clearanceMm ?? 0`) once → the **test
   shape**.
3. Compute forbidden regions from already-placed **test shapes**, as today.

Then within the scan, for each candidate position:

4. The existing axis-aligned bounds check runs first, unchanged — it is
   effectively free and rejects far-outside positions before any real
   work.
5. Survivors are tested with `polygonContains(sheetPolygon, placedTestShape)`.
6. The existing NFP overlap test runs against the test shapes.

**Placements always report the true polygon, never the inflated one.** The
inflated shape exists solely for fit testing; the geometry handed onward —
and ultimately to LightBurn — is the shape that was actually drawn.

### Clearance semantics

`clearanceMm` is the clearance each part requires **around its own cut
line**, and each part is inflated by its full value — not half.

That choice is not arithmetic convenience; it encodes how the two
processes actually behave. Clearances are **not shared** between
neighbours: a part needing 8 mm beside a part needing 2 mm must have
10 mm between them, because each piece's requirement is measured from its
own cut line. Inflating each part by its full clearance produces exactly
that, since the two inflated shapes cannot overlap until the true gap
reaches the sum. Halving would have had them meet in the middle at 5 mm,
which is wrong for a physical die: a clicker die's board needs its room
regardless of what sits beside it.

Clearance is therefore **per-part**, with a job-level default for parts
that don't specify one. This matters because die sets differ — a small
keeper die and a large vamp die carry very different board footprints
around the blade — so a single global number cannot describe a job mixing
them. A laser job, by contrast, is naturally uniform: kerf plus handling
gap applies to every part equally, and the job-level default covers it
without touching any part.

One number per part rather than separate kerf and clearance inputs,
because the geometry only ever needs their sum and splitting it at this
layer would invite guessing at the split. A richer presentation — a
Laser/Die toggle prefilling editable defaults, with die clearance read
from each component's own die footprint — belongs in UI and in the
cutting-method sub-project, not here.

Against the sheet outline the same rule applies: a part sits at least its
own clearance inside the edge. That is conservative for a laser, where
only half the kerf strictly must stay on the leather, but it keeps one
rule with no special cases, and it costs a few millimetres at the
boundary rather than risking a cut that runs off the hide.

## Error Handling

These are pure functions over geometry, with no I/O and no user input at
this layer, so the error surface is small. A degenerate polygon (fewer
than three vertices) makes containment meaningless; `polygonContains`
returns `false` rather than throwing, so a malformed part is reported in
`noFit` like any other part that cannot be placed — consistent with the
existing "an oversized part produces noFit instead of throwing" behavior.
A negative or non-finite `clearanceMm`, at either the part or the job
level, is treated as `0`.

## Testing

`node --test`, real geometry, no mocks — matching the existing
`test/nesting.test.js`, which already verifies placements by computing
real intersection areas through clipper.

- `test/geometry.test.js`
  - **The concavity case**: a part whose every vertex lies inside a
    C-shaped sheet but which spans the notch returns `false`. This is the
    case both the current AABB check and the rejected vertices-only
    approach get wrong, and is the single test that justifies this
    sub-project.
  - **The flush case**: a part placed flush against each of the four edges
    of a rectangular sheet is contained — all four, guarding the
    left/right asymmetry described above.
  - A part partly outside returns `false`; a part comfortably inside
    returns `true`.
  - `inflatePolygon`: 35 × 12 by 0.6 → 36.2 × 13.2; by `0` → unchanged.
- `test/nesting.test.js`
  - A part that fits the sheet's bounding box but not its real outline is
    reported in `noFit` — the regression this sub-project exists to fix.
  - Every existing rectangular-sheet test passes unchanged, including the
    two-rectangles-nest case and the oversized-part case.
  - With a job-level `clearanceMm: 2`, the **true** polygons of two placed
    parts are at least 2 mm apart, and the reported placement polygons are
    the true ones, not the inflated ones.
  - **Clearances are not shared**: a part declaring `clearanceMm: 8` placed
    beside one declaring `clearanceMm: 2` leaves at least 10 mm between
    their true polygons — not 5 mm. This is the test that pins the
    full-inflation choice; a half-inflation implementation passes the
    uniform case above and fails only here.
  - A part's own `clearanceMm` overrides the job-level default, and a part
    without one inherits it.
  - With clearance set, a part is held off the sheet edge rather than flush.
  - A part with no `allowedRotations` still places (the legacy-record
    guard added previously stays covered).

## Licensing / Attribution

Nothing vendored or adapted. `polygonContains` is the standard
point-in-polygon plus segment-intersection test, written directly.
`inflatePolygon` wraps `ClipperOffset` from the existing `clipper-lib`
dependency. The spike code that produced the evidence above was
throwaway and is not part of the codebase.

## Future Work (separate design conversations)

- **Cutting method** as a modeled concept — a component field for whether
  a physical die exists, a job field for what the run is cut on, and the
  derivation of `clearanceMm` from it. Sequenced next, before sub-project
  C. Expected shape: a Laser/Die toggle prefilling editable defaults,
  where "Laser" supplies one job-level clearance (kerf plus handling gap,
  uniform across parts) and "Die" reads each component's own die
  footprint, since die sets differ from one another.
  The component side is more interesting than clearance alone: a die-cut
  job can only contain components you own dies for, which feeds the
  brief's reverse-search idea.
- Kerf compensation on export, where laser and die genuinely diverge.
- **Sub-project C — Find Best Use**: eligibility filtering by species and
  thickness, candidate layout generation, ranking strategies, and the
  results UI. Its ranking must stay a pluggable function over candidate
  layouts so "highest utilization wins" is never hard-coded.
- Packing quality. Bottom-left-fill with a 1 mm grid is deliberately
  unchanged here; if C's results show it leaving obvious room, that is its
  own optimization conversation. `GRID_STEP_MM` is already a constant and
  the spike measured a ~4× cost reduction at 2 mm.
- Nesting around defects or holes in a hide.
