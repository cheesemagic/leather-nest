# Component Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing dies library into a component library — pieces
carrying the economic and material metadata a value-aware matcher needs,
creatable from plain dimensions, editable after the fact, on a page that
finally matches the rest of the app.

**Architecture:** Extend `src/dies/store.js` with seven optional fields and
an `update()` that writes metadata but never geometry. `handleCreateDie` in
`server.js` gains a third branch (width × height → rectangle) beside the two
it already has, and a new `POST /dies/:id` update route. `public/dies.html`
and `src/dies-app.js` are re-skinned onto the Organic design system
following `public/hides.html`'s conventions.

**Tech Stack:** Node.js (`node --test`), vanilla browser JS (ES modules, no
bundler), `formidable` for multipart parsing. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-component-library-design.md`

## Global Constraints

- No internal identifier renames. Routes stay `/dies`, the store stays
  `src/dies/`, the data directory stays `data/dies/`. Only the page's
  title, nav label, and user-facing copy say "Components".
- Existing die records have none of the new fields and read back as
  `undefined`. Nothing may assume they are present.
- The two existing creation paths (SVG upload, photo+calibrate+ROI) must
  behave exactly as they do today for callers that send no new fields —
  `src/match-blotches-app.js` and `server.js`'s placement handler both read
  only `name` and `polygon`, and must keep working untouched.
- Geometry is never editable. `update()` and the update route must not
  write `polygon`, `id`, or `createdAt` under any input.
- Area, width, and height are always derived from the polygon
  (`polygonArea()`, `boundingBox()`), never stored.
- No matching, ranking, value computation, utilization figures, or visual
  nesting — all of that is sub-project C and must not appear here, not even
  stubbed.
- `public/dies.html`/`src/dies-app.js` get no automated test — browser-only
  UI, the established precedent for every page in this project.

---

## Task 1: store fields and `update()`

**Files:**
- Modify: `src/dies/store.js`
- Test: `test/dies-store.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `create({ name, polygon, valuePerPiece, productFamily, allowedSpecies,
    thicknessMinMm, thicknessMaxMm, allowedRotations, demand })` — all but
    `name`/`polygon` optional. Defaults: the five `null`s,
    `allowedRotations: [0, 90, 180, 270]`, `demand: 0`.
  - `update(id, fields)` — merges only metadata, returns the updated record
    or `null` for an unknown id.

  Task 2 (`server.js`) calls both.

- [ ] **Step 1: Write the failing tests**

Add to `test/dies-store.test.js` (it already imports `createStore` from
`../src/dies/store.js` and has a `makeTmpDir()` helper — read them first and
reuse):

```js
const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test('create() defaults the component metadata fields', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({ name: 'Belt keeper 35mm', polygon: SQUARE });

  assert.equal(record.valuePerPiece, null);
  assert.equal(record.productFamily, null);
  assert.equal(record.allowedSpecies, null);
  assert.equal(record.thicknessMinMm, null);
  assert.equal(record.thicknessMaxMm, null);
  assert.deepEqual(record.allowedRotations, [0, 90, 180, 270]);
  assert.equal(record.demand, 0);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('create() round-trips given metadata through list()', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Sneaker heel patch',
    polygon: SQUARE,
    valuePerPiece: 3.5,
    productFamily: 'sneaker',
    allowedSpecies: ['cayman', 'crocodile'],
    thicknessMinMm: 1.0,
    thicknessMaxMm: 1.8,
    allowedRotations: [0, 180],
    demand: 24,
  });

  const listed = store.list().find((r) => r.id === record.id);
  assert.equal(listed.valuePerPiece, 3.5);
  assert.equal(listed.productFamily, 'sneaker');
  assert.deepEqual(listed.allowedSpecies, ['cayman', 'crocodile']);
  assert.equal(listed.thicknessMinMm, 1.0);
  assert.equal(listed.thicknessMaxMm, 1.8);
  assert.deepEqual(listed.allowedRotations, [0, 180]);
  assert.equal(listed.demand, 24);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('update() changes metadata, never geometry or identity', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({ name: 'Keeper', polygon: SQUARE, demand: 5 });

  const updated = store.update(record.id, {
    name: 'Belt keeper 35mm',
    valuePerPiece: 1.25,
    demand: 100,
    polygon: [{ x: 0, y: 0 }],
    id: 'hacked',
    createdAt: '1999-01-01T00:00:00.000Z',
  });

  assert.equal(updated.name, 'Belt keeper 35mm');
  assert.equal(updated.valuePerPiece, 1.25);
  assert.equal(updated.demand, 100);
  assert.deepEqual(updated.polygon, SQUARE);
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);

  const reread = store.list().find((r) => r.id === record.id);
  assert.equal(reread.valuePerPiece, 1.25);
  assert.deepEqual(reread.polygon, SQUARE);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('update() leaves omitted fields alone and returns null for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({ name: 'Keeper', polygon: SQUARE, demand: 5, valuePerPiece: 2 });

  const updated = store.update(record.id, { demand: 9 });
  assert.equal(updated.demand, 9);
  assert.equal(updated.valuePerPiece, 2);
  assert.equal(updated.name, 'Keeper');

  assert.equal(store.update('does-not-exist', { demand: 1 }), null);
  assert.equal(store.update('../../etc/passwd', { demand: 1 }), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dies-store.test.js`
