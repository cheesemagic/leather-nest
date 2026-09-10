# Hide Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a card-grid "Hide library" page backed by an extended skins
store that can hold a cuttable outline (not just a scale signature), so a
hide created from a photo alone has somewhere real to live.

**Architecture:** Extend `src/skins/store.js`'s `create()` with optional
`outlinePolygon`/`thicknessMm` fields and a `remainingAreaPct: 100` default.
Give `POST /skins` a second creation mode via an explicit `captureType` form
field (`"signature"`, today's only value and the default; `"outline"`, new
— runs `scripts/digitize.py`, the same contour pipeline the die library
already uses). Fix `rankMatches()` to skip any skin with no signature, since
making the signature optional means one can now legitimately not have one.
Build `public/hides.html` + `src/hides-app.js` as a new page reusing the
existing photo→calibrate→select-region chain (`calibration-ui.js` +
`region-select-ui.js`, identical wiring to `dies-app.js`'s photo-add path)
and the project's existing design-system CSS classes (`.card`, `.tag`,
`.washed`, `.nav`, `.btn`, `.input`).

**Tech Stack:** Node.js (`node --test`), vanilla browser JS (ES modules, no
framework), `formidable` for multipart parsing, Python/OpenCV via
`scripts/digitize.py` (unchanged, reused as-is).

**Spec:** `docs/superpowers/specs/2026-09-01-hide-library-design.md`

## Global Constraints

- Routes stay `/skins`; the store stays `src/skins/`; the data directory
  stays `data/skins/`. Only the new page's title/copy say "Hides" — no
  internal identifier changes.
- `captureType` absent on `POST /skins` must behave byte-for-byte like
  today (default `"signature"`) — `match-skins-app.js`'s existing FormData
  never sends this field and must keep working unchanged.
- No change to `match-skins.html`/`match-skins-app.js` beyond the
  `similarity.js` fix.
- No defects/scar regions, no click-through wiring to the nest workspace,
  no computing remaining area from job history, no "attach the other kind
  of data to an existing record" UI — all out of scope per the spec's
  Non-goals.
- `public/hides.html`/`src/hides-app.js` get no automated test — browser
  UI, same established precedent as `dies.html`/`dies-app.js`,
  `match-skins.html`/`match-skins-app.js` (none of which have test files).

---

## Task 1: `src/skins/store.js` — optional outline/thickness fields

