# Find Best Use C1 — Scoring Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a scrap hide and a component library, produce ranked,
exactly-nested proposals for what is worth making from it.

**Architecture:** Five pure modules under `src/bestuse/`, composed as a
pipeline: filter eligible components, estimate their capacity cheaply,
generate candidate sets, nest and score each exactly, then rank by a
caller-named strategy. Plus one small change to `src/nesting/place.js` that
skips provably-doomed repeat parts.

**Tech Stack:** Node.js stdlib, `node --test`, existing `clipper-lib`
nesting engine. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-14-find-best-use-c1-design.md`

## Global Constraints

- **Ranking has no default and no fallback.** `rankCandidates(results,
  strategy)` throws on a missing or unknown strategy. "Highest utilization
  wins" must be impossible to reach by omission — omission is an error.
- **Estimates are never layouts.** `estimateCapacity` returns only
  `{ pieces, estimatedValue }` and never placements. Only `nest()` output is
  ever reported as a layout.
- **`unverified` is structured data, per (hide, component) pair** — not a
  warning string, and not a hide-level flag. The operator must be able to see
  *which* component is making an unchecked assumption.
- Only hides with `remainingAreaPct === 100` are searched. A partially-cut
  hide's `outlinePolygon` is still its original shape, so any layout on it
  would place parts over leather that no longer exists.
- Every piece cut counts toward `value`; demand is a separate strategy, never
  blended into value.
- `valuePerPiece: null` contributes 0 and the component id is reported in
  `unpriced`. Unpriced is not free.
- `noFit` (did not fit) and `noDie` (no die owned) stay separate lists.
- Constants: `PACKING_EFFICIENCY = 0.75`, `SHORTLIST_SIZE = 5`.
- No new stored fields, no new stores, no migrations, no new dependencies.
- No UI — that is C2. No mixed-component search — that is C3.

**Spec refinement adopted here:** the spec says a partially-cut hide "is
returned in `excluded`", but `excluded` is a list of *components*. Stuffing a
hide into it would be ambiguous, so `filterEligible` returns a third field:
`hideRejection`, either `null` or a reason string. When it is set, `eligible`
and `excluded` are both `[]`.

---

## Task 1: the monotone skip in `place.js`

**Files:**
- Modify: `src/nesting/place.js` (the `for (const part of parts)` loop, lines 35-135)
- Test: `test/nesting.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `place()` honours an optional `part.componentId`. Once a part with
  a given `componentId` fails to fit, every later part with the same
  `componentId` is reported `noFit` without scanning. Parts with no
  `componentId` behave exactly as today. Task 4 relies on this.

**Why this is safe.** `placed` only ever grows during one `place()` call, so
the free region only ever shrinks. A part that could not fit anywhere cannot
fit later against a strictly smaller free region. Measured waste this
removes: asking for 60 pockets on an irregular hide placed 16 and took
12.9 s, because the 44 failures each ran a full grid scan over every rotation.

- [ ] **Step 1: Write the failing tests**

Append to `test/nesting.test.js`:

```js
test('a failed part short-circuits later parts of the same component', () => {
  // The sheet fits exactly one 80x50. The 2nd and 3rd are doomed the moment
  // the 1st is placed, so they must be reported noFit without scanning.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const parts = [
    { id: 'big#0', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#1', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#2', componentId: 'big', polygon: big, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.equal(result.placements.length, 1);
  assert.deepEqual(result.noFit, ['big#1', 'big#2']);
});

test('the skip is per-component: a different component is still tried', () => {
  // This is the test that fails if the skip is global rather than keyed on
  // componentId — the small part fits easily and must still be placed.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const small = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
  const parts = [
    { id: 'big#0', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'big#1', componentId: 'big', polygon: big, allowedRotations: [0] },
    { id: 'small#0', componentId: 'small', polygon: small, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.deepEqual(result.noFit, ['big#1']);
  assert.ok(
    result.placements.some((p) => p.id === 'small#0'),
    'a different component must still be scanned after big failed'
  );
});

test('parts without componentId are never skipped', () => {
  // Backward compatibility: identical parts with no componentId each get
  // their own scan, exactly as before this feature.
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const big = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }, { x: 0, y: 50 }];
  const parts = [
    { id: 'a', polygon: big, allowedRotations: [0] },
    { id: 'b', polygon: big, allowedRotations: [0] },
  ];

  const result = nest(sheet, parts);

  assert.equal(result.placements.length, 1);
  assert.deepEqual(result.noFit, ['b']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/nesting.test.js`

Expected: these tests may actually PASS before the change. That is expected
and fine — this optimisation is unobservable in output by design. The tests
exist to pin behaviour so a WRONG implementation is caught: a global skip
would break the second test, and skipping parts that lack `componentId`
would break the third. Record in your report which of the three passed
before Step 3.

- [ ] **Step 3: Write the implementation**

In `src/nesting/place.js`, immediately after `const noFit = [];` (line 33),
add:

