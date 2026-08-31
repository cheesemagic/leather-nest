# Photo Digitization Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photo of a pattern piece + ruler-click calibration → an accurate, cut-ready polygon in mm, shown back to the user for visual confirmation.

**Architecture:** A Python script (OpenCV, invoked as a subprocess) does the actual computer-vision work; the existing Node server gains one new route that shells out to it and returns JSON; a new browser page handles upload, calibration-click, and result display.

**Tech Stack:** Python 3.14 in a project-local venv (`opencv-python-headless==5.0.0.93`, `numpy==2.5.2`), `formidable@3.5.4` (npm, multipart upload parsing), Node's built-in `node:test` + native `fetch`/`FormData`/`Blob` for the route test.

**Spec:** `docs/superpowers/specs/2026-08-31-photo-digitization-design.md`

## Global Constraints

- No SVGnest-style vendoring, no new heavy dependency beyond what's named above (`clipper-lib` stays JS-only, untouched by this plan).
- All error paths (bad image, no detectable outline, degenerate calibration) return a clear, specific message — never a silent wrong answer or a raw stack trace.
- Output polygons use the same `{x, y}[]` mm convention as the rest of the codebase, normalized so the polygon's own minimum corner sits at `(0, 0)` — matching `normalizeToOrigin` elsewhere.
- `python3` calls always go through the project-local venv (`venv/bin/python3`), never the system Python — keeps `opencv-python-headless`/`numpy` isolated, same spirit as `node_modules` for JS deps.
- Tests use Node's built-in `node:test` + `assert/strict` (JS side) — no test framework dependency added.

## Environment note for whoever runs this plan

A working venv with `opencv-python-headless==5.0.0.93` and `numpy==2.5.2` already exists at `venv/` in this repo (built during design-time grounding — confirmed working: `cv2.__version__` reports `5.0.0`). **Do not delete and recreate it** — on this machine, Python 3.14 has no prebuilt OpenCV wheel yet, so `pip install` falls back to compiling OpenCV from source, which took over 10 minutes. Task 1 verifies the existing venv rather than rebuilding it. If a venv genuinely doesn't exist when this plan runs elsewhere, follow Task 1's steps as written — they still work for a fresh install, just slower.

---

### Task 1: Python environment + requirements.txt

**Files:**
- Create: `requirements.txt`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a documented, working `venv/` with `opencv-python-headless` and `numpy` installed, verified importable, for later tasks' Python code to run against.

- [ ] **Step 1: Write `requirements.txt`**

```
opencv-python-headless==5.0.0.93
numpy==2.5.2
```

- [ ] **Step 2: Add `venv/` to `.gitignore`**

Add a line to the existing `.gitignore` (currently just `node_modules/`):

```
node_modules/
venv/
```

