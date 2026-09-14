# Cutting Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how much clear space each component's cutting die needs, and
turn a cutting method plus a list of components into the per-part clearances
the nester already knows how to consume.

**Architecture:** One nullable field on the component record
(`dieClearanceMm`, where `null` means no die is owned), and one pure function
`resolveClearances(parts, options)` in a new `src/nesting/clearance.js` that
maps method + components to `{ parts, noDie }`. No geometry work: sub-project
B already made `place()` honour `part.clearanceMm`.

**Tech Stack:** Node.js stdlib (`node:http`, `node --test`), flat-file JSON
stores, vanilla ES modules in the browser. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-13-cutting-method-design.md`

## Global Constraints

- `dieClearanceMm: null` means **no die is owned**. A number means a die
  exists needing that much clear space. There is no `hasDie` boolean.
- `dieClearanceMm: 0` is **legitimate** — a die needing no margin beyond its
  cut line. Every check for "has a die" must be `??` / `== null`, never a
  falsy test. A `||` here silently reports a real die as missing.
- Under `method: 'die'`, a component with no die is **excluded from nesting**
  and reported in its own `noDie` list — never merged into `noFit`. "No die"
  and "didn't fit" are different problems with different fixes.
- Under `method: 'laser'`, `dieClearanceMm` is ignored entirely.
- An unrecognised method **throws**. Defaulting a typo to laser could produce
  a layout cut the wrong way on material that cannot be un-cut.
- `DEFAULT_LASER_CLEARANCE_MM = 1.0` is a runtime fallback.
  `DEFAULT_DIE_CLEARANCE_MM = 8.0` is a **UI prefill only** — never a record
  default. `create()` stores `null`.
- A component's `polygon` stays immutable. `dieClearanceMm` is metadata.
- No `cuttingMethod` field on the Job record, no Laser/Die toggle UI, no kerf
  compensation on export, no die footprint polygon — all out of scope.
- No new dependencies.
- Per repo convention, `src/*-app.js` page wiring gets **no** automated test.

---

## Task 1: `dieClearanceMm` on the component record, through the API

**Files:**
- Modify: `src/dies/store.js` (METADATA_FIELDS at lines 10-19; `create()` at lines 48-76)
- Modify: `server.js` (`validateDieUpdate`, the numeric-field loop at lines 124-135)
- Test: `test/dies-store.test.js`
- Test: `test/dies-route.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: component records carrying `dieClearanceMm` (number or `null`),
  settable via `POST /dies/:id`. Task 2 reads `part.dieClearanceMm`; Task 3
  edits it in the dialog.

- [ ] **Step 1: Write the failing store test**

Append to `test/dies-store.test.js` (the file already imports `fs`, `test`,
`assert`, `createStore`, and defines `makeTmpDir()`):

```js
test('dieClearanceMm defaults to null, and 0 survives a round trip', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Belt strap 38mm',
    polygon: [{ x: 0, y: 0 }, { x: 38, y: 0 }, { x: 38, y: 900 }, { x: 0, y: 900 }],
  });
  assert.equal(record.dieClearanceMm, null, 'a brand new component owns no die');

  assert.equal(store.update(record.id, { dieClearanceMm: 8 }).dieClearanceMm, 8);

  // 0 is a real die that needs no margin beyond its cut line. If anything
  // treats it as falsy it will read as "no die" and the component will be
  // wrongly excluded from every die job.
  assert.equal(store.update(record.id, { dieClearanceMm: 0 }).dieClearanceMm, 0);
  assert.equal(store.list()[0].dieClearanceMm, 0, '0 persists to disk as 0');

  assert.equal(store.update(record.id, { dieClearanceMm: null }).dieClearanceMm, null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/dies-store.test.js`
Expected: FAIL — `record.dieClearanceMm` is `undefined`, not `null`.

- [ ] **Step 3: Add the field to the store**

In `src/dies/store.js`, add `'dieClearanceMm'` as the last entry of the
`METADATA_FIELDS` array (after `'demand'`), so `update()` will write it:

```js
const METADATA_FIELDS = [
  'name',
  'valuePerPiece',
  'productFamily',
  'allowedSpecies',
  'thicknessMinMm',
  'thicknessMaxMm',
  'allowedRotations',
  'demand',
  'dieClearanceMm',
];
```

In `create()`, add `dieClearanceMm` to the destructured parameter list (after
`demand`), and add this line to the `record` object literal immediately after
the `demand: demand ?? 0,` line:

```js
      dieClearanceMm: dieClearanceMm ?? null,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/dies-store.test.js`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Write the failing route test**

Append to `test/dies-route.test.js`. The file already defines the local
`withServer(fn)` wrapper, `postDieDimensions(baseUrl, overrides)`, and
`updateDie(baseUrl, id, payload)` — use them as-is:

```js
test('POST /dies/:id accepts dieClearanceMm, including 0 and null', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();
    assert.equal(created.dieClearanceMm, null, 'new components own no die');

    const set = await updateDie(baseUrl, created.id, { dieClearanceMm: 8 });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).dieClearanceMm, 8);

    // A die needing no margin. Must not be coerced to null.
    const zero = await updateDie(baseUrl, created.id, { dieClearanceMm: 0 });
    assert.equal(zero.status, 200);
    assert.equal((await zero.json()).dieClearanceMm, 0);

    const cleared = await updateDie(baseUrl, created.id, { dieClearanceMm: null });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).dieClearanceMm, null);
  });
});

test('POST /dies/:id returns 400 for a string or negative dieClearanceMm', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();

    const asString = await updateDie(baseUrl, created.id, { dieClearanceMm: '8' });
    assert.equal(asString.status, 400);
    assert.match((await asString.json()).error, /dieClearanceMm/);

    const negative = await updateDie(baseUrl, created.id, { dieClearanceMm: -1 });
    assert.equal(negative.status, 400);
    assert.match((await negative.json()).error, /negative/);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/dies-route.test.js`
Expected: FAIL — `dieClearanceMm` is not in `validateDieUpdate`'s whitelist,
so it is silently dropped and the read-back is `undefined`.

- [ ] **Step 7: Add validation**

In `server.js`, `validateDieUpdate` already has a loop covering the
number-or-null fields. Extend it to cover `dieClearanceMm`, and generalise
the negative check that currently names only `valuePerPiece`. Replace the
loop at lines 124-135 with:

```js
  for (const field of [
    'valuePerPiece',
    'thicknessMinMm',
    'thicknessMaxMm',
    'dieClearanceMm',
  ]) {
    if (field in payload) {
      const value = payload[field];
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value))) {
        return { error: `${field} must be a number or null.` };
      }
      // A negative value per piece or die clearance is meaningless; a
      // negative thickness bound is caught by the range check below.
      if (
        (field === 'valuePerPiece' || field === 'dieClearanceMm') &&
        value !== null &&
        value < 0
      ) {
        return { error: `${field} must not be negative.` };
      }
      result[field] = value;
    }
  }
```

This keeps the existing `valuePerPiece` message byte-identical
(`"valuePerPiece must not be negative."`), so the pre-existing test asserting
`/valuePerPiece/` still passes.

Do **not** touch the `POST /dies` create path or reuse its coercers. Its
`numberOrNull(null)` returns `0`, because `Number(null) === 0` — running
`dieClearanceMm` through it would silently turn "no die" into "a die needing
zero clearance". A die is recorded by editing an existing component, not at
creation.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/dies-route.test.js`
Expected: PASS, including every pre-existing test.

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/dies/store.js server.js test/dies-store.test.js test/dies-route.test.js
git commit -m "feat(dies): record how much clear space a component's die needs"
```

---

## Task 2: `resolveClearances`

**Files:**
- Create: `src/nesting/clearance.js`
- Create: `test/clearance.test.js`
- Test: `test/nesting.test.js` (one integration test appended)

**Interfaces:**
- Consumes: component records carrying `dieClearanceMm` from Task 1.
- Produces:
  - `DEFAULT_LASER_CLEARANCE_MM` = `1.0`
  - `DEFAULT_DIE_CLEARANCE_MM` = `8.0`
  - `resolveClearances(parts, options)` → `{ parts, noDie }`, where `options`
    is `{ method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM }`.

  Task 3 does *not* import these — its placeholder string is written
  literally, to avoid pulling a nesting module into a page for one string.

**Why this module has no geometry in it.** Sub-project B already made
`place()` read `part.clearanceMm` and inflate each part by its *full*
clearance. This function only decides what number goes in that field. If you
find yourself writing polygon code here, stop — you are solving a problem
that is already solved.

- [ ] **Step 1: Write the failing tests**

Create `test/clearance.test.js`:

```js
// test/clearance.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveClearances,
  DEFAULT_LASER_CLEARANCE_MM,
  DEFAULT_DIE_CLEARANCE_MM,
} from '../src/nesting/clearance.js';

// Three components: two tooled, one not.
const PARTS = [
  { id: 'strap', dieClearanceMm: 8 },
  { id: 'keeper', dieClearanceMm: 6 },
  { id: 'pocket', dieClearanceMm: null },
];

test('laser gives every part the same clearance and ignores dies', () => {
  const { parts, noDie } = resolveClearances(PARTS, {
    method: 'laser',
    laserClearanceMm: 1.5,
  });

  assert.deepEqual(parts.map((p) => p.clearanceMm), [1.5, 1.5, 1.5]);
  assert.deepEqual(parts.map((p) => p.id), ['strap', 'keeper', 'pocket']);
  assert.deepEqual(noDie, [], 'a laser job needs no dies, so nothing is untooled');
});

test('laser falls back to DEFAULT_LASER_CLEARANCE_MM', () => {
  const { parts } = resolveClearances(PARTS, { method: 'laser' });
  assert.equal(parts[0].clearanceMm, DEFAULT_LASER_CLEARANCE_MM);
});

test('omitting options entirely defaults to a laser job', () => {
  const { parts, noDie } = resolveClearances(PARTS);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].clearanceMm, DEFAULT_LASER_CLEARANCE_MM);
  assert.deepEqual(noDie, []);
});

test('die gives each component its own die clearance', () => {
  const { parts } = resolveClearances(PARTS, { method: 'die' });

  assert.deepEqual(parts.map((p) => p.id), ['strap', 'keeper']);
  assert.deepEqual(parts.map((p) => p.clearanceMm), [8, 6]);
});

test('die excludes an untooled component and reports it in noDie', () => {
  const { parts, noDie } = resolveClearances(PARTS, { method: 'die' });

  assert.deepEqual(noDie, ['pocket']);
  assert.ok(!parts.some((p) => p.id === 'pocket'), 'excluded from the layout');
});

test('a component missing the field entirely counts as untooled', () => {
  // Records predating this feature have no dieClearanceMm key at all.
  const { parts, noDie } = resolveClearances([{ id: 'legacy' }], { method: 'die' });

  assert.deepEqual(noDie, ['legacy']);
  assert.equal(parts.length, 0);
});

test('a dieClearanceMm of 0 is a real die, not a missing one', () => {
  // A die needing no margin beyond its cut line. A falsy check here would
  // wrongly report this component as untooled and drop it from every job.
  const { parts, noDie } = resolveClearances([{ id: 'flush', dieClearanceMm: 0 }], {
    method: 'die',
  });

  assert.deepEqual(noDie, []);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].clearanceMm, 0);
});

test('an unrecognised method throws rather than guessing', () => {
  // Silently defaulting a typo to laser would cut a die job with laser
  // spacing, on material that cannot be un-cut.
  assert.throws(() => resolveClearances(PARTS, { method: 'waterjet' }), /waterjet/);
});

test('the input parts are not mutated', () => {
  const input = [{ id: 'a', dieClearanceMm: 8 }];
  resolveClearances(input, { method: 'die' });
  assert.equal(input[0].clearanceMm, undefined);
});

test('DEFAULT_DIE_CLEARANCE_MM is a UI prefill, never applied as a fallback', () => {
  assert.equal(DEFAULT_DIE_CLEARANCE_MM, 8.0);

  // An untooled component is excluded, NOT silently given 8mm — otherwise
  // the layout would claim tooling the shop does not own.
  const { parts, noDie } = resolveClearances([{ id: 'untooled' }], { method: 'die' });
  assert.deepEqual(noDie, ['untooled']);
  assert.equal(parts.length, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/clearance.test.js`
Expected: FAIL — `src/nesting/clearance.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/nesting/clearance.js`:

```js
// Decides how much clear space each part needs, given how the job is being
// cut. The nester consumes the result: place() reads part.clearanceMm and
// inflates each part by its FULL clearance (clearances are not shared, so an
// 8mm part beside a 2mm part ends up 10mm away).

export const DEFAULT_LASER_CLEARANCE_MM = 1.0;

// A typical clicker board overhang beyond the blade. Exported for the
// Components dialog to prefill when recording a new die — never used as a
// fallback here, because a component with no die recorded does not have an
// 8mm die, it has no die at all.
export const DEFAULT_DIE_CLEARANCE_MM = 8.0;

export function resolveClearances(parts, options = {}) {
  const { method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM } = options;

  if (method !== 'laser' && method !== 'die') {
    throw new Error(`Unknown cutting method "${method}". Expected "laser" or "die".`);
  }

  // A laser cuts anything on the sheet, so dies are irrelevant and nothing
  // is ever untooled.
  if (method === 'laser') {
    return {
      parts: parts.map((part) => ({ ...part, clearanceMm: laserClearanceMm })),
      noDie: [],
    };
  }

  const tooled = [];
  const noDie = [];
  for (const part of parts) {
    // `??`, not a falsy check: a dieClearanceMm of 0 is a real die needing no
    // margin beyond its cut line, and must not read as "no die".
    const dieClearanceMm = part.dieClearanceMm ?? null;
    if (dieClearanceMm === null) {
      // No die means the piece physically cannot be cut on this job. Report
      // it separately from noFit — "buy a die" and "find a bigger offcut"
      // are different fixes.
      noDie.push(part.id);
    } else {
      tooled.push({ ...part, clearanceMm: dieClearanceMm });
    }
  }
  return { parts: tooled, noDie };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/clearance.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the integration test**

Append to `test/nesting.test.js`. The file already defines `minGapBetween`,
`SQUARE_20`, and `WIDE_SHEET`, and already imports `nest` and
`placedPolygon`. Add this import beside the existing ones at the top:

```js
import { resolveClearances } from '../src/nesting/clearance.js';
```

Then append:

```js
test('resolveClearances output feeds nest() with unshared die clearances', () => {
  // Proves the two halves agree on the field name and on B's unshared
  // semantics: two 8mm dies leave 16mm, not 8mm.
  const components = [
    { id: 'A', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: 8 },
    { id: 'B', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: 8 },
    { id: 'C', polygon: SQUARE_20, allowedRotations: [0], dieClearanceMm: null },
  ];

  const { parts, noDie } = resolveClearances(components, { method: 'die' });
  assert.deepEqual(noDie, ['C'], 'the untooled component never reaches the nester');

  const result = nest(WIDE_SHEET, parts);

  assert.equal(result.placements.length, 2);
  assert.deepEqual(result.noFit, [], 'noFit stays empty — C was excluded, not unfittable');

  const placedPolys = result.placements.map((p) =>
    placedPolygon(parts.find((q) => q.id === p.id), p)
  );
  const gap = minGapBetween(placedPolys[0], placedPolys[1]);
  assert.ok(gap >= 16 - 1e-6, `expected >= 16mm between two 8mm dies, got ${gap}`);
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/nesting.test.js`
Expected: PASS — including every pre-existing test.

Then the full suite:

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/nesting/clearance.js test/clearance.test.js test/nesting.test.js
git commit -m "feat(nesting): resolve cutting method to per-part clearances"
```

---

## Task 3: Die clearance field on the Components page

**Files:**
- Modify: `public/dies.html` (edit dialog, the `.field` blocks at lines 138-169)
- Modify: `src/dies-app.js` (the dialog-populating function around lines
  237-244; the edit submit handler around lines 256-280)

**Interfaces:**
- Consumes: `dieClearanceMm` on component records (Task 1).
- Produces: nothing other tasks read. This is the last task.

No automated test. Per established repo convention, no `src/*-app.js` file
has one — do not add the first.

- [ ] **Step 1: Add the dialog field**

In `public/dies.html`, inside the edit dialog, add a new `.field` block
immediately after the `edit-rotations` block (which ends at line 169), so it
is the last field before `edit-status`:

```html
              <div class="field">
                <label for="edit-die-clearance">Die clearance (mm) — blank if you have no die for this component</label>
                <input class="input" type="number" step="0.1" min="0" id="edit-die-clearance" placeholder="8.0" />
              </div>
```

The label says "blank if you have no die" rather than naming a default,
because blank means `null` (no die) and must not read as zero. The `8.0` is a
placeholder — greyed-out suggestion text, not a value — so an untouched field
still submits `null`.

- [ ] **Step 2: Populate it when the dialog opens**

In `src/dies-app.js`, in the function that fills the dialog (alongside the
existing `edit-thickness-max` and `edit-rotations` lines), add:

```js
  document.getElementById('edit-die-clearance').value = component.dieClearanceMm ?? '';
```

`??` not `||`: a stored `0` must display as `0`, not as an empty field that
would silently clear the die on the next save.

- [ ] **Step 3: Send it on save**

In the edit submit handler, alongside the existing reads of
`edit-thickness-min` and `edit-thickness-max`, add:

```js
  const dieClearance = document.getElementById('edit-die-clearance').value;
```

and add this entry to the payload object sent to `POST /dies/:id`, beside the
existing `demand` and thickness entries:

```js
    dieClearanceMm: dieClearance === '' ? null : Number(dieClearance),
```

Empty string means the operator owns no die, so it clears the field to
`null`. Any other value goes through as a number — including `0`, which is a
real die needing no margin.

- [ ] **Step 4: Verify nothing else broke**

Run: `npm test`
Expected: PASS — no test covers this page, so this confirms the rest of the
suite is unaffected.

Then start the server and load the page:

```bash
npm start
```

Visit `http://localhost:8080/public/dies.html`, click Edit on any component,
and confirm the Die clearance field appears and is blank for a component with
no die. If port 8080 is already in use, an older `node server.js` is
squatting on it — find it with `lsof -ti:8080` and kill it, or the page you
load will be stale code and your check will be meaningless.

- [ ] **Step 5: Commit**

```bash
git add public/dies.html src/dies-app.js
git commit -m "feat(dies): edit a component's die clearance"
```

---

## Self-Review Notes

- **Spec coverage:** the component field with a `null` default and
  `METADATA_FIELDS` membership (Task 1); validation as number-or-null,
  non-negative, without reusing the create-path coercers (Task 1);
  `resolveClearances` with both defaults, laser/die behaviour, the `noDie`
  list, the throw on an unknown method, and non-mutation (Task 2); the
  Components dialog field where blank means no die (Task 3). The spec's
  "no Job field, no toggle UI, no kerf compensation, no footprint polygon"
  non-goals are untouched by every task.
- **Type consistency:** `dieClearanceMm` is spelled identically in the store,
  the validator, both store/route tests, `resolveClearances`, the integration
  test, and the dialog. `resolveClearances(parts, options)` returns
  `{ parts, noDie }` in Task 2's definition and is destructured that way in
  Task 2's own integration test. `DEFAULT_LASER_CLEARANCE_MM` and
  `DEFAULT_DIE_CLEARANCE_MM` are referenced only where Task 2 defines them.
- **The zero trap appears in four places on purpose:** the store test, the
  route test, `resolveClearances`' `??`, and the dialog's `??`. A falsy check
  at any one of them turns a real die into a missing one, and the component
  silently vanishes from every die job. Each site has its own assertion.
- **Backward compatibility:** components created before this feature have no
  `dieClearanceMm` key. `part.dieClearanceMm ?? null` reads `undefined` as
  `null`, so they count as untooled — correct, since nobody has recorded a
  die for them. Task 2 has a test for exactly that record shape.
- **The integration test is the one that would catch a rename:** it takes
  `resolveClearances`' output and hands it straight to `nest()`, so if the
  two ever disagree about `clearanceMm`, two 8mm dies would come out flush
  instead of 16mm apart and the assertion fires.