Expected: FAIL — `record.allowedRotations` is `undefined` not `[0,90,180,270]`,
and `store.update` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/dies/store.js`, add a `readRecord` helper beside `recordPath` (the
skins and sessions stores both have this exact helper; the dies store
checks `SAFE_ID` only inside `remove()`, and `update()` needs the same
guard):

```js
  function readRecord(id) {
    if (!SAFE_ID.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
    } catch {
      return null;
    }
  }
```

Add above `createStore`'s body, at module level:

```js
// Only these are writable after creation. A component's polygon is its
// identity — a changed shape would invalidate any layout already computed
// against it — so a new shape means a new component.
const METADATA_FIELDS = [
  'name',
  'valuePerPiece',
  'productFamily',
  'allowedSpecies',
  'thicknessMinMm',
  'thicknessMaxMm',
  'allowedRotations',
  'demand',
];
```

Replace `create()` and add `update()`:

```js
  function create({
    name,
    polygon,
    valuePerPiece,
    productFamily,
    allowedSpecies,
    thicknessMinMm,
    thicknessMaxMm,
    allowedRotations,
    demand,
  }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      name,
      polygon,
      valuePerPiece: valuePerPiece ?? null,
      productFamily: productFamily ?? null,
      allowedSpecies: allowedSpecies ?? null,
      thicknessMinMm: thicknessMinMm ?? null,
      thicknessMaxMm: thicknessMaxMm ?? null,
      allowedRotations: allowedRotations ?? [0, 90, 180, 270],
      demand: demand ?? 0,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function update(id, fields) {
    const record = readRecord(id);
    if (!record) return null;
    for (const key of METADATA_FIELDS) {
      if (fields[key] !== undefined) record[key] = fields[key];
    }
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }
```

Change the module's return to:

```js
  return { list, create, update, remove };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dies-store.test.js`
Expected: PASS (all tests, including every pre-existing one).

- [ ] **Step 5: Commit**

```bash
git add src/dies/store.js test/dies-store.test.js
git commit -m "feat(components): add component metadata fields and update() to the dies store"
```

---

## Task 2: dimensions creation path and the update route

**Files:**
- Modify: `server.js` — `handleCreateDie`, a new `handleUpdateDie`, the
  routes object, and the route table
- Test: `test/dies-route.test.js`

**Interfaces:**
- Consumes: `store.create()` and `store.update()` from Task 1.
- Produces: `POST /dies` accepts `widthMm`/`heightMm` as a third creation
  mode plus the seven metadata fields on all three modes; `POST /dies/:id`
  updates metadata from a JSON body. Tasks 3 and 4 (`dies-app.js`) call
  both.

- [ ] **Step 1: Write the failing tests**

Add to `test/dies-route.test.js`, after the existing `postDiePhoto` helper:

```js
async function postDieDimensions(baseUrl, overrides = {}) {
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Belt keeper 35mm');
  const fields = { widthMm: 35, heightMm: 12, ...overrides.fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
}

function updateDie(baseUrl, id, body) {
  return fetch(`${baseUrl}/dies/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

Then the cases:

```js
test('POST /dies via dimensions creates a rectangle of the requested size', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDieDimensions(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();

    const xs = created.polygon.map((p) => p.x);
    const ys = created.polygon.map((p) => p.y);
    assert.equal(Math.max(...xs) - Math.min(...xs), 35);
    assert.equal(Math.max(...ys) - Math.min(...ys), 12);
    assert.equal(created.polygon.length, 4);
  });
});

test('POST /dies carries the component metadata through on every creation mode', async () => {
  await withServer(async (baseUrl) => {
    const metadata = {
      valuePerPiece: 1.25,
      productFamily: 'belt',
      allowedSpecies: 'Cayman, crocodile ',
      thicknessMinMm: 1.2,
      thicknessMaxMm: 2.4,
      allowedRotations: '0, 180',
      demand: 100,
    };

    const fromDimensions = await (await postDieDimensions(baseUrl, { fields: { widthMm: 35, heightMm: 12, ...metadata } })).json();
    assert.equal(fromDimensions.valuePerPiece, 1.25);
    assert.equal(fromDimensions.productFamily, 'belt');
    assert.deepEqual(fromDimensions.allowedSpecies, ['cayman', 'crocodile']);
    assert.equal(fromDimensions.thicknessMinMm, 1.2);
    assert.equal(fromDimensions.thicknessMaxMm, 2.4);
    assert.deepEqual(fromDimensions.allowedRotations, [0, 180]);
    assert.equal(fromDimensions.demand, 100);

    const svgFormData = new FormData();
    svgFormData.append('name', 'Tip accent');
    svgFormData.append('svg', new Blob([SVG_CONTENT]), 'die.svg');
    for (const [key, value] of Object.entries(metadata)) svgFormData.append(key, String(value));
    const fromSvg = await (await fetch(`${baseUrl}/dies`, { method: 'POST', body: svgFormData })).json();
    assert.equal(fromSvg.valuePerPiece, 1.25);
    assert.deepEqual(fromSvg.allowedSpecies, ['cayman', 'crocodile']);
  });
});

test('POST /dies defaults metadata when none is sent (existing callers unchanged)', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieSvg(baseUrl)).json();
    assert.equal(created.valuePerPiece, null);
    assert.equal(created.allowedSpecies, null);
    assert.deepEqual(created.allowedRotations, [0, 90, 180, 270]);
    assert.equal(created.demand, 0);
  });
});

