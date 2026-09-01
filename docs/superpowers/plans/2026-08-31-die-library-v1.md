# Die Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent library of named die shapes, added by uploading an SVG or by photographing a die and digitizing it — the first of two sub-projects toward drag-and-drop blotch-pattern matching on skin photos.

**Architecture:** A file-based store (mirroring `src/skins/store.js`) holds `{ id, name, polygon, createdAt }` records. `server.js` gains `POST /dies` (accepting either an SVG upload, reusing the existing `parseSVGPolygon`, or a photo+calibration upload, reusing the existing `scripts/digitize.py`), `GET /dies`, and `DELETE /dies/:id`. A browser page composes the existing calibration UI with a mode toggle and renders each die's own polygon as its thumbnail — no photo storage needed.

**Tech Stack:** Reuses everything already in the project — `src/svg/parse.js`'s `parseSVGPolygon`, `scripts/digitize.py` + `src/calibration-ui.js`, `formidable` for uploads, Node's built-in `node:test` + `node:crypto`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-die-library-design.md`

## Global Constraints

- No new dependencies, Python or npm.
- `data/dies/` is already covered by the existing `data/` entry in `.gitignore` (added for the skins inventory) — no `.gitignore` change needed in this plan.
- All error paths (malformed SVG, failed digitize, missing name, missing shape input) return a clear, specific message — never a silent wrong shape or a raw stack trace.
- Tests use Node's built-in `node:test` + `assert/strict` — no test framework dependency added.
- Die ids go through the same `SAFE_ID` path-traversal guard pattern already established in `src/skins/store.js`.

---

### Task 1: `src/dies/store.js`

**Files:**
- Create: `src/dies/store.js`
- Create: `test/dies-store.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createStore(dataDir)` → `{ list, create, remove }`:
  - `list()` → array of stored records, sorted by `createdAt` ascending.
  - `create({ name, polygon })` → the created record (adds `id` via `crypto.randomUUID()` and `createdAt`).
  - `remove(id)` → `boolean`, `true` if a record was deleted; also the path-traversal guard point (rejects ids not matching `SAFE_ID`).
  - Task 2's server routes call all three functions.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/dies-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/dies/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dies-store-test-'));
}

test('create() writes a JSON record, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Vamp',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.name, 'Vamp');

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes the record and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({
    name: 'Quarter',
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);
  assert.equal(store.remove('does-not-exist'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() rejects ids shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.remove('../../etc/passwd'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/dies-store.test.js`
Expected: FAIL — `src/dies/store.js` doesn't exist yet.

- [ ] **Step 3: Write `src/dies/store.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[0-9a-f-]+$/i;

export function createStore(dataDir) {
  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function recordPath(id) {
    return path.join(dataDir, `${id}.json`);
  }

  function list() {
    ensureDir();
    return fs
      .readdirSync(dataDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function create({ name, polygon }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = { id, name, polygon, createdAt: new Date().toISOString() };
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function remove(id) {
    if (!SAFE_ID.test(id)) return false;
    const filePath = recordPath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  return { list, create, remove };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/dies-store.test.js`
Expected: PASS, 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/dies/store.js test/dies-store.test.js
git commit -m "feat: add file-based die library store"
```

---

### Task 2: `server.js` — `/dies` routes

**Files:**
- Modify: `server.js`
- Modify: `test/helpers/with-server.js`
- Create: `test/dies-route.test.js`

**Interfaces:**
- Consumes: `parseSVGPolygon` from `src/svg/parse.js` (existing), `scripts/digitize.py`'s CLI contract (existing), `createStore` from Task 1
- Produces: `createServer({ dataDir, diesDataDir } = {})` — `diesDataDir` defaults to `<project root>/data/dies`; tests override it with a temp directory. `test/helpers/with-server.js`'s `withServer(fn, { withDiesDataDir: true })` creates and cleans up that temp directory, mirroring the existing `withDataDir` option for skins. Route contract:
  - `POST /dies` — multipart fields `name` (text) plus either `svg` (file) or `photo` (file) + `p1x`/`p1y`/`p2x`/`p2y`/`realDistanceMm` → `200` with the created record, `422 {"error": "..."}` on a parse/digitize failure, `400 {"error": "..."}` on a malformed upload or missing `name`/shape input.
  - `GET /dies` → `200` with an array of all stored records.
  - `DELETE /dies/:id` → `204` on success, `404` if `id` is unknown.

- [ ] **Step 1: Extend `test/helpers/with-server.js` with a `withDiesDataDir` option**

```javascript
// test/helpers/with-server.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../server.js';