- [ ] **Step 3: Verify the venv (don't recreate it if it already works)**

Run: `test -x venv/bin/python3 && venv/bin/python3 -c "import cv2, numpy; print('cv2', cv2.__version__, 'numpy', numpy.__version__)"`

Expected: `cv2 5.0.0 numpy 2.5.2` (or close — versions may have moved if this runs later; that's fine as long as the import succeeds).

If this fails (no venv, or import error): run `python3 -m venv venv && venv/bin/pip install -r requirements.txt`, then re-run the verification command above. Be aware this may take several minutes to over an hour if it falls back to a source build — that's expected on a Python version without prebuilt OpenCV wheels, not a bug.

- [ ] **Step 4: Update `README.md` with Python setup instructions**

Add this section after the existing "Test" section:

```markdown

## Python setup (photo digitization)

The photo digitization feature uses a small Python/OpenCV script. One-time setup:

    python3 -m venv venv
    venv/bin/pip install -r requirements.txt

The server calls `venv/bin/python3` directly — no need to activate the venv.
```

- [ ] **Step 5: Commit**

```bash
git add requirements.txt .gitignore README.md
git commit -m "chore: add Python venv setup for photo digitization"
```

---

### Task 2: `scripts/digitize.py`

**Files:**
- Create: `scripts/digitize.py`
- Create: `test/fixtures/generate-test-image.py`
- Create: `test/digitize.test.js`
- (Generated, not hand-written: `test/fixtures/test-rectangle.png`, `test/fixtures/test-blank.png` — produced by Step 2 below)

**Interfaces:**
- Consumes: `venv/bin/python3` with `cv2`/`numpy` available (Task 1)
- Produces: `scripts/digitize.py`, invoked as
  `venv/bin/python3 scripts/digitize.py <image_path> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>`,
  printing `{"polygon": [{"x": ..., "y": ...}, ...]}` to stdout on success (exit 0), or a
  human-readable message to stderr on failure (non-zero exit, nothing on stdout). This is
  the exact contract Task 3's server route consumes.

- [ ] **Step 1: Write the fixture generator**

```python
#!/usr/bin/env python3
"""Generates the synthetic fixtures used by test/digitize.test.js. Run
manually with the project's venv if fixtures ever need regenerating:
    venv/bin/python3 test/fixtures/generate-test-image.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)

# A precise 200x100px black rectangle on a white background. Corners are
# (100,100) to (299,199) rather than (100,100) to (300,200) so the filled
# region is exactly 200x100 pixels (cv2.rectangle's -1 fill is inclusive
# of both corners).
rect = np.full((300, 400), 255, dtype=np.uint8)
cv2.rectangle(rect, (100, 100), (299, 199), 0, -1)
cv2.imwrite(os.path.join(fixtures_dir, "test-rectangle.png"), rect)

# A uniform blank image — no contour should be detectable in this at all.
blank = np.full((300, 400), 255, dtype=np.uint8)
cv2.imwrite(os.path.join(fixtures_dir, "test-blank.png"), blank)

print("wrote test-rectangle.png and test-blank.png")
```

- [ ] **Step 2: Generate the fixtures**

Run: `mkdir -p test/fixtures && venv/bin/python3 test/fixtures/generate-test-image.py`
Expected: `wrote test-rectangle.png and test-blank.png`, and both files exist under `test/fixtures/`.

- [ ] **Step 3: Write the failing test file**

```javascript
// test/digitize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'digitize.py');
const FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

function boundingBox(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

test('digitize.py extracts a known rectangle at the correct mm dimensions', () => {
  const stdout = execFileSync(PYTHON, [SCRIPT, FIXTURE, '0', '0', '200', '0', '100']);
  const result = JSON.parse(stdout.toString());
  const bounds = boundingBox(result.polygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  assert.ok(Math.abs(width - 100) < 3, `expected ~100mm width, got ${width}`);
  assert.ok(Math.abs(height - 50) < 3, `expected ~50mm height, got ${height}`);
});

test('digitize.py fails clearly on an image with no detectable outline', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, BLANK_FIXTURE, '0', '0', '200', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /No clear pattern outline detected/);
      return true;
    }
  );
});

test('digitize.py fails clearly on degenerate calibration points', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, FIXTURE, '50', '50', '50', '50', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /Calibration points must be distinct/);
      return true;
    }
  );
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test test/digitize.test.js`
Expected: FAIL — `scripts/digitize.py` doesn't exist yet (ENOENT from `execFileSync`).

- [ ] **Step 5: Write `scripts/digitize.py`**

```python
#!/usr/bin/env python3
import sys
import json
import cv2
import numpy as np


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 7:
        fail("Usage: digitize.py <image_path> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>")

    image_path = sys.argv[1]
    p1x, p1y, p2x, p2y, real_distance_mm = (float(v) for v in sys.argv[2:7])

    pixel_distance = ((p2x - p1x) ** 2 + (p2y - p1y) ** 2) ** 0.5
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")

    image = cv2.imread(image_path)
    if image is None:
        fail("Could not read image file.")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    total_area = gray.shape[0] * gray.shape[1]
    min_area = total_area * 0.01
    max_area = total_area * 0.90

    # Try both threshold directions — we don't know in advance whether the
    # pattern piece is darker or lighter than the mat it's photographed on.
    candidates = []
    for thresh_type in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        _, binary = cv2.threshold(gray, 0, 255, thresh_type + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if min_area <= area <= max_area:
                candidates.append((area, contour))

    if not candidates:
        fail("No clear pattern outline detected — check lighting/contrast against the mat.")

    _, best_contour = max(candidates, key=lambda pair: pair[0])

    perimeter = cv2.arcLength(best_contour, True)
    epsilon = 0.005 * perimeter
    approx = cv2.approxPolyDP(best_contour, epsilon, True)

    scale_mm_per_px = real_distance_mm / pixel_distance
    points_mm = [
        {"x": float(pt[0][0]) * scale_mm_per_px, "y": float(pt[0][1]) * scale_mm_per_px}
        for pt in approx
    ]

    min_x = min(p["x"] for p in points_mm)
    min_y = min(p["y"] for p in points_mm)
    normalized = [{"x": p["x"] - min_x, "y": p["y"] - min_y} for p in points_mm]

    print(json.dumps({"polygon": normalized}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/digitize.test.js`
Expected: PASS, 3/3 tests green.

- [ ] **Step 7: Commit**

```bash
git add scripts/digitize.py test/fixtures/generate-test-image.py test/fixtures/test-rectangle.png test/fixtures/test-blank.png test/digitize.test.js
git commit -m "feat: add photo digitization script (contour extraction via OpenCV)"
```

---

### Task 3: `formidable` dependency + `POST /digitize` route

**Files:**
- Modify: `package.json` (add `formidable` dependency)
- Modify: `server.js`
- Create: `test/digitize-route.test.js`

**Interfaces:**
- Consumes: `scripts/digitize.py`'s CLI contract (Task 2)
- Produces: `export function createServer()` from `server.js` — returns an `http.Server` not yet listening, so tests can bind it to an ephemeral port. The file's bottom only calls `.listen(...)` when run as the main module (`node server.js`), unchanged behavior for `npm start`. Route contract: `POST /digitize` with multipart fields `photo` (file), `p1x`, `p1y`, `p2x`, `p2y`, `realDistanceMm` → `200 {"polygon": [...]}` on success, `422 {"error": "..."}` on a digitization failure, `400 {"error": "..."}` on a malformed upload.

- [ ] **Step 1: Add the `formidable` dependency**

Run: `npm install formidable@3.5.4`
Expected: `package.json`'s `dependencies` gains `"formidable": "^3.5.4"` (or similar), `package-lock.json` updates.

- [ ] **Step 2: Write the failing test file**

```javascript
// test/digitize-route.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postDigitize(baseUrl, fixturePath, calibration) {
  const fileBuffer = await readFile(fixturePath);
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'test.png');
  for (const [key, value] of Object.entries(calibration)) {
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/digitize`, { method: 'POST', body: formData });
}