test('POST /dies returns 400 for a non-positive dimension', async () => {
  await withServer(async (baseUrl) => {
    const zero = await postDieDimensions(baseUrl, { fields: { widthMm: 0, heightMm: 12 } });
    assert.equal(zero.status, 400);
    assert.match((await zero.json()).error, /widthMm/);

    const negative = await postDieDimensions(baseUrl, { fields: { widthMm: 35, heightMm: -4 } });
    assert.equal(negative.status, 400);

    const missing = await postDieDimensions(baseUrl, { fields: { widthMm: 35, heightMm: undefined } });
    assert.equal(missing.status, 400);
  });
});

test('POST /dies/:id updates metadata but not geometry', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();

    const response = await updateDie(baseUrl, created.id, {
      valuePerPiece: 2.5,
      demand: 40,
      polygon: [{ x: 0, y: 0 }],
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.valuePerPiece, 2.5);
    assert.equal(updated.demand, 40);
    assert.deepEqual(updated.polygon, created.polygon);

    const listed = (await (await fetch(`${baseUrl}/dies`)).json()).find((d) => d.id === created.id);
    assert.equal(listed.valuePerPiece, 2.5);
  });
});

test('POST /dies/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await updateDie(baseUrl, 'does-not-exist', { demand: 1 })).status, 404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dies-route.test.js`
Expected: FAIL — dimensions mode currently hits the "neither svg nor photo"
`400`, and `POST /dies/:id` falls through to `serveStatic`.

- [ ] **Step 3: Write the implementation**

In `server.js`, add three module-level helpers beside the other small
helpers (`sendJSON`, `parseForm`, `cleanupFiles`):

```js
function numberOrNull(raw) {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// Comma-separated is friendlier to type than JSON in a multipart form.
// An empty value means "any species", stored as null rather than [] so
// "unconstrained" stays distinguishable from "constrained to nothing".
function speciesOrNull(raw) {
  if (!raw) return null;
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

// undefined lets the store apply its own default rather than overwriting
// it with an empty list.
function rotationsOrUndefined(raw) {
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return list.length ? list : undefined;
}
```

In `handleCreateDie`, replace the guard block with one that admits the third
mode, and build the metadata once:

```js
    const getField = (name) => fields[name] && fields[name][0];
    const name = getField('name');
    const svgFile = files.svg && files.svg[0];
    const photoFile = files.photo && files.photo[0];
    const widthRaw = getField('widthMm');
    const heightRaw = getField('heightMm');
    const hasDimensions = widthRaw !== undefined || heightRaw !== undefined;

    if (!name || (!svgFile && !photoFile && !hasDimensions)) {
      cleanupFiles(files);
      sendJSON(res, 400, {
        error:
          'name and either an svg file, a photo with calibration, or widthMm and heightMm are required.',
      });
      return;
    }

    const metadata = {
      valuePerPiece: numberOrNull(getField('valuePerPiece')),
      productFamily: getField('productFamily') || null,
      allowedSpecies: speciesOrNull(getField('allowedSpecies')),
      thicknessMinMm: numberOrNull(getField('thicknessMinMm')),
      thicknessMaxMm: numberOrNull(getField('thicknessMaxMm')),
      allowedRotations: rotationsOrUndefined(getField('allowedRotations')),
      demand: numberOrNull(getField('demand')) ?? 0,
    };
```

Change the SVG branch's create call to `store.create({ name, polygon, ...metadata })`.

Insert the dimensions branch immediately after the SVG branch returns, before
the photo path's ROI check:

```js
    if (!photoFile) {
      const widthMm = Number(widthRaw);
      const heightMm = Number(heightRaw);
      if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(heightMm) || heightMm <= 0) {
        sendJSON(res, 400, { error: 'widthMm and heightMm must both be positive numbers.' });
        return;
      }
      const polygon = [
        { x: 0, y: 0 },
        { x: widthMm, y: 0 },
        { x: widthMm, y: heightMm },
        { x: 0, y: heightMm },
      ];
      sendJSON(res, 200, store.create({ name, polygon, ...metadata }));
      return;
    }
```

Change the photo branch's create call to `store.create({ name, polygon, ...metadata })`.

Add the update handler inside `createDiesRoutes`:

```js
  async function handleUpdateDie(req, res, id) {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }
    if (!payload || typeof payload !== 'object') {
      sendJSON(res, 400, { error: 'Could not parse request body.' });
      return;
    }

    // store.update() reads the record and writes it synchronously, after
    // this await — so there is no read-before-await window of the kind the
    // jobs status route had to close.
    const updated = store.update(id, payload);
    if (!updated) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }
    sendJSON(res, 200, updated);
  }
```

Add `handleUpdateDie` to the object `createDiesRoutes` returns.

Register the route in `createServer`, **after** the exact `POST /dies` and
`GET /dies` checks so it can't shadow them:

```js
    const dieUpdateMatch = req.method === 'POST' && req.url.match(/^\/dies\/([^/]+)$/);
    if (dieUpdateMatch) {
      dies.handleUpdateDie(req, res, dieUpdateMatch[1]);
      return;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dies-route.test.js`
Expected: PASS (all tests, including every pre-existing one — the existing
"neither svg nor photo" test asserts a `400` status; confirm whether it also
asserts the message text and, if so, that the extended message still
satisfies it).

Then the full suite, since `handleCreateDie` is shared:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js test/dies-route.test.js
git commit -m "feat(components): add dimensions creation mode, metadata passthrough, update route"
```

---

## Task 3: the Components page — read path

**Files:**
- Modify: `public/dies.html`
- Modify: `src/dies-app.js`

**Interfaces:**
- Consumes: `GET /dies` (records now carrying the Task 1 fields),
  `DELETE /dies/:id`, `boundingBox`/`polygonToSVGPoints` from
  `src/nesting/geometry.js`.
- Produces: the page structure Task 4 extends with its form and edit UI.

This task re-skins the page and rebuilds the list as a card grid with search
and family filters. **The existing add form keeps working exactly as it does
today** — it is restyled but not functionally changed; Task 4 owns that.

- [ ] **Step 1: Rewrite `public/dies.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>leather-nest — components</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/public/styles.css" />
    <style>
      .page { max-width: 1000px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
      .components-header {
        display: flex; flex-wrap: wrap; align-items: baseline;
        justify-content: space-between; gap: var(--space-3);
        margin-bottom: var(--space-4);
      }
      .components-toolbar {
        display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
        margin-bottom: var(--space-4);
      }
      .components-toolbar .input { max-width: 260px; }
      .family-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .family-tags .tag { cursor: pointer; border: 1px solid transparent; }
      .component-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-4);
      }
      .component-card .shape {
        display: flex; align-items: center; justify-content: center;
        height: 110px; background: var(--color-bg); border-radius: var(--radius-sm);
      }
      .component-card .card-title { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
      .component-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
      #add-panel[hidden] { display: none; }
      .form-grid { display: flex; flex-direction: column; gap: var(--space-3); }
    </style>
  </head>
  <body>
    <nav class="nav">
      <span class="nav-brand">leather-nest</span>
      <a href="/">Home</a>
      <a href="/public/hides.html">Hides</a>
      <a href="/public/jobs.html">Jobs</a>
    </nav>

    <main class="page">
      <div class="components-header">
        <div>
          <h1>Components</h1>
          <p class="text-muted" id="components-summary">Loading…</p>
        </div>
        <button type="button" class="btn btn-primary" id="open-add">Add a component</button>
      </div>

      <div class="components-toolbar">
        <input class="input" type="search" id="component-search" placeholder="Search by name or family…" />
        <div class="family-tags" id="family-tags"></div>
      </div>

      <section class="card elev-sm" id="add-panel" hidden>
        <h2 class="card-title">Add a component</h2>
        <div class="form-grid">
          <div class="field">
            <label for="name-input">Name</label>
            <input class="input" type="text" id="name-input" />
          </div>
          <div>
            <label class="radio"><input type="radio" name="add-mode" value="svg" checked /><span class="dot"></span> Upload SVG</label>
            <label class="radio"><input type="radio" name="add-mode" value="photo" /><span class="dot"></span> Photograph a die</label>
          </div>

          <div id="svg-mode">
            <input class="input" type="file" id="svg-input" accept=".svg,image/svg+xml" />
          </div>

          <div id="photo-mode" style="display: none">
            <input class="input" type="file" id="photo-input" accept="image/*" />
            <div id="calibration-container"></div>
            <div id="region-container"></div>
          </div>

          <div id="add-status" class="text-muted"></div>
          <div class="component-actions">
            <button type="button" class="btn btn-primary" id="submit-die">Add to library</button>
            <button type="button" class="btn btn-secondary" id="cancel-add">Cancel</button>
          </div>
        </div>
      </section>

      <div class="component-grid" id="component-grid"></div>
    </main>

    <script type="module" src="/src/dies-app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Rewrite the read path in `src/dies-app.js`**

Keep the file's existing imports, mode-radio wiring, photo-input handler, and
submit handler exactly as they are — only the element lookups for the renamed
containers, and the list rendering, change. Replace `loadDies()` and the
list-click handler with:

```js
const summaryEl = document.getElementById('components-summary');
const gridEl = document.getElementById('component-grid');
const searchInput = document.getElementById('component-search');
const familyTagsEl = document.getElementById('family-tags');
const addPanel = document.getElementById('add-panel');

let components = [];
let selectedFamily = null;

function familyOf(component) {
  return (component.productFamily || '').trim().toLowerCase();
}

function sizeLabel(component) {
  const b = boundingBox(component.polygon);
  return `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)} mm`;
}

function shapeSVG(component) {
  const bounds = boundingBox(component.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width <= 0 || height <= 0) return '';
  return `
    <svg width="80" height="${Math.max(1, (80 * height) / width)}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
      <polygon points="${polygonToSVGPoints(component.polygon)}" stroke="var(--color-accent)" stroke-width="${width / 80}" fill="none" />
    </svg>`;
}

function matchesFilters(component, query, family) {
  if (family && familyOf(component) !== family) return false;
  if (!query) return true;
  return `${component.name} ${component.productFamily || ''} ${component.id}`.toLowerCase().includes(query);
}

function renderFamilyTags() {
  const families = [...new Set(components.map(familyOf).filter(Boolean))].sort();
  familyTagsEl.innerHTML = families
    .map(
      (f) =>
        `<button type="button" class="tag ${f === selectedFamily ? 'tag-accent' : 'tag-neutral'}" aria-pressed="${f === selectedFamily}" data-family="${escapeHtml(f)}">${escapeHtml(f)}</button>`
    )
    .join('');
}

function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = components.filter((c) => matchesFilters(c, query, selectedFamily));

  summaryEl.textContent = `${visible.length} component${visible.length === 1 ? '' : 's'}`;

  gridEl.innerHTML = visible
    .map(
      (component) => `
    <div class="card component-card elev-sm">
      <div class="shape">${shapeSVG(component)}</div>
      <div class="card-title">
        <span>${escapeHtml(component.name)}</span>
        ${component.productFamily ? `<span class="tag tag-neutral">${escapeHtml(component.productFamily)}</span>` : ''}
      </div>
      <p class="card-body">
        ${sizeLabel(component)}${component.valuePerPiece != null ? ` · $${component.valuePerPiece.toFixed(2)} each` : ''}
      </p>
      <div class="card-meta">${component.demand ? `demand ${component.demand}` : 'no current demand'}</div>
      <div class="component-actions">
        <button type="button" class="btn btn-secondary" data-delete-id="${component.id}">Delete</button>
      </div>
    </div>
  `
    )
    .join('');
}

async function loadDies() {
  const response = await fetch('/dies');
  components = await response.json();
  renderFamilyTags();
  renderGrid();
}

familyTagsEl.addEventListener('click', (event) => {
  const family = event.target.dataset.family;
  if (!family) return;
  selectedFamily = selectedFamily === family ? null : family;
  renderFamilyTags();
  renderGrid();
});

searchInput.addEventListener('input', renderGrid);

gridEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteId;
  if (!id) return;
  await fetch(`/dies/${id}`, { method: 'DELETE' });
  loadDies();
});

document.getElementById('open-add').addEventListener('click', () => {
  addPanel.hidden = false;
});
document.getElementById('cancel-add').addEventListener('click', () => {
  addPanel.hidden = true;
});
```

