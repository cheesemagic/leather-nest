# Cutting Method Design

**Status:** approved
**Date:** 2026-09-13
**Predecessor:** `2026-09-12-irregular-containment-design.md` (sub-project B),
which deferred this deliberately and left `place()` taking a per-part
`clearanceMm` either way. This sub-project is what *computes* that number.

## Problem

A pattern piece needs different spacing depending on how it is cut. A laser
needs enough room that the kerf and its heat-affected zone do not encroach on
a neighbour. A clicker die needs enough room for the physical board the blade
is mounted in — and that board differs from die set to die set, so it is a
property of the die, not a property of the job.

Sub-project B built the mechanism: `place()` accepts `part.clearanceMm`,
falling back to `options.clearanceMm`, and inflates each part by its *full*
clearance (clearances are not shared, so 8 mm beside 2 mm leaves 10 mm).
Nothing yet decides what those numbers should be.

## Scope

This sub-project ships the data and the decision logic. It does **not** ship
the Laser/Die toggle UI.

That is not an oversight. The nesting engine's only consumer is
`src/app.js:26`, and `src/app.js` is the original v0 demo: its sheet is a
literal 100 × 60 rectangle and its parts are two literal rectangles built
from inline SVG strings (`src/app.js:6-24`). It never loads components from
the dies store. A toggle placed there would have nothing real to act on — in
Die mode both hardcoded rectangles would be excluded for having no die, and
the page would render an empty sheet. Building that control now would mean
building a control with nothing behind it.

The toggle belongs with sub-project C, which is what first puts real
components onto a real hide. C inherits the field and the function ready-made.

## Decisions

### A die's spacing is a uniform margin, not a footprint polygon

A component stores one number: how much clear space that die needs around its
own cut line. The nester inflates the component's own outline by that amount.

The alternative — storing the die board as a separate polygon, possibly
rectangular and off-centre relative to the cut shape — was considered and
rejected. It would require `place()` to fit-test a shape other than the
inflated part, which is new geometry on top of correctness-critical code that
was just stabilised. The uniform margin needs no geometry work at all: it is
exactly what B already built.

### "Do I own a die?" is expressed by `null`, not a boolean

`dieClearanceMm: null` means no die exists for this component. A number means
a die exists and needs that much room.

A separate `hasDie` boolean was rejected because it admits states that
contradict themselves — `hasDie: true, dieClearanceMm: null` — and every
consumer would then need a rule for what that means. One nullable number
cannot disagree with itself.

### A component with no die is excluded from a die job, and reported separately

When the method is `die`, a component whose `dieClearanceMm` is `null` is
removed before nesting and returned in its own list.

This is the honest answer: without the die you physically cannot cut the
piece, so a layout that includes it would be a layout you cannot execute.

It is reported **separately from `noFit`** rather than merged into it. "I have
no die for this" and "this did not fit on this hide" are different problems
with different fixes — buy or make a die, versus choose a bigger offcut.
Collapsing them would tell the operator to go looking for more leather when
the actual blocker is tooling.

Falling back to the job's default clearance was rejected: it produces a
layout implying you can cut something you may have no die for, which is the
wrong direction to be optimistic about material that cannot be un-cut.

Mixed jobs — dieing what you have dies for and lasering the rest — were
rejected for now. They are plausible for a real shop, but they make cutting
method stop being one job-level fact, which complicates the eventual export
path (a laser path wants kerf compensation; a die path must not be offset at
all). Revisit when there is a reason to.

### Laser mode ignores dies entirely

Under `laser`, every part gets the job's laser clearance, including components
that do have dies. The method is the authority; a die's margin is irrelevant
when the die is not being used.

### Defaults

| Method | Default clearance | Where the default applies |
|---|---|---|
| Laser | 1.0 mm | `resolveClearances`' `laserClearanceMm` fallback |
| Die | 8.0 mm | UI prefill only, when recording a die for a component |

Laser 1.0 mm covers roughly 0.3 mm of kerf on a 100 W CO₂ through leather
plus margin against scorching a neighbour. Die 8.0 mm is a typical clicker
board overhang beyond the blade. Both are starting points, editable per job
and per component; neither is enforced.

The two defaults apply at different layers, and conflating them would be a
bug. `DEFAULT_LASER_CLEARANCE_MM` is a *runtime* fallback: a laser job that
names no clearance gets 1.0 mm. `DEFAULT_DIE_CLEARANCE_MM` is a *UI prefill*
only — it is what the Die clearance box suggests when the operator starts
recording a die. It is never a record default: `create()` stores `null`,
because a component that has never had a die recorded does not have an 8 mm
die, it has no die. Storing 8.0 at creation would silently claim tooling the
shop does not own.