test('POST /digitize returns a polygon for a known fixture', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDigitize(baseUrl, FIXTURE, {
      p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100,
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.polygon));
    assert.ok(body.polygon.length >= 3);
  });
});

test('POST /digitize returns 422 with a clear error for an undetectable outline', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDigitize(baseUrl, BLANK_FIXTURE, {
      p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100,
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /No clear pattern outline detected/);
  });
});

test('GET / still serves the static site (existing behavior preserved)', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/digitize-route.test.js`
Expected: FAIL — `createServer` is not exported from `server.js` yet.

- [ ] **Step 4: Rewrite `server.js`**

```javascript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import formidable from 'formidable';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const DIGITIZE_SCRIPT = path.join(__dirname, 'scripts', 'digitize.py');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
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

async function handleDigitize(req, res) {
  const form = formidable({});
  let fields;
  let files;
  try {
    [fields, files] = await form.parse(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not parse upload.' }));
    return;
  }

  const photo = files.photo && files.photo[0];
  if (!photo) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No photo uploaded.' }));
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
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: stderr.trim() || 'Digitization failed.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(stdout);
  });
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/digitize') {
      handleDigitize(req, res);
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/digitize-route.test.js`
Expected: PASS, 3/3 tests green.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all prior tests (14 from v0 + 3 from Task 2) plus these 3 pass — 20/20.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server.js test/digitize-route.test.js
git commit -m "feat: add POST /digitize route (formidable upload + Python subprocess)"
```

---

### Task 4: Calibration UI + digitize page

**Files:**
- Create: `src/calibration-ui.js`
- Create: `public/digitize.html`
- Create: `src/digitize-app.js`
- No automated test — browser-only UI, per this project's established precedent (v0's Task 6 was manual-verification only for the same reason)

**Interfaces:**
- Consumes: `POST /digitize` (Task 3); `boundingBox`, `polygonToSVGPoints` from `src/nesting/geometry.js` (already exists from v0 — reused, not reimplemented)
- Produces: `src/calibration-ui.js` exports `attachCalibration(container, imgSrc, onComplete)` — renders an image with click-to-calibrate (two points + a real-distance input), calling `onComplete({p1x, p1y, p2x, p2y, realDistanceMm})` once both are captured, in the image's natural pixel coordinates. This is written as a standalone reusable module (not extracted from anything, since nothing existed to extract from) — the design spec's intent is for a later feature (skin matching) to reuse this same interaction rather than reimplementing it.

- [ ] **Step 1: Write `src/calibration-ui.js`**