Update the file's geometry import to `import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';`
and delete the now-unused `diesListEl` lookup and the old `refresh-dies`
listener (that button no longer exists in the markup).

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS — no test covers these files, so this confirms nothing else regressed.

Syntax-check: `node --input-type=module -e "$(cat src/dies-app.js)"` — a
`ReferenceError: document is not defined` is EXPECTED and means the syntax is
fine; you are looking for the absence of a `SyntaxError`.

Then `npm start` (if port 8080 reports `EADDRINUSE`, a server is already up —
use it) and open `http://localhost:8080/public/dies.html`:
1. Existing components render as cards with their shape, size, and name.
2. Search filters as you type.
3. A family tag filters to that family; clicking it again clears.
4. Delete removes a card.
5. "Add a component" opens the panel, and the SVG and photo paths still create components exactly as before.

- [ ] **Step 4: Commit**

```bash
git add public/dies.html src/dies-app.js
git commit -m "feat(components): re-skin the dies page as the Components library"
```

---

## Task 4: the Components page — create and edit

**Files:**
- Modify: `public/dies.html`
- Modify: `src/dies-app.js`

**Interfaces:**
- Consumes: `POST /dies` with `widthMm`/`heightMm` and the metadata fields,
  and `POST /dies/:id`, both from Task 2; the page structure from Task 3.