Because clearances are not shared (B's decision), two 8 mm components end up
16 mm apart, and two 1.0 mm laser parts end up 2.0 mm apart.

## Data model

### Component (`src/dies/store.js`)

One new field:

```js
dieClearanceMm: null   // null = no die owned; a number = mm of clear space
```

`create()` defaults it to `null`. It joins the existing `METADATA_FIELDS`
whitelist so it is editable after creation, like the other seven metadata
fields. A component's polygon remains immutable — that rule is unchanged.

### Job (`src/sessions/store.js`)

**No change.** Jobs do not use the nesting engine — they run
`scripts/blotch_match.py`, a separate visual-texture pipeline (see CLAUDE.md).
A `cuttingMethod` field on the Job record today would be a field nothing
reads. It is added when something reads it.

## The resolution function

New module `src/nesting/clearance.js`. It belongs with nesting because its
output is nesting input.

```js
export const DEFAULT_LASER_CLEARANCE_MM = 1.0;
export const DEFAULT_DIE_CLEARANCE_MM = 8.0;

// Returns { parts, noDie }.
//   parts — the parts that can be cut by this method, each with clearanceMm
//           set. Ready to hand to nest().
//   noDie — ids of components excluded because the method is 'die' and they
//           have no die. Always [] for 'laser'.
export function resolveClearances(parts, options);
```

`options` is `{ method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM }`.

Behaviour:

- **`method: 'laser'`** — every part gets `clearanceMm = laserClearanceMm`.
  `dieClearanceMm` is ignored. `noDie` is `[]`.
- **`method: 'die'`** — a part with a numeric `dieClearanceMm` gets
  `clearanceMm = part.dieClearanceMm`. A part whose `dieClearanceMm` is
  `null` or absent is omitted from `parts` and its id pushed to `noDie`.
- **An unrecognised method throws.** Defaulting a typo to laser could produce
  a layout cut the wrong way, on material that cannot be un-cut. Failing
  loudly is cheaper than that.
- The function does not mutate its input. It returns new part objects with
  `clearanceMm` set.
- `clearanceMm` is always set by this function, overwriting any value already
  on the part. The method is the authority.

### The zero trap

`dieClearanceMm: 0` is legitimate — a die needing no extra margin beyond its
cut line. The null check must therefore be `== null` / `??`, never falsy.
This is the same trap B hit with `part.clearanceMm ?? options.clearanceMm`,
where `||` would have silently discarded a deliberate `0`. There is a test
for it.

## Validation

`validateDieUpdate` in `server.js` gains `dieClearanceMm` alongside the
existing numeric fields: it must be a finite number or `null`, and must not
be negative (mirroring `valuePerPiece`).

The existing create-path coercers must **not** be reused for this —
`numberOrNull(null)` returns `0` because `Number(null) === 0`, which would
silently turn "no die" into "a die needing zero clearance". This trap is
recorded in the Component Library spec and applies unchanged here.

## UI

The Components page (`public/dies.html` / `src/dies-app.js`) edit dialog
gains a Die clearance field, alongside the seven existing metadata fields.
An empty field means `null` — no die. The field is labelled so that empty
reads as "no die for this component" rather than as zero.

No other UI changes. Per established repo convention, `src/*-app.js` page
wiring gets no automated test.

## Testing

- `test/dies-store.test.js` — `dieClearanceMm` defaults to `null` on create;
  `update()` writes it; `0` survives a round trip and is not coerced to
  `null`.
- `test/dies-route.test.js` — `POST /dies/:id` accepts a number and `null`;
  rejects a string, a negative number, and a non-finite number with 400.
- `test/clearance.test.js` (new) — laser assigns uniformly and ignores dies;
  die assigns per-component; a `null` die lands in `noDie` and is absent from
  `parts`; `dieClearanceMm: 0` is honoured rather than treated as missing;
  an unrecognised method throws; the input array is not mutated.
- One integration test in `test/nesting.test.js` feeding
  `resolveClearances`'s output straight into `nest()`, asserting that two
  8 mm components land 16 mm apart — proving the two halves agree on the
  field name and the unshared semantics.

## Non-goals

- The Laser/Die toggle UI. Sub-project C, per Scope above.
- Kerf compensation on the exported cut path. A laser job wants its path
  offset outward by half the kerf; a die job must not be offset at all. That
  is `exportToSVG`'s concern, already parked by B's spec.
- Mixed laser/die within one job.
- A die footprint polygon.
- Any `cuttingMethod` field on the Job record.
- Rebuilding the nest workspace to load real components. That is C's
  candidate-layout scope.
- Any new dependency.