**Files:**
- Modify: `src/skins/store.js:34-49` (the `create()` function)
- Test: `test/skins-store.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `create({ label, species, dominantWavelengthMm, radialSpectrum,
  outlinePolygon, thicknessMm, photoPath, photoExt })` — all params except
  `label`/`species`/`photoPath`/`photoExt` optional. Every record gets
  `remainingAreaPct: 100`. Omitted optional fields are stored as `null`
  (not a missing key). Task 3 (`server.js`) calls this with the new fields;
  Task 4 (`hides-app.js`) reads `outlinePolygon`/`thicknessMm`/
  `remainingAreaPct` off records returned by `GET /skins`.

- [ ] **Step 1: Write the failing test**

Add to `test/skins-store.test.js` (after the existing `create()` test):

```js
test('create() accepts outline/thickness fields, defaults remainingAreaPct, and round-trips omitted fields as null', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const outlineOnly = store.create({
    label: 'Cayman #2',
    species: 'cayman',
    outlinePolygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    thicknessMm: 1.2,
    photoPath,
    photoExt: '.jpg',
  });

  assert.deepEqual(outlineOnly.outlinePolygon, [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ]);
  assert.equal(outlineOnly.thicknessMm, 1.2);
  assert.equal(outlineOnly.remainingAreaPct, 100);
  assert.equal(outlineOnly.dominantWavelengthMm, null);
  assert.equal(outlineOnly.radialSpectrum, null);

  const signatureOnly = store.create({
    label: 'Cayman #3',
    species: 'cayman',
    dominantWavelengthMm: 4.2,
    radialSpectrum: [0.1, 0.5],
    photoPath,
    photoExt: '.jpg',
  });

  assert.equal(signatureOnly.remainingAreaPct, 100);
  assert.equal(signatureOnly.outlinePolygon, null);
  assert.equal(signatureOnly.thicknessMm, null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skins-store.test.js`
Expected: FAIL — `outlineOnly.remainingAreaPct` is `undefined`, not `100`
(and `outlinePolygon`/`thicknessMm` are `undefined`, not round-tripping).

- [ ] **Step 3: Write minimal implementation**

Replace `create()` in `src/skins/store.js`:

```js
function create({
  label,
  species,
  dominantWavelengthMm,
  radialSpectrum,
  outlinePolygon,
  thicknessMm,
  photoPath,
  photoExt,
}) {
  ensureDir();
  const id = crypto.randomUUID();
  const record = {
    id,
    label,
    species,
    dominantWavelengthMm: dominantWavelengthMm ?? null,
    radialSpectrum: radialSpectrum ?? null,
    outlinePolygon: outlinePolygon ?? null,
    thicknessMm: thicknessMm ?? null,
    remainingAreaPct: 100,
    photoExt,
    createdAt: new Date().toISOString(),
  };
  fs.copyFileSync(photoPath, path.join(dataDir, `${id}${photoExt}`));
  fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
  return record;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skins-store.test.js`
Expected: PASS (all tests in the file, including the two pre-existing
ones — `deepEqual(listed[0], record)` still holds since both sides come
from the same `create()` call).

- [ ] **Step 5: Commit**

```bash
git add src/skins/store.js test/skins-store.test.js
git commit -m "feat(skins-store): make signature optional, add outline/thickness fields"
```

---

## Task 2: `src/skins/similarity.js` — skip signature-less skins

**Files:**
- Modify: `src/skins/similarity.js:25-32` (top of `rankMatches()`)
- Test: `test/similarity.test.js`

**Interfaces:**
- Consumes: skin records shaped like Task 1's `create()` output (in
  particular, `dominantWavelengthMm` may now be `null`).
- Produces: `rankMatches(skins)` unchanged in return shape; now silently
  excludes any skin with `dominantWavelengthMm == null` before grouping.

- [ ] **Step 1: Write the failing test**

Add to `test/similarity.test.js`:

```js
test('rankMatches skips signature-less skins entirely, producing no NaN', () => {
  const skins = [
    { id: 'a1', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0] },
    { id: 'a2', species: 'cayman', dominantWavelengthMm: null, radialSpectrum: null },
    { id: 'a3', species: 'cayman', dominantWavelengthMm: 4.5, radialSpectrum: [1, 0, 0] },
  ];

  const groups = rankMatches(skins);
  const caymanGroup = groups.find((g) => g.species === 'cayman');

  assert.equal(caymanGroup.pairs.length, 1);
  assert.equal(caymanGroup.pairs[0].skinAId, 'a1');
  assert.equal(caymanGroup.pairs[0].skinBId, 'a3');
  for (const pair of caymanGroup.pairs) {
    assert.ok(!Number.isNaN(pair.scaleDifferenceMm));
    assert.ok(!Number.isNaN(pair.spectrumCorrelation));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/similarity.test.js`
Expected: FAIL — `caymanGroup.pairs.length` is `3` (all pairs including
the signature-less skin), not `1`.

- [ ] **Step 3: Write minimal implementation**

In `src/skins/similarity.js`, change the start of `rankMatches`:

```js
export function rankMatches(skins) {
  skins = skins.filter((s) => s.dominantWavelengthMm != null);

  const groups = new Map();
  for (const skin of skins) {
    const key = skin.species.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(skin);
  }
  // ...unchanged below
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/similarity.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/skins/similarity.js test/similarity.test.js
git commit -m "fix(similarity): exclude signature-less skins from rankMatches"
```

---

## Task 3: `server.js` — `POST /skins` gains `captureType: "outline"`

**Files:**
- Modify: `server.js:115-175` (`handleCreateSkin`)
- Test: `test/skins-route.test.js`

**Interfaces:**
- Consumes: `store.create()` from Task 1 (new optional fields), the
  already-existing `DIGITIZE_SCRIPT` constant (`server.js:16`) and
  `digitize.py`'s CLI contract (`<photo> <p1x> <p1y> <p2x> <p2y>
  <realDistanceMm> [<roiX> <roiY> <roiWidth> <roiHeight>]`, stdout
  `{ "polygon": [...] }`, non-zero exit + stderr message on failure).
- Produces: `POST /skins` accepts a `captureType` field (`"signature"` |
  `"outline"`, default `"signature"`). Task 4's add-a-hide form sends
  `captureType: "outline"`.

- [ ] **Step 1: Write the failing tests**

Add to `test/skins-route.test.js`. First add a second fixture-posting
helper near `postSkin` (same file, after its definition):

```js
async function postOutlineSkin(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-rectangle.png'));
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'hide.png');
  const fields = {
    captureType: 'outline',
    label: 'Test Hide',
    species: 'cayman',
    thicknessMm: 1.4,
    p1x: 0,
    p1y: 0,
    p2x: 200,
    p2y: 0,
    realDistanceMm: 100,
    roiX: 0,
    roiY: 0,
    roiWidth: 400,
    roiHeight: 300,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
}
```

Then add the test cases:

```js
test('POST /skins with captureType=outline creates a hide with outline/thickness and no signature fields', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
    assert.equal(created.remainingAreaPct, 100);
    assert.equal(created.dominantWavelengthMm, null);
  });
});

test('POST /skins with captureType omitted still creates a signature hide (default unchanged)', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    assert.ok(created.dominantWavelengthMm > 0);
    assert.equal(created.outlinePolygon, null);
    assert.equal(created.remainingAreaPct, 100);
  });
});