- Produces: nothing consumed elsewhere — this completes the page.

- [ ] **Step 1: Add the dimensions mode and metadata fields to the form**

In `public/dies.html`, add a third radio beside the existing two:

```html
            <label class="radio"><input type="radio" name="add-mode" value="dimensions" /><span class="dot"></span> Enter dimensions</label>
```

Add the dimensions block after `#photo-mode`:

```html
          <div id="dimensions-mode" style="display: none">
            <div class="field">
              <label for="width-input">Width (mm)</label>
              <input class="input" type="number" step="0.1" min="0" id="width-input" />
            </div>
            <div class="field">
              <label for="height-input">Height (mm)</label>
              <input class="input" type="number" step="0.1" min="0" id="height-input" />
            </div>
          </div>
```

And the metadata fields, before `#add-status`:

```html
          <div class="field">
            <label for="family-input">Product family</label>
            <input class="input" type="text" id="family-input" placeholder="belt, sneaker, small-goods…" />
          </div>
          <div class="field">
            <label for="value-input">Value per piece ($)</label>
            <input class="input" type="number" step="0.01" min="0" id="value-input" />
          </div>
          <div class="field">
            <label for="demand-input">Current demand</label>
            <input class="input" type="number" step="1" min="0" id="demand-input" />
          </div>
          <div class="field">
            <label for="species-input">Allowed species (comma-separated, blank = any)</label>
            <input class="input" type="text" id="species-input" placeholder="cayman, crocodile" />
          </div>
          <div class="field">
            <label for="thickness-min-input">Thickness min (mm)</label>
            <input class="input" type="number" step="0.1" min="0" id="thickness-min-input" />
          </div>
          <div class="field">
            <label for="thickness-max-input">Thickness max (mm)</label>
            <input class="input" type="number" step="0.1" min="0" id="thickness-max-input" />
          </div>
          <div class="field">
            <label for="rotations-input">Allowed rotations (comma-separated degrees, blank = all)</label>
            <input class="input" type="text" id="rotations-input" placeholder="0, 90, 180, 270" />
          </div>
```

