# Cross-Skin Scale-Pattern Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a skin, calibrate it, select the sample panel region, and compute a scale-size signature — then rank an inventory of skins (same species only) by how closely their scale sizes match, so a matched pair can be picked without eyeballing it.

**Architecture:** A Python script (OpenCV/numpy, invoked as a subprocess, same split as photo digitization) computes a rotation-invariant scale-size signature via 2D FFT of the selected region. The existing Node server gains `/skins` routes backed by a small file-based store. A new browser page composes the existing calibration UI with a new drag-to-select-region UI.

**Tech Stack:** Same Python venv already in this repo (`opencv-python-headless==5.0.0.93`, `numpy==2.5.2` — no new Python packages needed), Node's built-in `node:test` + native `fetch`/`FormData`/`Blob`, `node:crypto` (`randomUUID`) for record IDs, plain `node:fs` for storage (no database).

**Spec:** `docs/superpowers/specs/2026-08-31-skin-matching-design.md`

## Global Constraints

- No new dependencies — Python side reuses the existing venv/`requirements.txt` as-is; Node side adds no new npm packages (`formidable` is already a dependency from the digitization sub-project).
- `data/skins/` holds real photos of a real inventory and **must be gitignored, never committed** — this project has a real GitHub remote already.
- Only skins of the same species are ever compared — cross-species pairs are never computed, not just hidden in the UI.
- Species grouping is exact string match, case-insensitive/trimmed.
- All error paths (bad image, region too small/low-contrast, degenerate calibration) fail with a clear, specific message — never a silent wrong number or a raw stack trace (same bar as photo digitization).
- `python3` calls always go through `venv/bin/python3`, never system Python.
- Tests use Node's built-in `node:test` + `assert/strict` — no test framework dependency added.

## Environment note for whoever runs this plan

The venv this plan needs already exists and works (`venv/bin/python3 -c "import cv2, numpy"` succeeds, `cv2.__version__` reports `5.0.0`, `numpy.__version__` reports `2.5.2`) — it was built for the photo digitization sub-project and `skin_signature.py` needs nothing beyond what's already in `requirements.txt`. **No environment setup task in this plan** — if the venv is somehow missing when this runs, see Task 1 of `docs/superpowers/plans/2026-08-31-photo-digitization-v1.md` for how to rebuild it.

The FFT signature approach below (Hann window → 2D FFT → radial average → resample onto a fixed log-spaced wavelength grid) was prototyped and run against synthetic dot-grid fixtures before writing this plan. Confirmed working: a 10px-spacing grid measured 9.85mm, a 20px-spacing grid measured 19.69mm (both at 1mm/px calibration), the same 10px grid rotated 30° measured 10.24mm (rotation invariance holds), and a blank image was cleanly rejected on the contrast check rather than reporting a bogus peak. The exact thresholds below are the ones that produced these results.

---

### Task 1: `scripts/skin_signature.py`

**Files:**
- Create: `scripts/skin_signature.py`
- Create: `test/fixtures/generate-periodic-test-image.py`
- Create: `test/skin-signature.test.js`
- (Generated, not hand-written: `test/fixtures/test-grid-10px.png`, `test/fixtures/test-grid-20px.png`, `test/fixtures/test-grid-10px-rotated.png` — produced by Step 2 below)

**Interfaces:**
- Consumes: `venv/bin/python3` with `cv2`/`numpy` available (already set up)
- Produces: `scripts/skin_signature.py`, invoked as
  `venv/bin/python3 scripts/skin_signature.py <image_path> <roi_x> <roi_y> <roi_w> <roi_h> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>`,
  printing `{"dominantWavelengthMm": <float>, "radialSpectrum": [<40 floats, normalized 0-1>]}` to stdout on
  success (exit 0), or a human-readable message to stderr on failure (non-zero exit, nothing on stdout).
  `radialSpectrum` is always exactly 40 values, resampled onto a fixed log-spaced wavelength grid
  (0.5mm–20mm) — this is what makes two different skins' spectra directly, position-wise comparable in
  Task 2's `similarity.js` without either side needing to know the underlying wavelength values.

- [ ] **Step 1: Write the fixture generator**