```js
  // Once a part fails, every later part from the SAME component fails too:
  // `placed` only grows during this call, so the free region only ever
  // shrinks, and a part that fit nowhere cannot fit against less space.
  // Skipping them turns a wasted full grid scan per part into nothing — a
  // measured 12.9s drops to roughly the cost of the parts that could fit.
  // componentId is optional; parts without it are never skipped, so existing
  // callers behave exactly as before.
  const failedComponentIds = new Set();
```

Then change the loop header from `for (const part of parts) {` to:

```js
  for (const part of parts) {
    if (part.componentId !== undefined && failedComponentIds.has(part.componentId)) {
      noFit.push(part.id);
      continue;
    }
```

And in the `else` branch at the end of the loop, change:

```js
    } else {
      noFit.push(part.id);
    }
```

to:

```js
    } else {
      noFit.push(part.id);
      if (part.componentId !== undefined) failedComponentIds.add(part.componentId);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/nesting.test.js`
Expected: PASS, including every pre-existing test.

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nesting/place.js test/nesting.test.js
git commit -m "perf(nesting): skip provably-doomed repeat parts"
```

---

## Task 2: `filterEligible`

**Files:**
- Create: `src/bestuse/eligibility.js`
- Test: `test/bestuse-eligibility.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  `filterEligible(hide, components)` -> `{ eligible, excluded, hideRejection }`
  where `eligible` is `[{ component, unverified: string[] }]`, `excluded` is
  `[{ componentId, reason }]`, and `hideRejection` is `null` or a reason
  string. Tasks 3, 4 and 5 consume `eligible` entries in that exact shape.

- [ ] **Step 1: Write the failing tests**

Create `test/bestuse-eligibility.test.js`:

```js
// test/bestuse-eligibility.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEligible } from '../src/bestuse/eligibility.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];

function makeHide(overrides = {}) {
  return {
    id: 'h1', species: 'alligator', thicknessMm: 1.8,
    outlinePolygon: OUTLINE, remainingAreaPct: 100, ...overrides,
  };
}
function makeComponent(overrides = {}) {
  return {
    id: 'c1', name: 'Strap', polygon: [{ x: 0, y: 0 }, { x: 38, y: 0 }, { x: 38, y: 400 }],
    allowedSpecies: null, thicknessMinMm: null, thicknessMaxMm: null,
    valuePerPiece: 60, demand: 0, allowedRotations: [0, 90], dieClearanceMm: null,
    ...overrides,
  };
}

test('a component with no constraints is eligible with nothing unverified', () => {
  const { eligible, excluded, hideRejection } = filterEligible(makeHide(), [makeComponent()]);

  assert.equal(hideRejection, null);
  assert.deepEqual(excluded, []);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].component.id, 'c1');
  assert.deepEqual(eligible[0].unverified, []);
});

test('allowedSpecies null means any species; a list must contain the hide species', () => {
  const hide = makeHide({ species: 'alligator' });

  const anySpecies = filterEligible(hide, [makeComponent({ allowedSpecies: null })]);
  assert.equal(anySpecies.eligible.length, 1);

  const matching = filterEligible(hide, [makeComponent({ allowedSpecies: ['calf', 'alligator'] })]);
  assert.equal(matching.eligible.length, 1);

  const wrong = filterEligible(hide, [makeComponent({ allowedSpecies: ['calf'] })]);
  assert.equal(wrong.eligible.length, 0);
  assert.deepEqual(wrong.excluded, [{ componentId: 'c1', reason: 'species' }]);
});

test('thickness bounds are checked, each side independently optional', () => {
  const hide = makeHide({ thicknessMm: 1.8 });

  const inRange = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.5, thicknessMaxMm: 2.0 })]);
  assert.equal(inRange.eligible.length, 1);
  assert.deepEqual(inRange.eligible[0].unverified, []);

  const tooThin = filterEligible(hide, [makeComponent({ thicknessMinMm: 2.0 })]);
  assert.deepEqual(tooThin.excluded, [{ componentId: 'c1', reason: 'thickness' }]);

  const tooThick = filterEligible(hide, [makeComponent({ thicknessMaxMm: 1.5 })]);
  assert.deepEqual(tooThick.excluded, [{ componentId: 'c1', reason: 'thickness' }]);

  const onlyMin = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.0 })]);
  assert.equal(onlyMin.eligible.length, 1);
});

test('an unmeasured hide keeps the component eligible but records what was not checked', () => {
  // The common case: a scrap gets photographed long before anyone measures
  // it. Blocking here would make the tool useless on real inventory; the
  // gate belongs at the point of commitment instead.
  const hide = makeHide({ thicknessMm: null });

  const { eligible } = filterEligible(hide, [makeComponent({ thicknessMinMm: 1.5, thicknessMaxMm: 2.0 })]);

  assert.equal(eligible.length, 1);
  assert.deepEqual(eligible[0].unverified, ['thicknessMm']);
});

test('an unmeasured hide leaves an unconstrained component fully verified', () => {
  const hide = makeHide({ thicknessMm: null });

  const { eligible } = filterEligible(hide, [makeComponent()]);

  assert.deepEqual(eligible[0].unverified, [], 'nothing was assumed for this component');
});

test('a partially-cut hide is rejected outright, with a reason', () => {
  // remainingAreaPct says material is gone, but outlinePolygon is still the
  // original shape — nothing records WHERE the cuts went, so any layout
  // would place parts over leather that no longer exists.
  const hide = makeHide({ remainingAreaPct: 60 });

  const { eligible, excluded, hideRejection } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, 'partially-cut');
  assert.deepEqual(eligible, []);
  assert.deepEqual(excluded, []);
});

test('a hide with no outline is rejected outright', () => {
  const hide = makeHide({ outlinePolygon: null });

  const { hideRejection, eligible } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, 'no-outline');
  assert.deepEqual(eligible, []);
});

test('a legacy hide with no remainingAreaPct key counts as uncut', () => {
  const hide = makeHide({ remainingAreaPct: undefined });

  const { hideRejection, eligible } = filterEligible(hide, [makeComponent()]);

  assert.equal(hideRejection, null);
  assert.equal(eligible.length, 1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/bestuse-eligibility.test.js`