Add an edit dialog before the closing `</main>`:

```html
      <div class="dialog-backdrop" id="edit-dialog" hidden>
        <div class="dialog">
          <h3 class="dialog-title">Edit component</h3>
          <div class="dialog-body">
            <div class="form-grid">
              <div class="field">
                <label for="edit-name">Name</label>
                <input class="input" type="text" id="edit-name" />
              </div>
              <div class="field">
                <label for="edit-family">Product family</label>
                <input class="input" type="text" id="edit-family" />
              </div>
              <div class="field">
                <label for="edit-value">Value per piece ($)</label>
                <input class="input" type="number" step="0.01" min="0" id="edit-value" />
              </div>
              <div class="field">
                <label for="edit-demand">Current demand</label>
                <input class="input" type="number" step="1" min="0" id="edit-demand" />
              </div>
              <div id="edit-status" class="text-muted"></div>
            </div>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" id="cancel-edit">Cancel</button>
            <button type="button" class="btn btn-primary" id="save-edit">Save</button>
          </div>
        </div>
      </div>
```

Add to the page's `<style>` block: `#edit-dialog[hidden] { display: none; }`

- [ ] **Step 2: Wire the form and edit in `src/dies-app.js`**

Extend the mode-radio handler so all three blocks toggle:

```js
for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    svgMode.style.display = radio.value === 'svg' ? 'block' : 'none';
    photoMode.style.display = radio.value === 'photo' ? 'block' : 'none';
    dimensionsMode.style.display = radio.value === 'dimensions' ? 'block' : 'none';
  });
}
```