```python
#!/usr/bin/env python3
"""Generates the synthetic dot-grid fixtures used by test/skin-signature.test.js.
Run manually with the project's venv if fixtures ever need regenerating:
    venv/bin/python3 test/fixtures/generate-periodic-test-image.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)


def make_dot_grid(spacing_px, angle_deg, size=256, dot_radius=2):
    """A grid of filled dots at `spacing_px` apart, rotated `angle_deg`
    degrees. Generated by placing dots along a rotated lattice directly
    (rather than rotating a finished image), so there are no black border
    artifacts to worry about."""
    img = np.full((size, size), 255, dtype=np.uint8)
    theta = np.radians(angle_deg)
    u = np.array([np.cos(theta), np.sin(theta)]) * spacing_px
    v = np.array([-np.sin(theta), np.cos(theta)]) * spacing_px
    center = np.array([size / 2, size / 2])
    n = int(size / spacing_px) + 4
    for i in range(-n, n):
        for j in range(-n, n):
            point = center + i * u + j * v
            x, y = int(round(point[0])), int(round(point[1]))
            if 0 <= x < size and 0 <= y < size:
                cv2.circle(img, (x, y), dot_radius, 0, -1)
    return img


cv2.imwrite(os.path.join(fixtures_dir, "test-grid-10px.png"), make_dot_grid(10, 0))
cv2.imwrite(os.path.join(fixtures_dir, "test-grid-20px.png"), make_dot_grid(20, 0))
cv2.imwrite(os.path.join(fixtures_dir, "test-grid-10px-rotated.png"), make_dot_grid(10, 30))

print("wrote test-grid-10px.png, test-grid-20px.png, test-grid-10px-rotated.png")
```

- [ ] **Step 2: Generate the fixtures**

Run: `mkdir -p test/fixtures && venv/bin/python3 test/fixtures/generate-periodic-test-image.py`
Expected: `wrote test-grid-10px.png, test-grid-20px.png, test-grid-10px-rotated.png`, and all three files exist under `test/fixtures/`.

- [ ] **Step 3: Write the failing test file**

```javascript
// test/skin-signature.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'skin_signature.py');
const GRID_10 = path.join(__dirname, 'fixtures', 'test-grid-10px.png');
const GRID_20 = path.join(__dirname, 'fixtures', 'test-grid-20px.png');
const GRID_10_ROTATED = path.join(__dirname, 'fixtures', 'test-grid-10px-rotated.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

// Full-image ROI, calibration chosen so mm_per_px = 1 (0,0)-(100,0) over
// 100mm — so dominantWavelengthMm should equal the grid's pixel spacing.
const ARGS_1MM_PER_PX = ['0', '0', '256', '256', '0', '0', '100', '0', '100'];

function runSignature(imagePath, args) {
  const stdout = execFileSync(PYTHON, [SCRIPT, imagePath, ...args]);
  return JSON.parse(stdout.toString());
}

test('skin_signature.py measures a known 10px grid spacing within tolerance', () => {
  const result = runSignature(GRID_10, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result.dominantWavelengthMm - 10) < 2, `expected ~10mm, got ${result.dominantWavelengthMm}`);
  assert.equal(result.radialSpectrum.length, 40);
});

test('skin_signature.py measures a known 20px grid spacing within tolerance', () => {
  const result = runSignature(GRID_20, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result.dominantWavelengthMm - 20) < 3, `expected ~20mm, got ${result.dominantWavelengthMm}`);
});

test('skin_signature.py discriminates a 10px grid from a 20px grid', () => {
  const result10 = runSignature(GRID_10, ARGS_1MM_PER_PX);
  const result20 = runSignature(GRID_20, ARGS_1MM_PER_PX);
  assert.ok(Math.abs(result10.dominantWavelengthMm - result20.dominantWavelengthMm) > 5);
});

test('skin_signature.py is rotation-invariant for the same grid spacing', () => {
  const result = runSignature(GRID_10, ARGS_1MM_PER_PX);
  const resultRotated = runSignature(GRID_10_ROTATED, ARGS_1MM_PER_PX);
  assert.ok(
    Math.abs(result.dominantWavelengthMm - resultRotated.dominantWavelengthMm) < 2,
    `expected close match, got ${result.dominantWavelengthMm} vs ${resultRotated.dominantWavelengthMm}`
  );
});

test('skin_signature.py fails clearly on a low-contrast (blank) region', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, BLANK_FIXTURE, ...ARGS_1MM_PER_PX], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /too little contrast/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on a too-small region', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '10', '10', '0', '0', '100', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /too small/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on degenerate calibration points', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '256', '256', '50', '50', '50', '50', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /Calibration points must be distinct/);
      return true;
    }
  );
});

test('skin_signature.py fails clearly on non-numeric arguments', () => {
  assert.throws(
    () => execFileSync(PYTHON, [SCRIPT, GRID_10, '0', '0', '256', '256', '0', '0', 'abc', '0', '100'], { stdio: 'pipe' }),
    (err) => {
      assert.match(err.stderr.toString(), /must be numbers/);
      return true;
    }
  );
});
```

Note: this reuses `test/fixtures/test-blank.png`, already generated by the photo digitization sub-project's `test/fixtures/generate-test-image.py`. It's already checked into the repo at `test/fixtures/test-blank.png` — no regeneration needed.

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test test/skin-signature.test.js`
Expected: FAIL — `scripts/skin_signature.py` doesn't exist yet (ENOENT from `execFileSync`).

- [ ] **Step 5: Write `scripts/skin_signature.py`**

```python
#!/usr/bin/env python3
import sys
import json
import math
import cv2
import numpy as np