Expected: FAIL — `src/bestuse/eligibility.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/bestuse/eligibility.js`:

```js
// Decides which components could be cut from a given hide, and records what
// could not be checked rather than guessing.

export function filterEligible(hide, components) {
  if (!hide || hide.outlinePolygon == null) {
    return { eligible: [], excluded: [], hideRejection: 'no-outline' };
  }

  // A partially-cut hide still carries its ORIGINAL outline — nothing
  // records where the cuts went — so any layout on it would place parts over
  // leather that is already gone. Re-photographing the offcut as a new hide
  // is the real fix, and is what the operator would physically do anyway.
  // A missing key means the record predates the Jobs feature: treat as uncut.
  if ((hide.remainingAreaPct ?? 100) < 100) {
    return { eligible: [], excluded: [], hideRejection: 'partially-cut' };
  }

  const eligible = [];
  const excluded = [];

  for (const component of components) {
    if (
      component.allowedSpecies != null &&
      !component.allowedSpecies.includes(hide.species)
    ) {
      excluded.push({ componentId: component.id, reason: 'species' });
      continue;
    }

    const unverified = [];
    const min = component.thicknessMinMm;
    const max = component.thicknessMaxMm;

    if (min != null || max != null) {
      if (hide.thicknessMm == null) {
        // Eligible, but the operator is told exactly which constraint went
        // unchecked so a later confirm step can demand the measurement.
        unverified.push('thicknessMm');
      } else if (
        (min != null && hide.thicknessMm < min) ||
        (max != null && hide.thicknessMm > max)
      ) {
        excluded.push({ componentId: component.id, reason: 'thickness' });
        continue;
      }
    }

    eligible.push({ component, unverified });
  }

  return { eligible, excluded, hideRejection: null };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/bestuse-eligibility.test.js`
Expected: PASS (8 tests).

Then: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bestuse/eligibility.js test/bestuse-eligibility.test.js
git commit -m "feat(bestuse): filter components eligible for a hide"
```

---

## Task 3: `estimateCapacity` and `generateCandidates`

**Files:**
- Create: `src/bestuse/estimate.js`
- Create: `src/bestuse/candidates.js`
- Test: `test/bestuse-candidates.test.js`

**Interfaces:**
- Consumes: `eligible` entries `{ component, unverified }` from Task 2.
- Produces:
  - `PACKING_EFFICIENCY` = `0.75`, `SHORTLIST_SIZE` = `5`
  - `estimateCapacity(hide, component, options)` -> `{ pieces, estimatedValue }`
  - `ESTIMATE_SCORERS` — a map keyed by strategy name
  - `generateCandidates(mode, eligible, options)` -> `[{ candidateId, mode, items }]`
    where `items` is `[{ component, quantity, unverified }]`.

  Task 4 consumes candidates in exactly that shape.

**Why these two ship together.** The shortlist logic spans both: `singles`
mode sizes each candidate from the estimate AND picks which candidates to
keep. Splitting them would leave a module with no reachable caller.

- [ ] **Step 1: Write the failing tests**

Create `test/bestuse-candidates.test.js`:

```js
// test/bestuse-candidates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCapacity, PACKING_EFFICIENCY } from '../src/bestuse/estimate.js';
import { generateCandidates, SHORTLIST_SIZE } from '../src/bestuse/candidates.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }];
const HIDE = { id: 'h1', species: 'alligator', thicknessMm: 1.8, outlinePolygon: OUTLINE, remainingAreaPct: 100 };

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
function comp(id, w, h, overrides = {}) {
  return {
    id, name: id, polygon: rect(w, h), allowedSpecies: null,
    thicknessMinMm: null, thicknessMaxMm: null, valuePerPiece: 10,
    demand: 0, allowedRotations: [0, 90], dieClearanceMm: null, ...overrides,
  };
}
const elig = (component) => ({ component, unverified: [] });