test('POST /skins with captureType=outline returns 400 when thicknessMm is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, { thicknessMm: undefined });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /thicknessMm/);
  });
});

test('POST /skins returns 400 for an unknown captureType', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, { captureType: 'bogus' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /captureType/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skins-route.test.js`
Expected: FAIL — `captureType` is ignored today, so the outline-mode
requests run the signature path instead (missing `outlinePolygon`,
wrong/absent `thicknessMm`, no 400 for a bad `captureType`).

- [ ] **Step 3: Write minimal implementation**

Replace `handleCreateSkin` in `server.js` (inside `createSkinsRoutes`):

```js
  async function handleCreateSkin(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const photo = files.photo && files.photo[0];
    if (!photo) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'No photo uploaded.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const label = getField('label');
    const species = getField('species');
    if (!label || !species) {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: 'label and species are required.' });
      return;
    }

    const captureType = getField('captureType') || 'signature';
    const photoExt = path.extname(photo.originalFilename || '') || '.jpg';

    if (captureType === 'outline') {
      const thicknessMmRaw = getField('thicknessMm');
      if (!thicknessMmRaw) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 400, { error: 'thicknessMm is required.' });
        return;
      }

      const roiFields = ['roiX', 'roiY', 'roiWidth', 'roiHeight'];
      const hasROI = roiFields.every((field) => getField(field));
      const args = [
        DIGITIZE_SCRIPT,
        photo.filepath,
        getField('p1x'),
        getField('p1y'),
        getField('p2x'),
        getField('p2y'),
        getField('realDistanceMm'),
        ...(hasROI ? roiFields.map(getField) : []),
      ];

      execFile(PYTHON, args, (err, stdout, stderr) => {
        fs.unlink(photo.filepath, () => {});
        if (err) {
          sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
          return;
        }
        const { polygon } = JSON.parse(stdout);
        const record = store.create({
          label,
          species,
          thicknessMm: Number(thicknessMmRaw),
          outlinePolygon: polygon,
          photoPath: photo.filepath,
          photoExt,
        });
        sendJSON(res, 200, record);
      });
      return;
    }

    if (captureType !== 'signature') {
      fs.unlink(photo.filepath, () => {});
      sendJSON(res, 400, { error: 'captureType must be "signature" or "outline".' });
      return;
    }

    const args = [
      SKIN_SIGNATURE_SCRIPT,
      photo.filepath,
      getField('roiX'),
      getField('roiY'),
      getField('roiWidth'),
      getField('roiHeight'),
      getField('p1x'),
      getField('p1y'),
      getField('p2x'),
      getField('p2y'),
      getField('realDistanceMm'),
    ];

    execFile(PYTHON, args, (err, stdout, stderr) => {
      if (err) {
        fs.unlink(photo.filepath, () => {});
        sendJSON(res, 422, { error: stderr.trim() || 'Signature computation failed.' });
        return;
      }

      const { dominantWavelengthMm, radialSpectrum } = JSON.parse(stdout);
      const record = store.create({
        label,
        species,
        dominantWavelengthMm,
        radialSpectrum,
        photoPath: photo.filepath,
        photoExt,
      });
      fs.unlink(photo.filepath, () => {});

      sendJSON(res, 200, record);
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skins-route.test.js`
Expected: PASS (all tests in the file, including every pre-existing one —
the signature branch's request/response shape is unchanged).

Then run the full suite to catch any cross-file regression:

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js test/skins-route.test.js
git commit -m "feat(server): add captureType=outline mode to POST /skins"
```

---

## Task 4: `public/hides.html` + `src/hides-app.js` — the library page

**Files:**
- Create: `public/hides.html`
- Create: `src/hides-app.js`

**Interfaces:**
- Consumes: `GET /skins` (Task 1/3 record shape: `id`, `label`, `species`,
  `outlinePolygon` or `null`, `thicknessMm` or `null`, `remainingAreaPct`,
  `createdAt`, `photoExt`), `GET /skins/:id/photo`, `POST /skins` with
  `captureType: "outline"` (Task 3), `attachCalibration(container, imgSrc,
  onComplete)` and `attachRegionSelect(container, imgSrc, onComplete)`
  from `src/calibration-ui.js`/`src/region-select-ui.js` (both already
  used identically by `src/dies-app.js`), `boundingBox(polygon)` from
  `src/nesting/geometry.js` (returns `{ minX, minY, maxX, maxY }`).
- Produces: nothing consumed elsewhere — this is a leaf page, same as
  `dies.html`/`match-skins.html`.

- [ ] **Step 1: Create `public/hides.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>leather-nest — hide library</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600;700&display=swap" />
    <link rel="stylesheet" href="/public/styles.css" />
    <style>
      .page { max-width: 1000px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
      .hides-header {
        display: flex; flex-wrap: wrap; align-items: baseline;
        justify-content: space-between; gap: var(--space-3);
        margin-bottom: var(--space-4);
      }
      .hides-toolbar {
        display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
        margin-bottom: var(--space-4);
      }
      .hides-toolbar .input { max-width: 260px; }
      .species-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .species-tags .tag { cursor: pointer; border: 1px solid transparent; }
      .species-tags .tag[aria-pressed='true'] { border-color: var(--color-accent); }
      .hide-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-4);
      }
      .hide-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-sm); }
      .area-bar {
        height: 6px; border-radius: 999px; background: var(--color-neutral-300);
        overflow: hidden;
      }
      .area-bar-fill { height: 100%; background: var(--color-accent-2); }
      .hide-card .card-title { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
      #add-hide-dialog[hidden] { display: none; }
      .form-grid { display: flex; flex-direction: column; gap: var(--space-3); }
    </style>
  </head>
  <body>
    <nav class="nav">
      <span class="nav-brand">leather-nest</span>
      <a href="/">Home</a>
    </nav>

    <main class="page">
      <div class="hides-header">
        <div>
          <h1>Hides</h1>
          <p class="text-muted" id="hides-summary">Loading…</p>
        </div>
        <button type="button" class="btn btn-primary" id="open-add-hide">Add a hide</button>
      </div>

      <div class="hides-toolbar">
        <input class="input" type="search" id="hide-search" placeholder="Search by label or species…" />
        <div class="species-tags" id="species-tags"></div>
      </div>

      <div class="hide-grid" id="hide-grid"></div>
    </main>

    <div class="dialog-backdrop" id="add-hide-dialog" hidden>
      <div class="dialog">
        <h3 class="dialog-title">Add a hide</h3>
        <div class="dialog-body">
          <div class="form-grid">
            <div class="field">
              <label for="hide-label">Name</label>
              <input class="input" type="text" id="hide-label" />
            </div>
            <div class="field">
              <label for="hide-species">Species</label>
              <input class="input" type="text" id="hide-species" />
            </div>
            <div class="field">
              <label for="hide-thickness">Thickness (mm)</label>
              <input class="input" type="number" step="0.1" min="0" id="hide-thickness" />
            </div>
            <div class="field">
              <label for="hide-photo">Photo</label>
              <input class="input" type="file" accept="image/*" id="hide-photo" />
            </div>
            <div id="hide-calibration-container"></div>
            <div id="hide-region-container"></div>
            <div id="add-hide-status" class="text-muted"></div>
          </div>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" id="cancel-add-hide">Cancel</button>
          <button type="button" class="btn btn-primary" id="submit-hide">Add to library</button>
        </div>
      </div>
    </div>

    <script type="module" src="/src/hides-app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/hides-app.js`**

```js
import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';
import { boundingBox } from './nesting/geometry.js';

const summaryEl = document.getElementById('hides-summary');
const gridEl = document.getElementById('hide-grid');
const searchInput = document.getElementById('hide-search');
const speciesTagsEl = document.getElementById('species-tags');

const openAddButton = document.getElementById('open-add-hide');
const cancelAddButton = document.getElementById('cancel-add-hide');
const submitButton = document.getElementById('submit-hide');
const dialog = document.getElementById('add-hide-dialog');
const labelInput = document.getElementById('hide-label');
const speciesInput = document.getElementById('hide-species');
const thicknessInput = document.getElementById('hide-thickness');
const photoInput = document.getElementById('hide-photo');
const calibrationContainer = document.getElementById('hide-calibration-container');
const regionContainer = document.getElementById('hide-region-container');
const addStatus = document.getElementById('add-hide-status');

let hides = [];
let selectedSpecies = null;
let selectedPhoto = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hideSizeLabel(hide) {
  if (!hide.outlinePolygon) return '—';
  const b = boundingBox(hide.outlinePolygon);
  const width = Math.round(b.maxX - b.minX);
  const height = Math.round(b.maxY - b.minY);
  return `${width} × ${height} mm`;
}

function hideFootprintAreaMm2(hide) {
  if (!hide.outlinePolygon) return 0;
  const b = boundingBox(hide.outlinePolygon);
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}

function resetAddForm() {
  labelInput.value = '';
  speciesInput.value = '';
  thicknessInput.value = '';
  photoInput.value = '';
  calibrationContainer.innerHTML = '';
  regionContainer.innerHTML = '';
  addStatus.textContent = '';
  selectedPhoto = null;
  calibration = null;
  region = null;
}

openAddButton.addEventListener('click', () => {
  dialog.hidden = false;
});

cancelAddButton.addEventListener('click', () => {
  dialog.hidden = true;
  resetAddForm();
});

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedPhoto = file;
  calibration = null;
  region = null;
  regionContainer.innerHTML = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (calibrationResult) => {
    calibration = calibrationResult;
    attachRegionSelect(regionContainer, objectUrl, (regionResult) => {
      region = regionResult;
    });
  });
});

submitButton.addEventListener('click', async () => {
  const label = labelInput.value.trim();
  const species = speciesInput.value.trim();
  const thicknessMm = thicknessInput.value;

  if (!label || !species || !thicknessMm) {
    addStatus.textContent = 'Name, species, and thickness are required.';
    return;
  }
  if (!selectedPhoto || !calibration) {
    addStatus.textContent = 'Upload a photo and complete calibration first.';
    return;
  }

  const formData = new FormData();
  formData.append('captureType', 'outline');
  formData.append('label', label);
  formData.append('species', species);
  formData.append('thicknessMm', thicknessMm);
  formData.append('photo', selectedPhoto);
  formData.append('p1x', calibration.p1x);
  formData.append('p1y', calibration.p1y);
  formData.append('p2x', calibration.p2x);
  formData.append('p2y', calibration.p2y);
  formData.append('realDistanceMm', calibration.realDistanceMm);
  if (region) {
    formData.append('roiX', region.roiX);
    formData.append('roiY', region.roiY);
    formData.append('roiWidth', region.roiWidth);
    formData.append('roiHeight', region.roiHeight);
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/skins', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    dialog.hidden = true;
    resetAddForm();
    await loadHides();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

function matchesFilters(hide, query, species) {
  if (species && hide.species.trim().toLowerCase() !== species) return false;
  if (!query) return true;
  const haystack = `${hide.label} ${hide.species} ${hide.id}`.toLowerCase();
  return haystack.includes(query);
}

function renderSpeciesTags() {
  const species = [...new Set(hides.map((h) => h.species.trim().toLowerCase()))].sort();
  speciesTagsEl.innerHTML = species
    .map(
      (s) =>
        `<button type="button" class="tag ${s === selectedSpecies ? 'tag-accent' : 'tag-neutral'}" aria-pressed="${s === selectedSpecies}" data-species="${escapeHtml(s)}">${escapeHtml(s)}</button>`,
    )
    .join('');
}

function renderSummary(visible) {
  const totalAreaMm2 = visible.reduce((sum, h) => sum + hideFootprintAreaMm2(h) * (h.remainingAreaPct / 100), 0);
  const totalAreaCm2 = Math.round(totalAreaMm2 / 100);
  summaryEl.textContent = `${visible.length} hide${visible.length === 1 ? '' : 's'} · ${totalAreaCm2} cm² usable`;
}

function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = hides.filter((h) => matchesFilters(h, query, selectedSpecies));

  renderSummary(visible);

  gridEl.innerHTML = visible
    .map((hide) => {
      const remaining = hide.remainingAreaPct ?? 100;
      const date = new Date(hide.createdAt).toLocaleDateString();
      return `
    <div class="card hide-card elev-sm">
      <img class="washed" src="/skins/${hide.id}/photo" alt="${escapeHtml(hide.label)}" />
      <div class="card-title">
        <span>${escapeHtml(hide.species)}</span>
        <span class="tag tag-outline">${hide.id.slice(0, 8)}</span>
      </div>
      <p class="card-body">${escapeHtml(hide.label)} · ${hideSizeLabel(hide)}${hide.thicknessMm != null ? ` · ${hide.thicknessMm} mm thick` : ''}</p>
      <div class="area-bar"><div class="area-bar-fill" style="width: ${remaining}%"></div></div>
      <div class="card-meta">${remaining}% remaining · captured ${date}</div>
    </div>
  `;
    })
    .join('');
}

async function loadHides() {
  const response = await fetch('/skins');
  hides = await response.json();
  renderSpeciesTags();
  renderGrid();
}

speciesTagsEl.addEventListener('click', (event) => {
  const species = event.target.dataset.species;
  if (!species) return;
  selectedSpecies = selectedSpecies === species ? null : species;
  renderSpeciesTags();
  renderGrid();
});

searchInput.addEventListener('input', renderGrid);

loadHides();
```

- [ ] **Step 3: Manual verification (no automated test — browser-only UI, per project precedent)**

Run: `npm start`

Then, with a browser open to `http://localhost:8080/public/hides.html`:

1. Confirm the page loads with "0 hides · 0 cm² usable" and an empty grid.
2. Click "Add a hide", fill in name/species/thickness, choose a photo of a
   pattern piece on a contrasting mat, complete calibration (click two
   points, enter the real distance), optionally drag a region, click "Add
   to library".
3. Confirm the dialog closes and a new card appears with the photo,
   species, computed size, thickness, a 100%-filled area bar, and today's
   date.
4. Type into the search box and confirm the grid filters by label/species
   as you type.
5. Click a species tag and confirm the grid filters to that species only;
   click it again and confirm it clears.
6. Open `http://localhost:8080/public/match-skins.html`, add a
   signature-only skin there, then reload `hides.html` and confirm that
   hide's card renders too, with size "—" (no outline) and its thickness
   segment omitted.

Expected: all six checks pass with no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/hides.html src/hides-app.js
git commit -m "feat(hides): add hide-library page with search/filter and add-a-hide flow"
```

---

## Self-Review Notes

- **Spec coverage:** store optional fields + `remainingAreaPct` (Task 1),
  `rankMatches()` NaN fix (Task 2), `POST /skins` `captureType` branching
  (Task 3), `public/hides.html`/`src/hides-app.js` card grid + search +
  species filter + add-a-hide flow (Task 4) — every spec Goal has a task.
  Non-goals (defects, nest-workspace wiring, remaining-area-from-jobs,
  attach-signature-after-the-fact, renaming identifiers) are intentionally
  untouched by every task above.
- **Type consistency:** `store.create()`'s new field names
  (`outlinePolygon`, `thicknessMm`, `remainingAreaPct`) are the same names
  used in Task 3's `server.js` call and Task 4's `hides-app.js` reads.
  `boundingBox()` (Task 4) matches `src/nesting/geometry.js`'s actual
  export (verified against `dies-app.js`'s existing usage).