MIN_SIDE_PX = 32
MIN_R = 3
STD_DEV_THRESHOLD = 3.0
REF_WAVELENGTHS_MM = np.geomspace(0.5, 20, 40)


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 11:
        fail(
            "Usage: skin_signature.py <image_path> <roi_x> <roi_y> <roi_w> "
            "<roi_h> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>"
        )

    image_path = sys.argv[1]
    try:
        roi_x, roi_y, roi_w, roi_h, p1x, p1y, p2x, p2y, real_distance_mm = (
            float(v) for v in sys.argv[2:11]
        )
    except ValueError:
        fail("Region and calibration values must be numbers.")

    values = (roi_x, roi_y, roi_w, roi_h, p1x, p1y, p2x, p2y, real_distance_mm)
    if not all(math.isfinite(v) for v in values) or real_distance_mm <= 0:
        fail("Region and calibration values must be finite, and the distance must be positive.")

    pixel_distance = math.hypot(p2x - p1x, p2y - p1y)
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")
    mm_per_px = real_distance_mm / pixel_distance

    roi_x, roi_y, roi_w, roi_h = (int(round(v)) for v in (roi_x, roi_y, roi_w, roi_h))
    if roi_w <= 0 or roi_h <= 0:
        fail("Selected region must have positive width and height.")

    image = cv2.imread(image_path)
    if image is None:
        fail("Could not read image file.")

    gray_full = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    img_h, img_w = gray_full.shape
    if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
        fail("Selected region falls outside the photo bounds.")

    roi = gray_full[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]

    # The radial-average step below is only meaningful for a square region
    # (a non-square 2D FFT's axes have different frequency scales, so
    # combining them into one radius is only valid when they match) — center-
    # crop to the largest square that fits.
    side = min(roi.shape)
    if side < MIN_SIDE_PX:
        fail(f"Selected region is too small — needs at least {MIN_SIDE_PX}x{MIN_SIDE_PX}px.")
    y0 = (roi.shape[0] - side) // 2
    x0 = (roi.shape[1] - side) // 2
    square = roi[y0:y0 + side, x0:x0 + side].astype(np.float64)

    if square.std() < STD_DEV_THRESHOLD:
        fail("Selected region has too little contrast to detect a scale pattern.")

    # Hann window tapers the crop's edges to zero, avoiding the spurious
    # frequencies a hard rectangular crop would introduce.
    window = np.outer(np.hanning(side), np.hanning(side))
    windowed = square * window

    fshift = np.fft.fftshift(np.fft.fft2(windowed))
    power = np.abs(fshift) ** 2

    center = side // 2
    yy, xx = np.indices((side, side))
    r = np.hypot(xx - center, yy - center).astype(int)

    radial_sum = np.bincount(r.ravel(), power.ravel())
    radial_count = np.bincount(r.ravel())
    radial_profile = radial_sum / np.maximum(radial_count, 1)

    # Bins below MIN_R reflect large-scale brightness gradients across the
    # photo (near-DC energy), not scale texture — excluded from peak-finding.
    max_r = side // 2
    candidate_r = np.arange(MIN_R, max_r)
    peak_r = candidate_r[np.argmax(radial_profile[MIN_R:max_r])]
    dominant_wavelength_mm = (side / peak_r) * mm_per_px

    # Convert every non-DC bin's wavelength to mm, then resample onto a
    # fixed log-spaced grid (REF_WAVELENGTHS_MM) so any two skins' spectra
    # are directly comparable position-by-position regardless of the ROI's
    # pixel size or the photo's calibration scale.
    r_bins = np.arange(1, max_r)
    wavelength_mm = (side / r_bins) * mm_per_px
    power_bins = radial_profile[1:max_r]
    order = np.argsort(wavelength_mm)
    wavelength_sorted = wavelength_mm[order]
    power_sorted = power_bins[order]

    resampled = np.interp(
        REF_WAVELENGTHS_MM,
        wavelength_sorted,
        power_sorted,
        left=power_sorted[0],
        right=power_sorted[-1],
    )
    peak = resampled.max()
    if peak > 0:
        resampled = resampled / peak

    print(json.dumps({
        "dominantWavelengthMm": dominant_wavelength_mm,
        "radialSpectrum": resampled.tolist(),
    }))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/skin-signature.test.js`
Expected: PASS, 7/7 tests green.

- [ ] **Step 7: Commit**

```bash
git add scripts/skin_signature.py test/fixtures/generate-periodic-test-image.py test/fixtures/test-grid-10px.png test/fixtures/test-grid-20px.png test/fixtures/test-grid-10px-rotated.png test/skin-signature.test.js
git commit -m "feat: add skin scale-pattern signature script (2D FFT via OpenCV)"
```

---

### Task 2: `src/skins/similarity.js`

**Files:**
- Create: `src/skins/similarity.js`
- Create: `test/similarity.test.js`

**Interfaces:**
- Consumes: nothing (pure JS, no image work — operates on plain `{ id, species, dominantWavelengthMm, radialSpectrum }` objects)
- Produces:
  - `scaleDifferenceMm(a, b)` → `number` — `Math.abs` of the two signatures' `dominantWavelengthMm`.
  - `spectrumCorrelation(a, b)` → `number` in `[-1, 1]` — Pearson correlation of two equal-length `radialSpectrum` arrays.
  - `rankMatches(skins)` → `Array<{ species: string, pairs: Array<{ skinAId, skinBId, scaleDifferenceMm, spectrumCorrelation }> }>` — groups `skins` by `species` (trimmed, lowercased), and within each group returns every pair sorted by `scaleDifferenceMm` ascending. These three exports are what Task 4's `GET /skins/matches` route calls directly.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/similarity.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleDifferenceMm, spectrumCorrelation, rankMatches } from '../src/skins/similarity.js';

test('scaleDifferenceMm returns the absolute difference in mm', () => {
  assert.equal(scaleDifferenceMm({ dominantWavelengthMm: 5 }, { dominantWavelengthMm: 8 }), 3);
  assert.equal(scaleDifferenceMm({ dominantWavelengthMm: 8 }, { dominantWavelengthMm: 5 }), 3);
});

test('spectrumCorrelation returns 1 for identical spectra', () => {
  const spectrum = [0.1, 0.5, 1.0, 0.3, 0.05];
  assert.ok(Math.abs(spectrumCorrelation(spectrum, spectrum) - 1) < 1e-9);
});

test('spectrumCorrelation returns -1 for inverted spectra', () => {
  const a = [0, 1, 2, 3, 4];
  const b = [4, 3, 2, 1, 0];
  assert.ok(Math.abs(spectrumCorrelation(a, b) - -1) < 1e-9);
});

test('spectrumCorrelation is lower for clearly different spectra than for near-identical ones', () => {
  const a = [1, 0, 0, 0, 0];
  const b = [0.9, 0.1, 0, 0, 0];
  const c = [0, 0, 0, 0, 1];
  assert.ok(spectrumCorrelation(a, b) > spectrumCorrelation(a, c));
});

test('rankMatches groups by species (case-insensitive/trimmed) and sorts pairs ascending by scale difference', () => {
  const skins = [
    { id: 'a1', species: 'Cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0, 0] },
    { id: 'a2', species: ' cayman ', dominantWavelengthMm: 4.5, radialSpectrum: [1, 0, 0] },
    { id: 'a3', species: 'cayman', dominantWavelengthMm: 9.0, radialSpectrum: [1, 0, 0] },
    { id: 'b1', species: 'Crocodile', dominantWavelengthMm: 4.1, radialSpectrum: [1, 0, 0] },
  ];

  const groups = rankMatches(skins);
  const caymanGroup = groups.find((g) => g.species === 'cayman');
  const crocGroup = groups.find((g) => g.species === 'crocodile');

  assert.equal(caymanGroup.pairs.length, 3);
  assert.equal(crocGroup.pairs.length, 0);
  assert.ok(caymanGroup.pairs[0].scaleDifferenceMm <= caymanGroup.pairs[1].scaleDifferenceMm);
  assert.ok(caymanGroup.pairs[1].scaleDifferenceMm <= caymanGroup.pairs[2].scaleDifferenceMm);
  assert.equal(caymanGroup.pairs[0].scaleDifferenceMm, 0.5); // a1 vs a2, the closest pair
});

test('rankMatches never produces a cross-species pair', () => {
  const skins = [
    { id: 'a1', species: 'cayman', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0] },
    { id: 'b1', species: 'crocodile', dominantWavelengthMm: 4.0, radialSpectrum: [1, 0] },
  ];
  const groups = rankMatches(skins);
  for (const group of groups) {
    assert.equal(group.pairs.length, 0);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/similarity.test.js`
