# Find Best Use — C1: the scoring pipeline

**Status:** approved
**Date:** 2026-09-14
**Predecessors:**
- `2026-09-12-irregular-containment-design.md` (B) — `place()` honours a
  per-part `clearanceMm` and containment is exact against the true outline.
- `2026-09-13-cutting-method-design.md` — `resolveClearances(parts, options)`
  maps cutting method to those numbers.

## Where C1 sits

"Find Best Use" was decomposed into three sub-projects:

- **C1 (this spec)** — the scoring pipeline. Pure logic, headless, no UI.
- **C2** — the Find Best Use page: pick a hide, choose a mode, see ranked
  results with a visual layout. Replaces the hardcoded v0 demo in
  `src/app.js` and is where the Laser/Die toggle finally gets real
  components to act on.
- **C3** — full combinatorial search over mixed component types, added as one
  more generator. A spike precedes it: the open question is what search
  strategy gives good answers inside a few seconds per hide.

The three user-facing modes are not three features. They are one pipeline
with different candidate *generators*:

| Mode | Generator produces |
|---|---|
| You choose | one candidate — the set you ticked |
| Rank singles | one candidate per component, that type repeated |
| Full search (C3) | many candidates, mixed types |

That is why C3 slots in rather than requiring a rewrite.

## Problem

Given a scrap hide, work out what is worth making from it. The governing
constraint from the original brief: **maximum material utilization is not
maximum value.** A layout filling 89% of a hide with cheap keepers can be
worth less than one filling 68% with belt straps. The architecture must never
encode "highest utilization wins" as a default.

## The pipeline

Five pure stages, each independently testable:

```js
filterEligible(hide, components)                  // -> { eligible, excluded }
estimateCapacity(hide, component)                 // -> { pieces, estimatedValue }
generateCandidates(mode, eligible, options)       // -> [candidate, ...]
evaluateCandidate(hide, candidate, options)       // -> scored result
rankCandidates(results, strategy)                 // -> sorted results
```

Each stage is a separate module under `src/bestuse/`, so a stage can be
understood and changed without reading the others.

`estimateCapacity` is what keeps the work bounded — see "Two-stage
evaluation" below. In `singles` mode `generateCandidates` calls it to size
and shortlist candidates; in `explicit` mode it is not used at all, because
the operator has already named the quantities.

**Where `unverified` lives.** It is a property of a (hide, component) pair,
not of the hide alone, so `filterEligible` returns it per eligible entry:
`eligible: [{ component, unverified: ['thicknessMm'] }, ...]`. A candidate's
`unverified` is the union across the components it contains. Flattening it to
a single hide-level flag was rejected — the operator needs to know *which*
component is the one making an unchecked assumption.

## Decisions

### Eligibility never blocks on missing data, but records what it could not check

A component requiring 1.5-2.0 mm is eligible against a hide whose
`thicknessMm` is `null`. The result carries `unverified: ['thicknessMm']` as
**structured data**, not a warning string.

This is deliberate: the search stays useful on half-recorded inventory — the
common case, since a scrap gets photographed long before anyone measures it —
while the gate moves to the point of commitment. C2 uses `unverified` to
block its confirm action and prompt for exactly the missing field, then
re-runs. Making it structured rather than advisory means a later UI cannot
drop it by forgetting to render a message.

Matching rules:

- `allowedSpecies: null` means any species. Otherwise `hide.species` must
  appear in the list (both already lower-cased and trimmed on write).
- `thicknessMinMm` / `thicknessMaxMm` of `null` mean unconstrained on that
  side. A component is thickness-eligible when `hide.thicknessMm` falls
  within whatever bounds are set.
- `hide.thicknessMm === null` and the component constrains thickness ->
  eligible, plus `'thicknessMm'` in `unverified`.

### A partially-cut hide is excluded, with its reason

Only hides at `remainingAreaPct === 100` are searched. A hide below that is
returned in `excluded` with reason `'partially-cut'`.

`remainingAreaPct` records how much material is left, but `outlinePolygon`
is still the **original uncut shape** — nothing records where the cuts went.
Nesting on that outline would place parts over leather that no longer exists.
Scaling the score by the remaining percentage was rejected because the
*layout* would still be fiction, and a layout that looks like a cut plan is
the most dangerous thing this app could show. The real-world fix is to
re-photograph the offcut as a new hide, which is what the operator would
physically do anyway.

### Every piece cut counts toward value; demand is a separate ranking

A hide fitting 6 straps at $60 is worth $360 under the value strategy, even
with orders for only 2. Leather cut is leather banked.