with `const dimensionsMode = document.getElementById('dimensions-mode');` beside the other lookups.

In the submit handler, append the metadata on every mode (after `formData.append('name', name)`):

```js
  const metadata = {
    productFamily: document.getElementById('family-input').value.trim(),
    valuePerPiece: document.getElementById('value-input').value,
    demand: document.getElementById('demand-input').value,
    allowedSpecies: document.getElementById('species-input').value.trim(),
    thicknessMinMm: document.getElementById('thickness-min-input').value,
    thicknessMaxMm: document.getElementById('thickness-max-input').value,
    allowedRotations: document.getElementById('rotations-input').value.trim(),
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== '') formData.append(key, value);
  }
```

and add the third mode branch beside the existing `svg`/`photo` ones:

```js
  } else if (mode === 'dimensions') {
    const widthMm = document.getElementById('width-input').value;
    const heightMm = document.getElementById('height-input').value;
    if (!widthMm || !heightMm) {
      addStatus.textContent = 'Enter both a width and a height.';
      return;
    }
    formData.append('widthMm', widthMm);
    formData.append('heightMm', heightMm);
  }
```

Add an Edit button to the card markup in `renderGrid`, beside Delete:

```js
        <button type="button" class="btn btn-secondary" data-edit-id="${component.id}">Edit</button>
```