Expected: FAIL — `src/skins/similarity.js` doesn't exist yet.

- [ ] **Step 3: Write `src/skins/similarity.js`**

```javascript
export function scaleDifferenceMm(a, b) {
  return Math.abs(a.dominantWavelengthMm - b.dominantWavelengthMm);
}

export function spectrumCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  const meanA = a.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.slice(0, n).reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }

  const denominator = Math.sqrt(sumSqA) * Math.sqrt(sumSqB);
  return denominator > 0 ? numerator / denominator : 0;
}

export function rankMatches(skins) {
  const groups = new Map();
  for (const skin of skins) {
    const key = skin.species.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(skin);
  }

  const result = [];
  for (const [species, group] of groups) {
    const pairs = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        pairs.push({
          skinAId: a.id,
          skinBId: b.id,
          scaleDifferenceMm: scaleDifferenceMm(a, b),
          spectrumCorrelation: spectrumCorrelation(a.radialSpectrum, b.radialSpectrum),
        });
      }
    }
    pairs.sort((x, y) => x.scaleDifferenceMm - y.scaleDifferenceMm);
    result.push({ species, pairs });
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/similarity.test.js`
Expected: PASS, 6/6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/skins/similarity.js test/similarity.test.js
git commit -m "feat: add pure-JS skin similarity ranking (scale difference + spectrum correlation)"
```

---

### Task 3: `src/skins/store.js`

**Files:**
- Create: `src/skins/store.js`
- Create: `test/skins-store.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `createStore(dataDir)` → `{ list, create, remove, photoPath }`:
  - `list()` → array of stored records, sorted by `createdAt` ascending.
  - `create({ label, species, dominantWavelengthMm, radialSpectrum, photoPath, photoExt })` → the created record (adds `id` via `crypto.randomUUID()` and `createdAt`), copies the file at `photoPath` into the store.
  - `remove(id)` → `boolean`, `true` if a record was deleted.
  - `photoPath(id)` → the stored photo's absolute path, or `null` if `id` doesn't resolve to a real record (this is also where path-traversal-shaped ids like `../../etc/passwd` get rejected — the one place all three read/write paths route through, so every caller gets the guard for free).
  - Task 4's server routes call all four functions; Task 4's test file relies on `remove`/`photoPath` returning falsy for unknown/unsafe ids to produce 404s.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/skins-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/skins/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skins-store-test-'));
}