export async function withServer(fn, { withDataDir = false, withDiesDataDir = false } = {}) {
  const dataDir = withDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'skins-route-test-')) : undefined;
  const diesDataDir = withDiesDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'dies-route-test-')) : undefined;
  const options = {};
  if (dataDir) options.dataDir = dataDir;
  if (diesDataDir) options.diesDataDir = diesDataDir;

  const server = createServer(Object.keys(options).length ? options : undefined);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    if (diesDataDir) fs.rmSync(diesDataDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Write the failing test file**

```javascript
// test/dies-route.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const SVG_CONTENT = '<polygon points="0,0 40,0 40,20 0,20" />';

function withServer(fn) {
  return withServerBase(fn, { withDiesDataDir: true });
}

async function postDieSvg(baseUrl, overrides = {}) {
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Vamp');
  formData.append('svg', new Blob([overrides.svgContent ?? SVG_CONTENT]), 'die.svg');
  return fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
}

async function postDiePhoto(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(PHOTO_FIXTURE);
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Quarter');
  formData.append('photo', new Blob([fileBuffer]), 'die.png');
  const calibration = { p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100, ...overrides.calibration };
  for (const [key, value] of Object.entries(calibration)) {
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
}

test('POST /dies via SVG upload creates a die and GET /dies lists it', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await postDieSvg(baseUrl);
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.id);
    assert.deepEqual(created.polygon, [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
    ]);

    const list = await (await fetch(`${baseUrl}/dies`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('POST /dies via photo digitizes the die and creates a record', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDiePhoto(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(created.id);
    assert.ok(Array.isArray(created.polygon));
    assert.ok(created.polygon.length >= 3);
  });
});

test('POST /dies returns 422 with a clear error for a malformed SVG', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDieSvg(baseUrl, { svgContent: '<rect width="10" height="10" />' });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /No <polygon points/);
  });
});

test('POST /dies returns 400 when name is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDieSvg(baseUrl, { name: '' });
    assert.equal(response.status, 400);
  });
});

test('POST /dies returns 400 when neither svg nor photo is provided', async () => {
  await withServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append('name', 'Empty');
    const response = await fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
    assert.equal(response.status, 400);
  });
});

test('DELETE /dies/:id removes it, GET /dies no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieSvg(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/dies/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/dies`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /dies/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dies/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/dies-route.test.js`
Expected: FAIL — `createServer` doesn't accept a `diesDataDir` option yet and there are no `/dies` routes.

- [ ] **Step 4: Rewrite `server.js`**

```javascript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import formidable from 'formidable';
import { createStore } from './src/skins/store.js';
import { rankMatches } from './src/skins/similarity.js';
import { createStore as createDieStore } from './src/dies/store.js';
import { parseSVGPolygon } from './src/svg/parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const DIGITIZE_SCRIPT = path.join(__dirname, 'scripts', 'digitize.py');
const SKIN_SIGNATURE_SCRIPT = path.join(__dirname, 'scripts', 'skin_signature.py');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/public/index.html' : req.url;
  const filePath = path.join(__dirname, urlPath);

  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function parseForm(req) {
  const form = formidable({});
  const [fields, files] = await form.parse(req);
  return { fields, files };
}

function cleanupFiles(files) {
  for (const fileList of Object.values(files)) {
    for (const file of fileList) {
      fs.unlink(file.filepath, () => {});
    }
  }
}

async function handleDigitize(req, res) {
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
  const args = [
    DIGITIZE_SCRIPT,
    photo.filepath,
    getField('p1x'),
    getField('p1y'),
    getField('p2x'),
    getField('p2y'),
    getField('realDistanceMm'),
  ];

  execFile(PYTHON, args, (err, stdout, stderr) => {
    fs.unlink(photo.filepath, () => {});

    if (err) {
      sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(stdout);
  });
}

function createSkinsRoutes(dataDir) {
  const store = createStore(dataDir);

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
      const photoExt = path.extname(photo.originalFilename || '') || '.jpg';
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

  function handleListSkins(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleMatchSkins(req, res) {
    sendJSON(res, 200, rankMatches(store.list()));
  }

  function handleDeleteSkin(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  function handleSkinPhoto(req, res, id) {
    const photoPath = store.photoPath(id);
    if (!photoPath) {
      sendJSON(res, 404, { error: 'Skin not found.' });
      return;
    }
    fs.readFile(photoPath, (err, data) => {
      if (err) {
        sendJSON(res, 404, { error: 'Skin not found.' });
        return;
      }
      const ext = path.extname(photoPath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  return { handleCreateSkin, handleListSkins, handleMatchSkins, handleDeleteSkin, handleSkinPhoto };
}

function createDiesRoutes(dataDir) {
  const store = createDieStore(dataDir);

  async function handleCreateDie(req, res) {
    let fields, files;
    try {
      ({ fields, files } = await parseForm(req));
    } catch {
      sendJSON(res, 400, { error: 'Could not parse upload.' });
      return;
    }

    const getField = (name) => fields[name] && fields[name][0];
    const name = getField('name');
    const svgFile = files.svg && files.svg[0];
    const photoFile = files.photo && files.photo[0];

    if (!name || (!svgFile && !photoFile)) {
      cleanupFiles(files);
      sendJSON(res, 400, { error: 'name and either an svg file or a photo with calibration are required.' });
      return;
    }

    if (svgFile) {
      const svgContent = fs.readFileSync(svgFile.filepath, 'utf8');
      fs.unlink(svgFile.filepath, () => {});
      try {
        const polygon = parseSVGPolygon(svgContent);
        sendJSON(res, 200, store.create({ name, polygon }));
      } catch (err) {
        sendJSON(res, 422, { error: err.message });
      }
      return;
    }

    const args = [
      DIGITIZE_SCRIPT,
      photoFile.filepath,
      getField('p1x'),
      getField('p1y'),
      getField('p2x'),
      getField('p2y'),
      getField('realDistanceMm'),
    ];
    execFile(PYTHON, args, (err, stdout, stderr) => {
      fs.unlink(photoFile.filepath, () => {});
      if (err) {
        sendJSON(res, 422, { error: stderr.trim() || 'Digitization failed.' });
        return;
      }
      const { polygon } = JSON.parse(stdout);
      sendJSON(res, 200, store.create({ name, polygon }));
    });
  }

  function handleListDies(req, res) {
    sendJSON(res, 200, store.list());
  }

  function handleDeleteDie(req, res, id) {
    if (!store.remove(id)) {
      sendJSON(res, 404, { error: 'Die not found.' });
      return;
    }
    res.writeHead(204);
    res.end();
  }

  return { handleCreateDie, handleListDies, handleDeleteDie };
}

export function createServer({
  dataDir = path.join(__dirname, 'data', 'skins'),
  diesDataDir = path.join(__dirname, 'data', 'dies'),
} = {}) {
  const skins = createSkinsRoutes(dataDir);
  const dies = createDiesRoutes(diesDataDir);

  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/digitize') {
      handleDigitize(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/skins') {
      skins.handleCreateSkin(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/skins') {
      skins.handleListSkins(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/skins/matches') {
      skins.handleMatchSkins(req, res);
      return;
    }
    const photoMatch = req.method === 'GET' && req.url.match(/^\/skins\/([^/]+)\/photo$/);
    if (photoMatch) {
      skins.handleSkinPhoto(req, res, photoMatch[1]);
      return;
    }
    const skinDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/skins\/([^/]+)$/);
    if (skinDeleteMatch) {
      skins.handleDeleteSkin(req, res, skinDeleteMatch[1]);
      return;
    }
    if (req.method === 'POST' && req.url === '/dies') {
      dies.handleCreateDie(req, res);
      return;
    }
    if (req.method === 'GET' && req.url === '/dies') {
      dies.handleListDies(req, res);
      return;
    }
    const dieDeleteMatch = req.method === 'DELETE' && req.url.match(/^\/dies\/([^/]+)$/);
    if (dieDeleteMatch) {
      dies.handleDeleteDie(req, res, dieDeleteMatch[1]);
      return;
    }
    serveStatic(req, res);
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`leather-nest dev server running at http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `node --test test/dies-route.test.js`
Expected: PASS, 7/7 tests green.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all prior tests plus 3 from Task 1 + 7 from Task 2 pass, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add server.js test/helpers/with-server.js test/dies-route.test.js
git commit -m "feat: add /dies routes (create via SVG or photo, list, delete)"
```

---

### Task 3: `public/dies.html` + `src/dies-app.js`

**Files:**
- Create: `public/dies.html`
- Create: `src/dies-app.js`
- No automated test — browser-only UI, per this project's established precedent (same as `calibration-ui.js`, `digitize-app.js`, `match-skins-app.js`).

**Interfaces:**
- Consumes: `attachCalibration` (existing, unchanged), `boundingBox`/`polygonToSVGPoints` from `src/nesting/geometry.js` (existing, unchanged), `POST /dies`, `GET /dies`, `DELETE /dies/:id` (Task 2)
- Produces: nothing further consumed by other tasks — this is the last task in this plan. The die-library page and its `/dies` routes are what the (separately spec'd) blotch-matching tool will consume next.

- [ ] **Step 1: Write `public/dies.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>leather-nest — die library</title>
  </head>
  <body>
    <h1>Die library</h1>

    <section>
      <h2>Add a die</h2>
      <label>Name: <input type="text" id="name-input" /></label>
      <div>
        <label><input type="radio" name="add-mode" value="svg" checked /> Upload SVG</label>
        <label><input type="radio" name="add-mode" value="photo" /> Photograph a die</label>
      </div>

      <div id="svg-mode">
        <input type="file" id="svg-input" accept=".svg,image/svg+xml" />
      </div>

      <div id="photo-mode" style="display: none">
        <input type="file" id="photo-input" accept="image/*" />
        <div id="calibration-container"></div>
      </div>

      <button type="button" id="submit-die">Add to library</button>
      <div id="add-status"></div>
    </section>

    <section>
      <h2>Library</h2>
      <button type="button" id="refresh-dies">Refresh</button>
      <div id="dies-list"></div>
    </section>

    <script type="module" src="/src/dies-app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/dies-app.js`**

```javascript
import { attachCalibration } from './calibration-ui.js';
import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';

const nameInput = document.getElementById('name-input');
const modeRadios = document.querySelectorAll('input[name="add-mode"]');
const svgMode = document.getElementById('svg-mode');
const photoMode = document.getElementById('photo-mode');
const svgInput = document.getElementById('svg-input');
const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const submitButton = document.getElementById('submit-die');
const addStatus = document.getElementById('add-status');
const diesListEl = document.getElementById('dies-list');

let selectedPhoto = null;
let calibration = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    svgMode.style.display = radio.value === 'svg' ? 'block' : 'none';
    photoMode.style.display = radio.value === 'photo' ? 'block' : 'none';
  });
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedPhoto = file;
  calibration = null;

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (result) => {
    calibration = result;
  });
});

submitButton.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) {
    addStatus.textContent = 'Name is required.';
    return;
  }

  const mode = document.querySelector('input[name="add-mode"]:checked').value;
  const formData = new FormData();
  formData.append('name', name);

  if (mode === 'svg') {
    const file = svgInput.files[0];
    if (!file) {
      addStatus.textContent = 'Choose an SVG file.';
      return;
    }
    formData.append('svg', file);
  } else {
    if (!selectedPhoto || !calibration) {
      addStatus.textContent = 'Upload a photo and complete calibration first.';
      return;
    }
    formData.append('photo', selectedPhoto);
    formData.append('p1x', calibration.p1x);
    formData.append('p1y', calibration.p1y);
    formData.append('p2x', calibration.p2x);
    formData.append('p2y', calibration.p2y);
    formData.append('realDistanceMm', calibration.realDistanceMm);
  }

  addStatus.textContent = 'Adding…';

  try {
    const response = await fetch('/dies', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addStatus.textContent = `Added "${body.name}".`;
    nameInput.value = '';
    svgInput.value = '';
    photoInput.value = '';
    calibrationContainer.innerHTML = '';
    selectedPhoto = null;
    calibration = null;
    loadDies();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

async function loadDies() {
  const response = await fetch('/dies');
  const dies = await response.json();
  diesListEl.innerHTML = dies
    .map((die) => {
      const bounds = boundingBox(die.polygon);
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      return `
    <div>
      <svg width="80" height="${(80 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
        <polygon points="${polygonToSVGPoints(die.polygon)}" stroke="#FF0000" stroke-width="${width / 80}" fill="none" />
      </svg>
      <strong>${escapeHtml(die.name)}</strong>
      <button type="button" data-delete-id="${die.id}">Delete</button>
    </div>
  `;
    })
    .join('');
}

diesListEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteId;
  if (!id) return;
  await fetch(`/dies/${id}`, { method: 'DELETE' });
  loadDies();
});

document.getElementById('refresh-dies').addEventListener('click', loadDies);

loadDies();
```

- [ ] **Step 3: Run the full automated suite**

Run: `npm test`
Expected: all prior tests pass, unchanged count (this task adds no automated tests).

- [ ] **Step 4: Manually verify the end-to-end loop**

Run: `npm start`

Then:
1. Open `http://localhost:8080/public/dies.html` (note the `/public/` prefix — `serveStatic` only special-cases the bare `/` route to `index.html`, a pre-existing quirk).
2. With "Upload SVG" selected, pick a small SVG file containing a `<polygon points="...">` element (or create one, e.g. `<svg><polygon points="0,0 40,0 40,20 0,20" /></svg>`), give it a name, click "Add to library." Confirm it appears in the list below with a rendered outline thumbnail.
3. Switch to "Photograph a die," upload a photo with a distinct shape against a contrasting background, click two calibration points, enter the real distance, submit the calibration, give it a name, click "Add to library." Confirm it appears with a plausible outline.
4. Try a deliberately bad case (e.g. an SVG file with no `<polygon>` element) and confirm a clear error message appears instead of a broken result.
5. Delete one die and confirm it disappears from the list on refresh.
6. Stop the server (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add public/dies.html src/dies-app.js
git commit -m "feat: add die library browser UI"
```