test('estimateCapacity is hide area times efficiency, over part area', () => {
  // 600x400 = 240000mm^2; at 0.75 that is 180000 usable; a 100x100 part is
  // 10000, so 18 pieces.
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('a', 100, 100));

  assert.equal(PACKING_EFFICIENCY, 0.75);
  assert.equal(pieces, 18);
  assert.equal(estimatedValue, 180);
});

test('estimateCapacity returns 0 for a part larger than the usable area', () => {
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('huge', 600, 400));

  assert.equal(pieces, 0);
  assert.equal(estimatedValue, 0);
});

test('estimateCapacity treats an unpriced component as worth 0, not as free', () => {
  const { pieces, estimatedValue } = estimateCapacity(HIDE, comp('x', 100, 100, { valuePerPiece: null }));

  assert.equal(pieces, 18);
  assert.equal(estimatedValue, 0);
});

test('estimateCapacity never returns placements', () => {
  // The whole point of the two-stage design: an estimate must never be
  // mistakable for a layout.
  const estimate = estimateCapacity(HIDE, comp('a', 100, 100));

  assert.deepEqual(Object.keys(estimate).sort(), ['estimatedValue', 'pieces']);
});

test('explicit mode produces one candidate from the chosen quantities', () => {
  const eligible = [elig(comp('a', 50, 50)), elig(comp('b', 60, 60))];

  const candidates = generateCandidates('explicit', eligible, {
    hide: HIDE,
    quantities: { a: 3, b: 2 },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].mode, 'explicit');
  assert.deepEqual(
    candidates[0].items.map((i) => [i.component.id, i.quantity]),
    [['a', 3], ['b', 2]]
  );
});

test('explicit mode omits components with no quantity, and returns nothing if none', () => {
  const eligible = [elig(comp('a', 50, 50)), elig(comp('b', 60, 60))];

  const partial = generateCandidates('explicit', eligible, { hide: HIDE, quantities: { a: 2 } });
  assert.deepEqual(partial[0].items.map((i) => i.component.id), ['a']);

  const none = generateCandidates('explicit', eligible, { hide: HIDE, quantities: {} });
  assert.deepEqual(none, []);
});

test('singles mode produces one candidate per component, each a single type', () => {
  const eligible = [elig(comp('a', 100, 100)), elig(comp('b', 120, 120))];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.equal(candidates.length, 2);
  for (const c of candidates) {
    assert.equal(c.items.length, 1, 'singles mode never mixes component types');
    assert.ok(c.items[0].quantity > 0);
  }
});

test('singles mode shortlists to SHORTLIST_SIZE, keeping the best by strategy', () => {
  // Eight components; only the top five by estimated value survive.
  const eligible = [
    elig(comp('cheap', 100, 100, { valuePerPiece: 1 })),
    elig(comp('mid1', 100, 100, { valuePerPiece: 5 })),
    elig(comp('mid2', 100, 100, { valuePerPiece: 6 })),
    elig(comp('mid3', 100, 100, { valuePerPiece: 7 })),
    elig(comp('mid4', 100, 100, { valuePerPiece: 8 })),
    elig(comp('rich', 100, 100, { valuePerPiece: 100 })),
    elig(comp('poor', 100, 100, { valuePerPiece: 2 })),
    elig(comp('free', 100, 100, { valuePerPiece: null })),
  ];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.equal(SHORTLIST_SIZE, 5);
  assert.equal(candidates.length, 5);
  const ids = candidates.map((c) => c.items[0].component.id);
  assert.ok(ids.includes('rich'), 'the highest-value component must survive');
  assert.ok(!ids.includes('free'), 'an unpriced component scores 0 under value');
});

test('the shortlist depends on the strategy, not a fixed value ordering', () => {
  // A cheap component that fits many times beats a dear one under
  // utilization and loses under value. If shortlisting ignored the strategy,
  // the utilization winner would be dropped before it was ever nested — a
  // bug invisible in the final output.
  const eligible = [
    elig(comp('tiny', 20, 20, { valuePerPiece: 1 })),
    elig(comp('dear', 300, 400, { valuePerPiece: 500 })),
    elig(comp('f1', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f2', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f3', 100, 100, { valuePerPiece: 9 })),
    elig(comp('f4', 100, 100, { valuePerPiece: 9 })),
  ];

  const byUtil = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'utilization' })
    .map((c) => c.items[0].component.id);

  assert.ok(byUtil.includes('tiny'), 'tiny fills the most area and must be shortlisted');
});

test('singles mode drops components that cannot fit even once', () => {
  const eligible = [elig(comp('huge', 600, 400)), elig(comp('ok', 100, 100))];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.deepEqual(candidates.map((c) => c.items[0].component.id), ['ok']);
});