function makeTmpPhoto(dir) {
  const photoPath = path.join(dir, 'source.jpg');
  fs.writeFileSync(photoPath, 'fake-photo-bytes');
  return photoPath;
}

test('create() writes a JSON record and copies the photo, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const record = store.create({
    label: 'Cayman #1',
    species: 'cayman',
    dominantWavelengthMm: 4.2,
    radialSpectrum: [0.1, 0.5, 1.0],
    photoPath,
    photoExt: '.jpg',
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.label, 'Cayman #1');

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);
  assert.ok(fs.existsSync(path.join(dataDir, `${record.id}${record.photoExt}`)));

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes both files and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({
    label: 'Croc #1',
    species: 'crocodile',
    dominantWavelengthMm: 6.1,
    radialSpectrum: [0.2],
    photoPath,
    photoExt: '.jpg',
  });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);
  assert.equal(store.remove('does-not-exist'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('photoPath() and remove() reject ids shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.photoPath('../../etc/passwd'), null);
  assert.equal(store.remove('../../etc/passwd'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/skins-store.test.js`
Expected: FAIL — `src/skins/store.js` doesn't exist yet.

- [ ] **Step 3: Write `src/skins/store.js`**

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

  function readRecord(id) {
    if (!SAFE_ID.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  function list() {
    ensureDir();
    return fs
      .readdirSync(dataDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function create({ label, species, dominantWavelengthMm, radialSpectrum, photoPath, photoExt }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      label,
      species,
      dominantWavelengthMm,
      radialSpectrum,
      photoExt,
      createdAt: new Date().toISOString(),
    };
    fs.copyFileSync(photoPath, path.join(dataDir, `${id}${photoExt}`));
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function remove(id) {
    const record = readRecord(id);
    if (!record) return false;
    fs.unlinkSync(recordPath(id));
    const photo = path.join(dataDir, `${id}${record.photoExt}`);
    if (fs.existsSync(photo)) fs.unlinkSync(photo);
    return true;
  }

  function photoPath(id) {
    const record = readRecord(id);
    return record ? path.join(dataDir, `${id}${record.photoExt}`) : null;
  }

  return { list, create, remove, photoPath };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/skins-store.test.js`
Expected: PASS, 3/3 tests green.

- [ ] **Step 5: Add `data/` to `.gitignore`**

Add a line to the existing `.gitignore`:

```
node_modules/
venv/
data/
```

- [ ] **Step 6: Commit**

```bash
git add src/skins/store.js test/skins-store.test.js .gitignore
git commit -m "feat: add file-based skin inventory store"
```

---

### Task 4: `server.js` — `/skins` routes

**Files:**
- Modify: `server.js`
- Create: `test/skins-route.test.js`

**Interfaces:**
- Consumes: `scripts/skin_signature.py`'s CLI contract (Task 1), `createStore` (Task 3), `rankMatches` (Task 2)
- Produces: `createServer({ dataDir } = {})` — `dataDir` defaults to `<project root>/data/skins`; tests override it with a temp directory so runs don't touch or depend on real inventory data. Route contract:
  - `POST /skins` — multipart fields `photo` (file), `label`, `species`, `roiX`, `roiY`, `roiWidth`, `roiHeight`, `p1x`, `p1y`, `p2x`, `p2y`, `realDistanceMm` → `200` with the created record, `422 {"error": "..."}` on a signature-computation failure, `400 {"error": "..."}` on a malformed upload or missing `label`/`species`.
  - `GET /skins` → `200` with an array of all stored records.
  - `GET /skins/:id/photo` → `200` with the stored photo bytes (correct `Content-Type`), `404` if `id` is unknown.
  - `DELETE /skins/:id` → `204` on success, `404` if `id` is unknown.
  - `GET /skins/matches` → `200` with `rankMatches(store.list())`.

- [ ] **Step 1: Write the failing test file**

```javascript
// test/skins-route.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'test-grid-10px.png');

async function withServer(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-route-test-'));
  const server = createServer({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function postSkin(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(FIXTURE);
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'skin.png');
  const fields = {
    label: 'Test Skin',
    species: 'cayman',
    roiX: 0,
    roiY: 0,
    roiWidth: 256,
    roiHeight: 256,
    p1x: 0,
    p1y: 0,
    p2x: 100,
    p2y: 0,
    realDistanceMm: 100,
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/skins`, { method: 'POST', body: formData });
}

test('POST /skins creates a skin and GET /skins lists it', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await postSkin(baseUrl);
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.id);
    assert.ok(created.dominantWavelengthMm > 0);

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('GET /skins/:id/photo serves the stored photo', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    const response = await fetch(`${baseUrl}/skins/${created.id}/photo`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });
});

test('GET /skins/:id/photo returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/skins/does-not-exist/photo`);
    assert.equal(response.status, 404);
  });
});