Blending a demand discount into value was rejected: it needs an invented
discount rate, and it collapses two different questions ("what is this scrap
worth?" and "what can I sell this week?") into one number that answers
neither. Counting only sellable pieces was also rejected — it makes a scrap
fitting 20 straps score identically to one fitting 2, hiding exactly the
differences this tool exists to surface.

Instead the strategies stay orthogonal and the operator chooses the question.

### Ranking is pluggable, with no default

`RANKING_STRATEGIES` is a map of pure comparator functions:

| Strategy | Score |
|---|---|
| `value` | `sum(component.valuePerPiece * placedCount)` |
| `utilization` | `placedArea / hideOutlineArea` |
| `demand` | `sum(min(placedCount, component.demand))`, tie-broken by value |

`rankCandidates(results, strategy)` **throws on an unknown strategy** and has
no fallback comparison. There is deliberately no default argument: a caller
must name the question it is asking. This is the structural expression of the
brief's constraint — "highest utilization wins" cannot become the answer by
omission, because omission is an error.

`valuePerPiece: null` contributes 0 to the value score. A component with no
price is not free to make; it is unpriced. The result marks it `unpriced` so
C2 can say so rather than showing a confidently wrong dollar figure.

### Two-stage evaluation: estimate to shortlist, nest to report

Packing every eligible component to true capacity takes minutes. Measured on
a synthetic 120-vertex, 169,000 mm^2 hide:

| Part | Asked | Placed | Time |
|---|---|---|---|
| keeper 35x12 | 20 | 20 | 770 ms |
| keeper 35x12 | 60 | 60 | 6,309 ms |
| pocket 90x70 | 60 | 16 | 12,872 ms |

Cost grows quadratically — tripling the keepers costs 8x the time, and 60 of
them still reach only 15% utilization, so true capacity is hundreds of pieces.

So: `estimateCapacity(hide, component)` scores every eligible component
instantly from area, the top `shortlistSize` go to the real nester, and
**only exact nested results are ever returned as layouts**. An estimate is
never presented as a layout, and the result shape keeps them in separate
fields so a UI cannot confuse them.

Concrete values, all overridable via `options`:

| Constant | Value | Why |
|---|---|---|
| `PACKING_EFFICIENCY` | `0.75` | `pieces = floor(hideArea * 0.75 / partArea)`. The measured rows above ran 60-70% on an irregular outline; 0.75 keeps the estimate an optimistic *upper* bound, which is what a shortlist wants — it must not drop a component the nester would have liked. |
| `SHORTLIST_SIZE` | `5` | At roughly 1-6 s per exact nest, five keeps a run in the seconds range. |

The efficiency factor is deliberately generous rather than accurate. A
shortlist's only job is to avoid discarding a winner; over-estimating costs
one wasted exact nest, while under-estimating silently loses the best answer.
The estimate is never shown as a result, so its inaccuracy has no other
consequence.

`estimateCapacity` returns `{ pieces, estimatedValue }` and is the ONLY place
a non-nested number is produced. It never returns placements.

A hard per-candidate piece cap was rejected: it systematically under-counts
small components, so a keeper that could fill the hide would score the same
as one fitting 40 times — hiding the high-value-small-part case. A wall-clock
budget was rejected because results would vary run to run with machine speed.

### The monotone skip, in `place.js`

The pocket row above is mostly waste: 44 parts that could not fit each burned
a full grid scan before being reported `noFit`.

For *identical* parts this is avoidable and provably safe. `placed` only ever
grows during a `place()` call, so the free region only ever shrinks. If the
17th pocket cannot fit, neither can the 18th. So: once a part carrying
`componentId: X` fails, skip every later part with the same `componentId`
and report them `noFit` directly.

`componentId` is optional. Parts without it behave exactly as today, so every
existing nesting test is unaffected. This is the only change C1 makes to
code outside `src/bestuse/`, and it is called out because `place.js` has
just been through a Critical-bug fix cycle.

## Data model

**No new stored fields, no new stores, no migrations.** C1 reads existing
hide and component records and returns computed results. Everything it needs
already exists: `hide.species`, `hide.thicknessMm`, `hide.outlinePolygon`,
`hide.remainingAreaPct`; `component.polygon`, `valuePerPiece`,
`allowedSpecies`, `thicknessMinMm`, `thicknessMaxMm`, `allowedRotations`,
`demand`, `dieClearanceMm`.

This also keeps the door open for the brief's two deferred capabilities:
because eligibility is a pure function of (hide, component), the same
predicate runs in reverse for "which scraps could make this component"
without restructuring anything.

## Result shape

```js
{
  candidateId,          // stable id for the candidate
  mode,                 // 'explicit' | 'singles'
  placements,           // exact, from nest() — never from an estimate
  counts,               // { componentId: placedCount }
  value,                // number; unpriced components contribute 0
  utilization,          // placedArea / hideOutlineArea, 0..1
  demandSatisfied,      // sum(min(placedCount, demand))
  noFit,                // component ids that did not fit
  noDie,                // component ids excluded for having no die
  unverified,           // e.g. ['thicknessMm']
  unpriced,             // component ids with valuePerPiece === null
}
```

`noFit` and `noDie` stay separate, as the cutting-method spec established:
"buy a die" and "find a bigger offcut" are different fixes, and merging them
sends the operator hunting for leather when the blocker is tooling.

## Testing

`node:test` + `assert` only, per repo convention.

- `filterEligible` — species match, null-species-means-any, thickness in and
  out of range, null hide thickness producing `unverified`, a partially-cut
  hide excluded with its reason.
- `estimateCapacity` — monotone in part area; an oversized part estimates 0.
- `generateCandidates` — `explicit` honours quantities; `singles` produces one
  candidate per eligible component and none for ineligible ones.
- `evaluateCandidate` — value sums correctly, unpriced contributes 0 and is
  reported, utilization is placed area over hide area, `noFit` and `noDie`
  stay distinct.
- `rankCandidates` — each strategy orders correctly; an unknown strategy
  throws; **and a case where `value` and `utilization` pick different
  winners**, which is the property the brief actually asks for and the one
  test that would catch a hardcoded comparison.
- `place.js` — the monotone skip returns the same placements as today for
  parts without `componentId`, and reports later same-id parts as `noFit`
  without scanning.

## Non-goals

- Any UI. That is C2.
- Mixed-component search. That is C3, behind a spike.
- Rebuilding `src/app.js`. C2.
- Kerf compensation on export; defect/scar regions; reverse search;
  scrap-geometry analytics. All still parked.
- Changing the placement heuristic. Bottom-left-fill, first valid position
  wins, `GRID_STEP_MM = 1`. C1 changes which components are *asked* for, not
  how positions are searched.
- Any new dependency.
