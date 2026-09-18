# Find Best Use — C2: the Page
 
**Status:** approved
**Date:** 2026-09-18
**Predecessors:**
- `2026-09-14-find-best-use-c1-design.md` (C1) — the scoring pipeline, headless.
- `2026-09-13-cutting-method-design.md` — defines `resolveClearances()` and the
  Laser/Die toggle deferred to C2.

## What C2 builds

A single-page web app that makes the C1 pipeline usable. It replaces the
hardcoded v0 demo in `public/app.html` + `src/app.js` (two literal rectangles on
a 100×60 sheet) with a real interface: pick a hide, choose a mode, set a
ranking strategy, select cutting method, run the pipeline, and see ranked
results with exact visual layouts.

The page is built on the existing Organic design system and does not introduce
a new framework or bundler. It loads C1 modules directly as ES imports and
composes them with browser DOM manipulation.

## Where C2 fits

Sub-project Find Best Use has three parts:

- **C1** — the scoring pipeline. Pure logic, headless, no UI. Five modules
  working independently.
- **C2 (this spec)** — the UI page. Composes C1; does not reimplement it.
  Introduces the Laser/Die toggle that cutting-method design deferred here.
- **C3** — full combinatorial search over mixed component types. A spike
  precedes it to determine search strategy. Adds one more mode to the
  candidate generator; does not require rebuilding C2's controls.

## Architecture

**Composition, not reimplementation.** Import C1's five pure modules:

```js
import { filterEligible } from '../bestuse/eligibility.js';
import { estimateCapacity, ESTIMATE_SCORERS } from '../bestuse/estimate.js';
import { generateCandidates, SHORTLIST_SIZE } from '../bestuse/candidates.js';
import { evaluateCandidate } from '../bestuse/evaluate.js';
import { rankCandidates, RANKING_STRATEGIES } from '../bestuse/ranking.js';
```

The page wires these into a linear flow:

```
hide + components → filter → candidates → evaluate → rank → layout
```

No logic lives in C2 that could be tested independently. All the work is C1.
C2's only job is UI: showing what's available, collecting choices, wiring
callbacks, and rendering results.

**Single-page, single module.** `public/find-best-use.html` loads
`src/find-best-use-app.js` as an ES module (no bundler, no build step). The
HTML provides semantic structure and Organic design tokens; the JS handles
state and event wiring. Follow the pattern established by `src/hides-app.js`
and `src/dies-app.js`.

**No DOM test.** Per established convention in this repo, page wiring in
`src/*-app.js` has no automated test — it is verified by viewing the page in a
browser. Do not add a test unless explicitly asked.

## Core flow

1. **Pick a hide.** A dropdown or modal listing available hides. Show hide
   outline preview and key metadata (area, species, thickness). Disable hides
   that cannot be used (those without outlines or with `remainingAreaPct < 100`).

2. **Pick mode.** Radio buttons: "You choose" (explicit) or "Rank singles".
   - **You choose:** tick checkboxes next to components, type quantities.
   - **Rank singles:** slider or text field for "top N by strategy" (defaults to
     SHORTLIST_SIZE).
   
   Switching modes resets selections.

3. **Pick strategy** (Rank singles only). Radio buttons for `value`,
   `utilization`, `demand`. Invisible in You Choose mode. Switching strategies
   re-runs and re-ranks without re-nesting.

4. **Set cutting method.** Radio buttons: "Laser" or "Die". Affects clearances.
   - **Laser:** all parts use job-level laser clearance (default 1.0 mm).
   - **Die:** each part uses its component's `dieClearanceMm`; components with
     `null` are excluded and reported separately.

   Switching methods re-runs without changing selections.

5. **Precision.** Three-way selector: Fast (10 mm), Balanced (5 mm), Maximum
   (1 mm). Trades speed for layout precision in `nest()`. Default Balanced.
   Switching re-runs.

6. **Run button.** Disabled until hide + mode selections are valid (at least
   one component in You Choose mode; hide in Rank Singles). Shows running state
   and latency.

7. **Results.** Ranked list of candidates with:
   - **Hide area and placed area,** with utilization %.
   - **Component breakdown:** each component's count, value, and status
     (placed, no-fit, no-die, unpriced, unverified).
   - **Visual layout:** render the placement polygon for each component. No
     coordinate picker or edit — the layout is read-only. SVG or canvas, sized
     to fit the hide outline. Same visual that would export to LightBurn.
   - **Confirm button.** Blocked if any component has `unverified` constraints.
     On click, shows which field is missing and what to measure. Guides operator
     through re-measurement without losing context.
   - **Unverified warning.** "This layout depends on unmeasured hide thickness.
     Measure the hide and re-run to confirm."
   - **Unpriced components.** "Component X is unpriced. Value is estimated." or
     similar — never shows $0.

## UI problems C2 owns

### Precision control

Grid step is a yield-versus-wait trade; all layouts are exact. The nester works
at a caller-specified `GRID_STEP_MM`:

- **Fast** (10 mm): ~180 pieces/s. Coarse, acceptable for quick scouting.
- **Balanced** (5 mm): ~234 pieces/s. Real-world default; 5 mm is the codebase
  default. Three-order-of-magnitude better balance than 1 mm.