test('DELETE /skins/:id removes it, GET /skins no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSkin(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/skins/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/skins`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /skins/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/skins/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});

test('GET /skins/matches groups same-species pairs and excludes cross-species pairs', async () => {
  await withServer(async (baseUrl) => {
    await postSkin(baseUrl, { label: 'Cayman A', species: 'cayman' });
    await postSkin(baseUrl, { label: 'Cayman B', species: 'cayman' });
    await postSkin(baseUrl, { label: 'Croc A', species: 'crocodile' });

    const matches = await (await fetch(`${baseUrl}/skins/matches`)).json();
    assert.equal(matches.find((g) => g.species === 'cayman').pairs.length, 1);
    assert.equal(matches.find((g) => g.species === 'crocodile').pairs.length, 0);
  });
});

test('POST /skins returns 422 with a clear error when the region is too small', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { roiWidth: 5, roiHeight: 5 });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /too small/);
  });
});

test('POST /skins returns 400 when label is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSkin(baseUrl, { label: '' });
    assert.equal(response.status, 400);
  });
});

test('GET / still serves the static site (existing behavior preserved)', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/skins-route.test.js`
Expected: FAIL — `createServer` doesn't accept a `dataDir` option yet and there are no `/skins` routes.

- [ ] **Step 3: Rewrite `server.js`**

```javascript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import formidable from 'formidable';
import { createStore } from './src/skins/store.js';
import { rankMatches } from './src/skins/similarity.js';

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
  return form.parse(req).then(([fields, files]) => ({ fields, files }));
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

export function createServer({ dataDir = path.join(__dirname, 'data', 'skins') } = {}) {
  const skins = createSkinsRoutes(dataDir);

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
    const deleteMatch = req.method === 'DELETE' && req.url.match(/^\/skins\/([^/]+)$/);
    if (deleteMatch) {
      skins.handleDeleteSkin(req, res, deleteMatch[1]);
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

Note: `handleDigitize` is factored to use the new `parseForm`/`cleanupFiles`/`sendJSON` helpers instead of its previous inline `formidable`/`res.writeHead` calls — this is a small dedup since `handleCreateSkin` needs the identical upload-parsing and JSON-response boilerplate. Its external behavior (status codes, error message text) is unchanged, so `test/digitize-route.test.js` needs no changes.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test test/skins-route.test.js`
Expected: PASS, 9/9 tests green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all prior tests (21) plus 7 from Task 1 + 6 from Task 2 + 3 from Task 3 + 9 from Task 4 = 46/46 pass.

- [ ] **Step 6: Commit**

```bash
git add server.js test/skins-route.test.js
git commit -m "feat: add /skins routes (create/list/delete/matches/photo)"
```

---

### Task 5: `src/region-select-ui.js`

**Files:**
- Create: `src/region-select-ui.js`
- No automated test — browser-only UI, matching the established precedent for `src/calibration-ui.js` (also untested for the same reason: it's pure DOM/canvas event wiring, no logic to unit-test in isolation).

**Interfaces:**
- Consumes: nothing
- Produces: `attachRegionSelect(container, imgSrc, onComplete)` — renders the image with a drag-to-draw-a-rectangle overlay, calling `onComplete({ roiX, roiY, roiWidth, roiHeight })` once a rectangle of at least 1x1 natural pixels is drawn, in the image's natural pixel coordinates. Task 6's `match-skins-app.js` calls this after `attachCalibration` completes, on the same image.

- [ ] **Step 1: Write `src/region-select-ui.js`**

```javascript
export function attachRegionSelect(container, imgSrc, onComplete) {
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

  let dragStart = null;
  let dragEnd = null;

  function resizeOverlay() {
    overlay.width = img.clientWidth;
    overlay.height = img.clientHeight;
  }

  function toNatural(displayX, displayY) {
    return {
      x: (displayX / overlay.width) * img.naturalWidth,
      y: (displayY / overlay.height) * img.naturalHeight,
    };
  }

  function displayPoint(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function drawRect() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!dragStart || !dragEnd) return;
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  img.addEventListener('load', resizeOverlay);
  window.addEventListener('resize', resizeOverlay);

  overlay.addEventListener('mousedown', (event) => {
    dragStart = displayPoint(event);
    dragEnd = dragStart;
    drawRect();
  });

  overlay.addEventListener('mousemove', (event) => {
    if (!dragStart) return;
    dragEnd = displayPoint(event);
    drawRect();
  });

  overlay.addEventListener('mouseup', (event) => {
    if (!dragStart) return;
    dragEnd = displayPoint(event);
    drawRect();

    const startNatural = toNatural(dragStart.x, dragStart.y);
    const endNatural = toNatural(dragEnd.x, dragEnd.y);
    dragStart = null;

    const roiX = Math.min(startNatural.x, endNatural.x);
    const roiY = Math.min(startNatural.y, endNatural.y);
    const roiWidth = Math.abs(endNatural.x - startNatural.x);
    const roiHeight = Math.abs(endNatural.y - startNatural.y);

    if (roiWidth < 1 || roiHeight < 1) return;

    onComplete({ roiX, roiY, roiWidth, roiHeight });
  });
}
```

- [ ] **Step 2: Run the full automated suite**

Run: `npm test`
Expected: 46/46 passing (unchanged — this task adds no automated tests).

- [ ] **Step 3: Commit**

```bash
git add src/region-select-ui.js
git commit -m "feat: add drag-to-select-region UI"
```

---

### Task 6: `public/match-skins.html` + `src/match-skins-app.js`

**Files:**
- Create: `public/match-skins.html`
- Create: `src/match-skins-app.js`
- No automated test — browser-only UI, per this project's established precedent (Task 4 of the digitization plan was manual-verification only for the same reason).

**Interfaces:**
- Consumes: `attachCalibration` (existing, unchanged), `attachRegionSelect` (Task 5), `POST /skins`, `GET /skins`, `GET /skins/:id/photo`, `DELETE /skins/:id`, `GET /skins/matches` (Task 4)
- Produces: nothing further consumed by other tasks — this is the last task in the plan.

- [ ] **Step 1: Write `public/match-skins.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>leather-nest — match skins</title>
  </head>
  <body>
    <h1>Skin inventory &amp; matching</h1>

    <section>
      <h2>Add a skin</h2>
      <p>Upload a photo, click two points on a ruler for calibration, drag a rectangle over the sample panel area, then label it.</p>
      <input type="file" id="photo-input" accept="image/*" />
      <div id="calibration-container"></div>
      <div id="region-container"></div>
      <div id="add-form" style="display: none">
        <label>Label: <input type="text" id="label-input" /></label>
        <label>Species: <input type="text" id="species-input" /></label>
        <button type="button" id="submit-skin">Add to inventory</button>
      </div>
      <div id="add-status"></div>
    </section>

    <section>
      <h2>Inventory</h2>
      <button type="button" id="refresh-inventory">Refresh</button>
      <div id="inventory"></div>
    </section>

    <section>
      <h2>Matches</h2>
      <button type="button" id="refresh-matches">Find matches</button>
      <div id="matches"></div>
    </section>

    <script type="module" src="/src/match-skins-app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/match-skins-app.js`**

```javascript
import { attachCalibration } from './calibration-ui.js';
import { attachRegionSelect } from './region-select-ui.js';

const photoInput = document.getElementById('photo-input');
const calibrationContainer = document.getElementById('calibration-container');
const regionContainer = document.getElementById('region-container');
const addForm = document.getElementById('add-form');
const labelInput = document.getElementById('label-input');
const speciesInput = document.getElementById('species-input');
const submitButton = document.getElementById('submit-skin');
const addStatus = document.getElementById('add-status');
const inventoryEl = document.getElementById('inventory');
const matchesEl = document.getElementById('matches');

let selectedFile = null;
let calibration = null;
let region = null;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  selectedFile = file;
  calibration = null;
  region = null;
  addForm.style.display = 'none';
  addStatus.textContent = '';
  regionContainer.innerHTML = '';

  const objectUrl = URL.createObjectURL(file);
  attachCalibration(calibrationContainer, objectUrl, (calibrationResult) => {
    calibration = calibrationResult;
    attachRegionSelect(regionContainer, objectUrl, (regionResult) => {
      region = regionResult;
      addForm.style.display = 'block';
    });
  });
});

submitButton.addEventListener('click', async () => {
  if (!selectedFile || !calibration || !region) return;
  const label = labelInput.value.trim();
  const species = speciesInput.value.trim();
  if (!label || !species) {
    addStatus.textContent = 'Label and species are required.';
    return;
  }

  addStatus.textContent = 'Computing signature…';

  const formData = new FormData();
  formData.append('photo', selectedFile);
  formData.append('label', label);
  formData.append('species', species);
  formData.append('roiX', region.roiX);
  formData.append('roiY', region.roiY);
  formData.append('roiWidth', region.roiWidth);
  formData.append('roiHeight', region.roiHeight);
  formData.append('p1x', calibration.p1x);
  formData.append('p1y', calibration.p1y);
  formData.append('p2x', calibration.p2x);
  formData.append('p2y', calibration.p2y);
  formData.append('realDistanceMm', calibration.realDistanceMm);

  try {
    const response = await fetch('/skins', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) {
      addStatus.textContent = `Error: ${body.error}`;
      return;
    }
    addStatus.textContent = `Added "${body.label}" — ${body.dominantWavelengthMm.toFixed(2)}mm scale.`;
    labelInput.value = '';
    speciesInput.value = '';
    addForm.style.display = 'none';
    loadInventory();
  } catch {
    addStatus.textContent = 'Error: could not reach the server. Please try again.';
  }
});

async function loadInventory() {
  const response = await fetch('/skins');
  const skins = await response.json();
  inventoryEl.innerHTML = skins
    .map(
      (skin) => `
    <div>
      <img src="/skins/${skin.id}/photo" width="80" height="80" style="object-fit: cover" />
      <strong>${escapeHtml(skin.label)}</strong> (${escapeHtml(skin.species)}) — ${skin.dominantWavelengthMm.toFixed(2)}mm
      <button type="button" data-delete-id="${skin.id}">Delete</button>
    </div>
  `
    )
    .join('');
}

inventoryEl.addEventListener('click', async (event) => {
  const id = event.target.dataset.deleteId;
  if (!id) return;
  await fetch(`/skins/${id}`, { method: 'DELETE' });
  loadInventory();
});

document.getElementById('refresh-inventory').addEventListener('click', loadInventory);

document.getElementById('refresh-matches').addEventListener('click', async () => {
  const response = await fetch('/skins/matches');
  const groups = await response.json();
  matchesEl.innerHTML = groups
    .map(
      (group) => `
    <h3>${escapeHtml(group.species)}</h3>
    <ul>
      ${group.pairs
        .map(
          (pair) =>
            `<li>${pair.skinAId.slice(0, 8)} &harr; ${pair.skinBId.slice(0, 8)}: ${pair.scaleDifferenceMm.toFixed(2)}mm difference, correlation ${pair.spectrumCorrelation.toFixed(2)}</li>`
        )
        .join('')}
    </ul>
  `
    )
    .join('');
});

loadInventory();
```

- [ ] **Step 3: Run the full automated suite**

Run: `npm test`
Expected: 46/46 passing (unchanged — this task adds no automated tests).

- [ ] **Step 4: Manually verify the end-to-end loop**

Run: `npm start`

Then:
1. Open `http://localhost:8080/match-skins.html`.
2. Upload a photo with a visible scaled texture (or, for a first smoke test, one of the generated fixtures like `test/fixtures/test-grid-10px.png` — resembles a regular dot pattern, good enough to prove the pipeline end-to-end) and something of known length in frame for calibration.
3. Click two calibration points, enter the real distance, submit the calibration.
4. Drag a rectangle over the sample region.
5. Enter a label and species, click "Add to inventory."
6. Confirm a status message with a plausible mm scale appears, and the inventory list below shows the new entry with its thumbnail.
7. Repeat with a second photo of the **same species** and a third of a **different species**.
8. Click "Find matches" and confirm: the same-species pair appears with a scale difference and correlation number, and the different-species skin does not appear paired with either.
9. Delete one skin and confirm it disappears from the inventory list on refresh.
10. Try a deliberately bad case (e.g. drag a tiny sliver of a region, or a blank patch) and confirm a clear error message appears instead of a broken result.
11. Stop the server (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add public/match-skins.html src/match-skins-app.js
git commit -m "feat: add skin matching browser UI"
```
</content>