```javascript
export function attachCalibration(container, imgSrc, onComplete) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';

  const img = document.createElement('img');
  img.src = imgSrc;
  img.style.display = 'block';
  img.style.maxWidth = '100%';

  const overlay = document.createElement('canvas');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.cursor = 'crosshair';

  wrapper.appendChild(img);
  wrapper.appendChild(overlay);
  container.appendChild(wrapper);

  const form = document.createElement('div');
  form.style.marginTop = '8px';
  form.style.display = 'none';
  form.innerHTML = `
    <label>
      Real-world distance between the two points (mm):
      <input type="number" id="real-distance-input" min="0.01" step="any" />
    </label>
    <button type="button" id="calibration-submit">Use this calibration</button>
  `;
  container.appendChild(form);

  let points = [];

  function drawMarkers() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const scaleX = overlay.width / img.naturalWidth;
    const scaleY = overlay.height / img.naturalHeight;
    ctx.fillStyle = '#FF3B30';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * scaleX, p.y * scaleY, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (points.length === 2) {
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
      ctx.lineTo(points[1].x * scaleX, points[1].y * scaleY);
      ctx.stroke();
    }
  }

  img.addEventListener('load', () => {
    overlay.width = img.clientWidth;
    overlay.height = img.clientHeight;
  });

  overlay.addEventListener('click', (event) => {
    if (points.length >= 2) {
      points = [];
      form.style.display = 'none';
    }

    const rect = overlay.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const naturalX = (displayX / overlay.width) * img.naturalWidth;
    const naturalY = (displayY / overlay.height) * img.naturalHeight;

    points.push({ x: naturalX, y: naturalY });
    drawMarkers();

    if (points.length === 2) {
      form.style.display = 'block';
    }
  });

  form.querySelector('#calibration-submit').addEventListener('click', () => {
    const realDistanceMm = Number(form.querySelector('#real-distance-input').value);
    if (points.length !== 2 || !(realDistanceMm > 0)) {
      return;
    }
    onComplete({
      p1x: points[0].x,
      p1y: points[0].y,
      p2x: points[1].x,
      p2y: points[1].y,
      realDistanceMm,
    });
  });
}
```

- [ ] **Step 2: Write `public/digitize.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>leather-nest — digitize</title>
  </head>
  <body>
    <h1>Digitize a pattern piece</h1>
    <p>Upload a photo, click two points on a ruler (or anything with a known length) in the image, enter the real-world distance, then submit.</p>
    <input type="file" id="photo-input" accept="image/*" />
    <div id="calibration-container"></div>
    <div id="result"></div>
    <script type="module" src="/src/digitize-app.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Write `src/digitize-app.js`**

```javascript
import { attachCalibration } from './calibration-ui.js';
import { boundingBox, polygonToSVGPoints } from './nesting/geometry.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const resultEl = document.getElementById('result');

let selectedFile = null;

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  resultEl.textContent = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, async (calibration) => {
    resultEl.textContent = 'Digitizing…';

    const formData = new FormData();
    formData.append('photo', selectedFile);
    formData.append('p1x', calibration.p1x);
    formData.append('p1y', calibration.p1y);
    formData.append('p2x', calibration.p2x);
    formData.append('p2y', calibration.p2y);
    formData.append('realDistanceMm', calibration.realDistanceMm);

    const response = await fetch('/digitize', { method: 'POST', body: formData });
    const body = await response.json();

    if (!response.ok) {
      resultEl.textContent = `Error: ${body.error}`;
      return;
    }

    const bounds = boundingBox(body.polygon);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    resultEl.innerHTML = `
      <p>${width.toFixed(1)}mm &times; ${height.toFixed(1)}mm</p>
      <svg width="300" height="${(300 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
        <polygon points="${polygonToSVGPoints(body.polygon)}" stroke="#FF0000" stroke-width="${width / 300}" fill="none" />
      </svg>
    `;
  });
});
```

- [ ] **Step 4: Run the full automated suite**

Run: `npm test`
Expected: 20/20 passing (unchanged from Task 3 — this task adds no automated tests).

- [ ] **Step 5: Manually verify the end-to-end loop**

Run: `npm start`

Then:
1. Open `http://localhost:8080/digitize.html`.
2. Take (or find) a photo containing an object with a known length (e.g. a ruler) and a distinct shape against a contrasting background — a piece of paper cut into a simple shape on a table works for a first test.
3. Upload it. Click two points on the known-length reference in the photo. Enter the real distance in mm. Click "Use this calibration."
4. Confirm the page shows dimensions and a rendered outline that plausibly matches the photographed shape.
5. Try one deliberately-bad case (e.g. a blank/uniform photo) and confirm a clear error message appears instead of a broken result.
6. Stop the server (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add src/calibration-ui.js public/digitize.html src/digitize-app.js
git commit -m "feat: add photo digitization browser UI"
```