- **Maximum** (1 mm): ~277 pieces/s. True maximum; only when the last mm
  matters.

Surface this as three buttons, not a slider. Default Balanced. The page
communicates speed expectations: "Maximum precision takes longer; Balanced is
recommended."

### Clearance doubling trap

`dieClearanceMm` is per-component. Clearances are NOT shared, so two identical
dies end up `2 × clearance` apart. Operators think in *gap between cuts*, not
per-die margins.

The die-library edit dialog already labels the field to defuse this ("Board
overhang" or similar — check `public/dies.html`). C2 reinforces it in the UI
where die clearance is exposed (if at all during layout display): "Clearance
shown is per die. Gaps between identical dies are doubled." Or simply do not
expose clearances in the layout view — they are implementation details of the
cut path, not the design.

Measured cost of mislabeling: $110 on one real skin where "5 mm" became "10 mm"
spacing and tooling ended up at $297 instead of usable.

## Decisions

### The hide outline is visual only; never accept a digitize flow here

C2 is not a digitize interface. `public/digitize.html` and `public/hides.html`
handle photography and outline capture. C2 receives only complete hides.

If a hide lacks an outline, it is marked "needs outline" in the dropdown and
cannot be selected. The user's next step is `public/hides.html`, not
re-entering the flow in C2.

### You Choose mode is not a "custom" or "manual" layout tool

"You choose" is a search mode where the operator pre-selects components and
quantities, the nester places them exactly, and the results are ranked by the
operator's chosen strategy. It is not a freeform layout editor.

The operator cannot drag parts, lock placements, or edit component quantities
on the fly. Changes to mode or selections require re-running. This keeps the
flow simple and the layout provably correct.

### Rankings are never recomputed without re-nesting

Switching strategies re-sorts the same candidates; it does not re-nest. This
keeps strategy selection interactive (instant) while requiring a full re-run
for mode or hide changes.

### Demand-satisfied candidates are ranked separately?

No. The `demand` strategy is orthogonal: it ranks by orders filled first, then
by value. A candidate with high demand satisfaction but low value still appears,
ranked accordingly. The tool surfaces the trade-off; the operator decides.

### A partially-cut hide shows why it was excluded

The dropdown or modal shows: "Remaining: 60% of original area. Re-photograph as
a new hide to search." The reason comes directly from `filterEligible`'s
`hideRejection`.

## Component library and die management

C2 assumes the component and die libraries already exist and are complete. This
design does not add a way to create or edit components from within the search
flow. Component creation and die clearance entry happen in
`public/dies.html` / `src/dies-app.js`.

C2 reads components and uses `dieClearanceMm` to decide which ones can be cut
under the selected method. It does not modify the library.

## Non-goals

- Editing components, hides, or dies from this page. That happens in
  `public/dies.html`, `public/hides.html`.
- Exporting cut paths to LightBurn or SVG. That is a separate step (likely a
  "Confirm and Export" page, future).
- Visual hide-outline editor. Digitization happens in `public/hides.html`.
- The ability to save searches or layouts. Each run is independent; persistence
  would require a sessions or jobs store, which is separate work.
- Kerf compensation, reverse search, scrap analytics. All parked by C1.
- Changing the placement heuristic. C2 does not tune `GRID_STEP_MM`, `place()`'s
  grid scan, or rotation order.
- Any new dependency beyond what C1 uses (none).
- C3. That is a later sub-project with its own spike.

## Data flow

**Input:**
- Hide: `{ id, species, thicknessMm, outlinePolygon, remainingAreaPct }`
- Components: `[{ id, name, polygon, valuePerPiece, demand, allowedSpecies,
  thicknessMinMm, thicknessMaxMm, allowedRotations, dieClearanceMm }]`

**Options (user choices):**
- `hideId` (string)
- `mode` ('explicit' | 'singles')
- `quantities` (object, You Choose mode) or `strategy` (string, Rank Singles mode)
- `method` ('laser' | 'die')
- `laserClearanceMm` (number, Laser method only)
- `gridStepMm` (number, default 5)

**Output (per candidate):**
- All fields from `evaluateCandidate`, plus a rendering of `placements`.

## Testing

Per repo convention, page wiring in `src/find-best-use-app.js` has no
automated test. Verification is manual:

- Hides populate correctly; partially-cut hides show reason.
- Mode switching resets selections and re-runs.
- Strategy switching re-sorts the same candidates (no re-nest).
- Method switching updates clearances and re-runs.
- Precision selector updates grid step and re-nests.
- Unverified constraints block confirm and prompt for the missing field.
- Unpriced components display correctly ("unpriced", not "$0").
- `noFit` and `noDie` are displayed separately with different guidance.
- Visual layouts render correctly scaled and centered on the hide outline.

## Success criteria

- A user can select a hide, choose a mode and strategy, set cutting method,
  and see a ranked list of candidates with visual layouts.
- The top result by one strategy differs from the top by another (the point of
  the whole brief).
- Unverified constraints visibly block confirm until re-measured.
- No default ranking strategy is reachable by omission.
- Every shortlist decision is visible (which components were shortlisted, why,
  in which order).