test('candidates carry the unverified constraints of their components', () => {
  const eligible = [{ component: comp('a', 100, 100), unverified: ['thicknessMm'] }];

  const candidates = generateCandidates('singles', eligible, { hide: HIDE, strategy: 'value' });

  assert.deepEqual(candidates[0].items[0].unverified, ['thicknessMm']);
});

test('an unrecognised mode throws rather than guessing', () => {
  assert.throws(
    () => generateCandidates('telepathy', [], { hide: HIDE }),
    /telepathy/
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/bestuse-candidates.test.js`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Write `estimate.js`**

Create `src/bestuse/estimate.js`:

```js
import { polygonArea } from '../nesting/geometry.js';

// Deliberately generous rather than accurate. A shortlist's only job is to
// avoid discarding a winner: over-estimating costs one wasted exact nest,
// while under-estimating silently loses the best answer. Measured packing on
// an irregular outline runs 60-70%, so 0.75 keeps this an upper bound.
export const PACKING_EFFICIENCY = 0.75;

// Cheap, area-only. NEVER returns placements — only nest() produces a layout.
export function estimateCapacity(hide, component, options = {}) {
  const efficiency = options.packingEfficiency ?? PACKING_EFFICIENCY;
  const hideArea = polygonArea(hide.outlinePolygon);
  const partArea = polygonArea(component.polygon);

  if (!(hideArea > 0) || !(partArea > 0)) return { pieces: 0, estimatedValue: 0 };

  const pieces = Math.floor((hideArea * efficiency) / partArea);
  // An unpriced component is not free, it is unpriced. It scores 0 here and
  // is reported separately downstream.
  const estimatedValue = pieces * (component.valuePerPiece ?? 0);

  return { pieces, estimatedValue };
}

// Mirrors RANKING_STRATEGIES so the shortlist is scored by the same question
// the final ranking asks. Shortlisting by value while ranking by utilization
// would discard the utilization winner before it was ever nested.
export const ESTIMATE_SCORERS = {
  value: (estimate) => estimate.estimatedValue,
  utilization: (estimate, component) =>
    estimate.pieces * polygonArea(component.polygon),
  demand: (estimate, component) => Math.min(estimate.pieces, component.demand ?? 0),
};
```

- [ ] **Step 4: Write `candidates.js`**

Create `src/bestuse/candidates.js`:

```js
import { estimateCapacity, ESTIMATE_SCORERS } from './estimate.js';

// At roughly 1-6s per exact nest, five keeps a run in the seconds range.
export const SHORTLIST_SIZE = 5;

export function generateCandidates(mode, eligible, options = {}) {
  if (mode === 'explicit') return explicitCandidates(eligible, options);
  if (mode === 'singles') return singlesCandidates(eligible, options);
  throw new Error(`Unknown candidate mode "${mode}". Expected "explicit" or "singles".`);
}

// The operator has already named the quantities, so no estimate is involved.
function explicitCandidates(eligible, options) {
  const quantities = options.quantities ?? {};
  const items = eligible
    .filter((entry) => (quantities[entry.component.id] ?? 0) > 0)
    .map((entry) => ({
      component: entry.component,
      quantity: quantities[entry.component.id],
      unverified: entry.unverified,
    }));

  return items.length ? [{ candidateId: 'explicit', mode: 'explicit', items }] : [];
}

// One candidate per component, each that type alone, sized by the estimate
// and shortlisted so a run stays in the seconds range.
function singlesCandidates(eligible, options) {
  const { hide, strategy } = options;
  const shortlistSize = options.shortlistSize ?? SHORTLIST_SIZE;
  const score = ESTIMATE_SCORERS[strategy];
  if (!score) {
    throw new Error(
      `Unknown strategy "${strategy}". Expected one of: ${Object.keys(ESTIMATE_SCORERS).join(', ')}.`
    );
  }

  return eligible
    .map((entry) => ({ entry, estimate: estimateCapacity(hide, entry.component, options) }))
    .filter(({ estimate }) => estimate.pieces > 0)
    .sort((a, b) => score(b.estimate, b.entry.component) - score(a.estimate, a.entry.component))
    .slice(0, shortlistSize)
    .map(({ entry, estimate }) => ({
      candidateId: `single:${entry.component.id}`,
      mode: 'singles',
      items: [
        {
          component: entry.component,
          quantity: estimate.pieces,
          unverified: entry.unverified,
        },
      ],
    }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/bestuse-candidates.test.js`
Expected: PASS (12 tests).

Then: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bestuse/estimate.js src/bestuse/candidates.js test/bestuse-candidates.test.js
git commit -m "feat(bestuse): estimate capacity and generate shortlisted candidates"
```

---

## Task 4: `evaluateCandidate`

**Files:**
- Create: `src/bestuse/evaluate.js`
- Test: `test/bestuse-evaluate.test.js`

**Interfaces:**
- Consumes: candidates `{ candidateId, mode, items }` from Task 3;
  `place()`'s `componentId` short-circuit from Task 1.
- Produces: `evaluateCandidate(hide, candidate, options)` -> a scored result
  with the exact keys `candidateId`, `mode`, `placements`, `counts`, `value`,
  `utilization`, `demandSatisfied`, `noFit`, `noDie`, `unverified`,
  `unpriced`. Task 5 ranks these.

**The integration detail that will bite you.** `resolveClearances` and
`nest()` both work in terms of PART ids, and this module creates one part per
piece (`"strapId#0"`, `"strapId#1"`, ...). Their `noDie` and `noFit` lists
therefore come back full of part ids. The result must report COMPONENT ids,
deduplicated. Getting this wrong produces a list like
`['strap#3','strap#4','strap#5']` where the operator expected `['strap']`.

- [ ] **Step 1: Write the failing tests**

Create `test/bestuse-evaluate.test.js`:

```js
// test/bestuse-evaluate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { evaluateCandidate } from '../src/bestuse/evaluate.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const HIDE = { id: 'h1', species: 'alligator', thicknessMm: 1.8, outlinePolygon: OUTLINE, remainingAreaPct: 100 };

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
function comp(id, w, h, overrides = {}) {
  return {
    id, name: id, polygon: rect(w, h), allowedSpecies: null,
    thicknessMinMm: null, thicknessMaxMm: null, valuePerPiece: 10,
    demand: 0, allowedRotations: [0], dieClearanceMm: null, ...overrides,
  };
}
function candidate(items) {
  return { candidateId: 'test', mode: 'explicit', items };
}

test('value is piece value times placed count', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20, { valuePerPiece: 7 }), quantity: 3, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.a, 3);
  assert.equal(result.value, 21);
});

test('utilization is placed area over hide outline area', () => {
  // Three 20x20 = 1200mm^2 of a 200x100 = 20000mm^2 hide.
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20), quantity: 3, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.ok(Math.abs(result.utilization - 1200 / 20000) < 1e-9, `got ${result.utilization}`);
});

test('an unpriced component contributes 0 and is reported, not treated as free', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('priced', 20, 20, { valuePerPiece: 5 }), quantity: 2, unverified: [] },
      { component: comp('free', 20, 20, { valuePerPiece: null }), quantity: 2, unverified: [] },
    ]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.value, 10, 'only the priced component contributes');
  assert.deepEqual(result.unpriced, ['free']);
});

test('noFit reports COMPONENT ids, deduplicated — not part ids', () => {
  // The sheet fits one 150x90; asking for four means three cannot fit.
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('big', 150, 90), quantity: 4, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.big, 1);
  assert.deepEqual(result.noFit, ['big'], 'one component id, not big#1/big#2/big#3');
});

test('noDie reports component ids and stays separate from noFit', () => {
  // "buy a die" and "find a bigger offcut" are different fixes, so they must
  // never be merged into one list.
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('tooled', 20, 20, { dieClearanceMm: 2 }), quantity: 2, unverified: [] },
      { component: comp('untooled', 20, 20, { dieClearanceMm: null }), quantity: 2, unverified: [] },
    ]),
    { method: 'die' }
  );

  assert.deepEqual(result.noDie, ['untooled']);
  assert.deepEqual(result.noFit, []);
  assert.equal(result.counts.tooled, 2);
  assert.equal(result.counts.untooled ?? 0, 0);
});

test('demandSatisfied counts each component only up to its demand', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20, { demand: 2 }), quantity: 5, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.counts.a, 5, 'all five are cut');
  assert.equal(result.demandSatisfied, 2, 'but only two were wanted');
});

test('unverified is the union across the candidate components', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([
      { component: comp('a', 20, 20), quantity: 1, unverified: ['thicknessMm'] },
      { component: comp('b', 20, 20), quantity: 1, unverified: ['thicknessMm'] },
    ]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.deepEqual(result.unverified, ['thicknessMm'], 'union, deduplicated');
});

test('placements come from the nester, never from an estimate', () => {
  const result = evaluateCandidate(
    HIDE,
    candidate([{ component: comp('a', 20, 20), quantity: 2, unverified: [] }]),
    { method: 'laser', laserClearanceMm: 0 }
  );

  assert.equal(result.placements.length, 2);
  for (const p of result.placements) {
    assert.equal(typeof p.x, 'number');
    assert.equal(typeof p.y, 'number');
    assert.equal(typeof p.rotation, 'number');
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/bestuse-evaluate.test.js`
Expected: FAIL — `src/bestuse/evaluate.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/bestuse/evaluate.js`:

```js
import { nest } from '../nesting/index.js';
import { polygonArea } from '../nesting/geometry.js';
import { resolveClearances } from '../nesting/clearance.js';

// Turns one candidate into an exactly-nested, scored result. Every number
// here comes from the nester — no estimate reaches this module.
export function evaluateCandidate(hide, candidate, options = {}) {
  const componentsById = new Map();
  const parts = [];

  for (const item of candidate.items) {
    componentsById.set(item.component.id, item.component);
    for (let i = 0; i < item.quantity; i++) {
      parts.push({
        id: `${item.component.id}#${i}`,
        // Lets place() skip the rest of a component once one fails, instead
        // of burning a full grid scan on each provably-doomed repeat.
        componentId: item.component.id,
        polygon: item.component.polygon,
        allowedRotations: item.component.allowedRotations,
        dieClearanceMm: item.component.dieClearanceMm,
      });
    }
  }

  const { parts: cuttable, noDie: noDiePartIds } = resolveClearances(parts, options);
  const { placements, noFit: noFitPartIds } = nest(hide.outlinePolygon, cuttable);

  // resolveClearances and nest() both speak in PART ids ("strap#3"), because
  // one component becomes many parts. The operator thinks in components, so
  // fold both lists back and deduplicate.
  const componentIdOf = (partId) => partId.slice(0, partId.lastIndexOf('#'));
  const toComponentIds = (partIds) => {
    const seen = [];
    for (const partId of partIds) {
      const componentId = componentIdOf(partId);
      if (!seen.includes(componentId)) seen.push(componentId);
    }
    return seen;
  };

  const counts = {};
  for (const placement of placements) {
    const componentId = componentIdOf(placement.id);
    counts[componentId] = (counts[componentId] ?? 0) + 1;
  }

  let value = 0;
  let placedArea = 0;
  let demandSatisfied = 0;
  const unpriced = [];

  for (const [componentId, count] of Object.entries(counts)) {
    const component = componentsById.get(componentId);
    // An unpriced component is not free to make, it is unpriced. It adds 0
    // and is named, so a UI can say so rather than showing a confident $0.
    if (component.valuePerPiece == null) unpriced.push(componentId);
    else value += component.valuePerPiece * count;

    placedArea += polygonArea(component.polygon) * count;
    demandSatisfied += Math.min(count, component.demand ?? 0);
  }

  const hideArea = polygonArea(hide.outlinePolygon);
  const unverified = [];
  for (const item of candidate.items) {
    for (const key of item.unverified ?? []) {
      if (!unverified.includes(key)) unverified.push(key);
    }
  }

  return {
    candidateId: candidate.candidateId,
    mode: candidate.mode,
    placements,
    counts,
    value,
    utilization: hideArea > 0 ? placedArea / hideArea : 0,
    demandSatisfied,
    noFit: toComponentIds(noFitPartIds),
    noDie: toComponentIds(noDiePartIds),
    unverified,
    unpriced,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/bestuse-evaluate.test.js`
Expected: PASS (8 tests).

Then: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bestuse/evaluate.js test/bestuse-evaluate.test.js
git commit -m "feat(bestuse): nest and score a candidate exactly"
```

---

## Task 5: `rankCandidates`

**Files:**
- Create: `src/bestuse/ranking.js`
- Test: `test/bestuse-ranking.test.js`

**Interfaces:**
- Consumes: scored results from Task 4.
- Produces: `RANKING_STRATEGIES` (a map of comparator functions) and
  `rankCandidates(results, strategy)` -> a new sorted array.

**This is the task the whole brief is about.** The governing constraint is
that maximum utilization is NOT maximum value. So `rankCandidates` takes no
default strategy and throws on a missing or unknown one: a caller must name
the question it is asking, and "highest utilization wins" cannot be reached
by omission because omission is an error.

- [ ] **Step 1: Write the failing tests**

Create `test/bestuse-ranking.test.js`:

```js
// test/bestuse-ranking.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, RANKING_STRATEGIES } from '../src/bestuse/ranking.js';

function result(candidateId, { value = 0, utilization = 0, demandSatisfied = 0 }) {
  return { candidateId, value, utilization, demandSatisfied, placements: [], counts: {} };
}

test('value orders by total value, highest first', () => {
  const ranked = rankCandidates(
    [result('a', { value: 100 }), result('b', { value: 300 }), result('c', { value: 200 })],
    'value'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['b', 'c', 'a']);
});

test('utilization orders by area used, highest first', () => {
  const ranked = rankCandidates(
    [result('a', { utilization: 0.2 }), result('b', { utilization: 0.9 })],
    'utilization'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['b', 'a']);
});

test('demand orders by orders filled, breaking ties on value', () => {
  const ranked = rankCandidates(
    [
      result('a', { demandSatisfied: 2, value: 50 }),
      result('b', { demandSatisfied: 2, value: 90 }),
      result('c', { demandSatisfied: 5, value: 10 }),
    ],
    'demand'
  );

  assert.deepEqual(ranked.map((r) => r.candidateId), ['c', 'b', 'a']);
});

test('THE POINT: value and utilization pick different winners', () => {
  // A hide packed 89% full of cheap keepers is worth less than one packed
  // 68% with belt straps. If this ever fails, some comparison has been
  // hardcoded and the tool has quietly become a utilization maximiser.
  const keepers = result('keepers', { value: 196, utilization: 0.89 });
  const straps = result('straps', { value: 284, utilization: 0.68 });

  const byValue = rankCandidates([keepers, straps], 'value');
  const byUtilization = rankCandidates([keepers, straps], 'utilization');

  assert.equal(byValue[0].candidateId, 'straps');
  assert.equal(byUtilization[0].candidateId, 'keepers');
  assert.notEqual(byValue[0].candidateId, byUtilization[0].candidateId);
});

test('an unknown strategy throws rather than falling back', () => {
  assert.throws(() => rankCandidates([], 'vibes'), /vibes/);
});

test('a missing strategy throws — naming the question is mandatory', () => {
  // There is deliberately no default. Defaulting would let "highest
  // utilization wins" become the answer by omission.
  assert.throws(() => rankCandidates([]), /strategy/i);
});

test('every advertised strategy is a callable comparator', () => {
  for (const [name, comparator] of Object.entries(RANKING_STRATEGIES)) {
    assert.equal(typeof comparator, 'function', `${name} must be a comparator`);
    assert.equal(comparator.length, 2, `${name} must take two results`);
  }
});

test('ranking does not mutate the input array', () => {
  const input = [result('a', { value: 1 }), result('b', { value: 2 })];
  const before = input.map((r) => r.candidateId);

  rankCandidates(input, 'value');

  assert.deepEqual(input.map((r) => r.candidateId), before);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/bestuse-ranking.test.js`
Expected: FAIL — `src/bestuse/ranking.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/bestuse/ranking.js`:

```js
// The brief's governing constraint: maximum material utilization is NOT
// maximum value. A hide packed 89% full of cheap keepers can be worth less
// than one packed 68% with belt straps. So ranking is a map of interchangeable
// comparators, and the caller must name which question it is asking.

export const RANKING_STRATEGIES = {
  value: (a, b) => b.value - a.value,
  utilization: (a, b) => b.utilization - a.utilization,
  // Orders filled first, then worth — two candidates that fill the same
  // orders are separated by what else they yield.
  demand: (a, b) => b.demandSatisfied - a.demandSatisfied || b.value - a.value,
};

// No default strategy, deliberately. A default would let "highest
// utilization wins" become the answer by omission; here omission is an error.
export function rankCandidates(results, strategy) {
  const comparator = RANKING_STRATEGIES[strategy];
  if (!comparator) {
    throw new Error(
      `Unknown ranking strategy ${JSON.stringify(strategy)}. ` +
        `Expected one of: ${Object.keys(RANKING_STRATEGIES).join(', ')}.`
    );
  }
  return [...results].sort(comparator);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/bestuse-ranking.test.js`
Expected: PASS (8 tests).

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bestuse/ranking.js test/bestuse-ranking.test.js
git commit -m "feat(bestuse): rank candidates by a caller-named strategy"
```

---

## Self-Review Notes

- **Spec coverage:** eligibility with `unverified` and the partially-cut
  rejection (Task 2); `estimateCapacity` with `PACKING_EFFICIENCY` and the
  strategy-aware shortlist at `SHORTLIST_SIZE` (Task 3); both generators
  (Task 3); exact nesting, value/utilization/demand scoring, `unpriced`, and
  the separate `noFit`/`noDie` lists (Task 4); pluggable ranking with no
  default (Task 5); the monotone skip (Task 1). The spec's non-goals — UI,
  mixed search, `src/app.js`, kerf compensation — are untouched throughout.
- **Type consistency:** `eligible` entries are `{ component, unverified }`
  in Task 2's output and are destructured that way in Task 3. Candidates are
  `{ candidateId, mode, items }` with `items: [{ component, quantity,
  unverified }]` in Task 3 and consumed identically in Task 4. Task 4's
  result keys match Task 5's comparators (`value`, `utilization`,
  `demandSatisfied`) exactly.
- **The part-id/component-id boundary is the riskiest seam.** One component
  becomes N parts, so `resolveClearances` and `nest()` return part ids while
  the operator thinks in components. Task 4 folds both `noFit` and `noDie`
  back and deduplicates, and has a test asserting `['big']` rather than
  `['big#1','big#2','big#3']`.
- **Two tests exist to catch a wrong model rather than a wrong line.**
  "value and utilization pick different winners" fails if any comparison is
  hardcoded. "the shortlist depends on the strategy" fails if shortlisting
  always sorts by value, which would silently drop the utilization winner
  before it was ever nested — a bug invisible in the final output.
- **Task 1 is unobservable by design.** The monotone skip changes speed, not
  results, so its tests pin behaviour (per-component, not global; absent
  `componentId` unchanged) rather than proving the optimisation fired. That
  is deliberate: a timing assertion would be flaky.