And the edit wiring:

```js
const editDialog = document.getElementById('edit-dialog');
const editStatus = document.getElementById('edit-status');
let editingId = null;

function openEdit(component) {
  editingId = component.id;
  document.getElementById('edit-name').value = component.name;
  document.getElementById('edit-family').value = component.productFamily || '';
  document.getElementById('edit-value').value = component.valuePerPiece ?? '';
  document.getElementById('edit-demand').value = component.demand ?? 0;
  editStatus.textContent = '';
  editDialog.hidden = false;
}

document.getElementById('cancel-edit').addEventListener('click', () => {
  editDialog.hidden = true;
  editingId = null;
});

document.getElementById('save-edit').addEventListener('click', async () => {
  if (!editingId) return;
  const value = document.getElementById('edit-value').value;
  const demand = document.getElementById('edit-demand').value;
  editStatus.textContent = 'Saving…';
  try {
    const response = await fetch(`/dies/${editingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('edit-name').value.trim(),
        productFamily: document.getElementById('edit-family').value.trim() || null,
        valuePerPiece: value === '' ? null : Number(value),
        demand: demand === '' ? 0 : Number(demand),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      editStatus.textContent = `Error: ${body.error}`;
      return;
    }
    editDialog.hidden = true;
    editingId = null;
    await loadDies();
  } catch {
    editStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});
```

Extend the grid click handler to route Edit as well as Delete:

```js
gridEl.addEventListener('click', async (event) => {
  const editId = event.target.dataset.editId;
  if (editId) {
    const component = components.find((c) => c.id === editId);
    if (component) openEdit(component);
    return;
  }
  const deleteId = event.target.dataset.deleteId;
  if (!deleteId) return;
  await fetch(`/dies/${deleteId}`, { method: 'DELETE' });
  loadDies();
});
```

Finally, extend the submit handler's success-path cleanup to clear the new
inputs along with the existing ones.

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS

Syntax-check `src/dies-app.js` as in Task 3 (a `ReferenceError` about
`document` is expected; a `SyntaxError` is not).

Then `npm start` and at `http://localhost:8080/public/dies.html`:
1. Choose "Enter dimensions", enter `35 × 12`, name it "Belt keeper 35mm", add a family and a value, submit — a card appears showing `35 × 12 mm` and the value.
2. The SVG and photo modes still work, and now also carry the metadata.
3. Edit a component's value and demand; confirm the card updates and the shape is unchanged.
4. Reload the page and confirm the edit persisted.
5. Search and the family tags still filter correctly with the new records.

- [ ] **Step 4: Commit**

```bash
git add public/dies.html src/dies-app.js
git commit -m "feat(components): add dimensions creation mode and metadata editing to the UI"
```

---

## Self-Review Notes

- **Spec coverage:** store fields + `update()` (Task 1), dimensions mode +
  metadata passthrough + update route (Task 2), the Organic re-skin with
  card grid, search, and family filters (Task 3), the dimensions form,
  metadata fields, and edit UI (Task 4). Every spec Goal maps to a task.
  The spec's Non-goals — matching, ranking, value computation, utilization,
  visual nesting, irregular containment, reverse search, geometry editing,
  and the six deferred fields — are untouched by every task.
- **Type consistency:** the seven field names are spelled identically in
  Task 1's store, Task 2's route parsing and tests, and Tasks 3-4's UI.
  `update(id, fields)` and `create({...})` are called in Task 2 exactly as
  Task 1 defines them. `boundingBox`/`polygonToSVGPoints` match their real
  exports in `src/nesting/geometry.js`, verified against `dies-app.js`'s
  existing usage.
- **Backward compatibility:** Task 2's `?? null` / `?? 0` / `undefined`
  handling preserves the existing SVG and photo behavior for callers that
  send no metadata, covered by an explicit regression test. Task 3 keeps
  the existing add form functional so the app stays usable between tasks.
