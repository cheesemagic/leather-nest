import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer } from './helpers/with-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'test-rectangle.png');
const BLANK_FIXTURE = path.join(__dirname, 'fixtures', 'test-blank.png');

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

// The hide page previews with this endpoint and then saves through /skins.
// If the two disagree about the region, the operator confirms one outline and
// a different one is stored -- which would defeat the confirm step entirely.
test('POST /digitize honours the selected region, like /skins does', async () => {
  await withServer(async (baseUrl) => {
    // A region in the bottom-right quarter of test-rectangle.png, which holds
    // nothing but background. The rectangle lives at (100,100)-(299,199).
    const response = await postDigitize(baseUrl, FIXTURE, {
      p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100,
      roiX: 300, roiY: 200, roiWidth: 100, roiHeight: 100,
    });
    assert.equal(response.status, 422,
      'an empty region must be refused, not silently ignored and traced whole-photo');
    const body = await response.json();
    assert.match(body.error, /outline|region/i);
  });
});

test('POST /digitize reports the outline in whole-photo pixels for the preview', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDigitize(baseUrl, FIXTURE, {
      p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100,
      roiX: 50, roiY: 50, roiWidth: 300, roiHeight: 200,
    });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.photoWidth, 400, 'the whole photo, not the cropped region');
    assert.equal(body.photoHeight, 300);

    // The region starts at (50,50), so an outline reported in crop
    // coordinates would land 50px up and left of the real rectangle.
    const xs = body.polygonPx.map((p) => p.x);
    const ys = body.polygonPx.map((p) => p.y);
    assert.ok(Math.abs(Math.min(...xs) - 100) <= 3, `left edge ${Math.min(...xs)}, expected ~100`);
    assert.ok(Math.abs(Math.min(...ys) - 100) <= 3, `top edge ${Math.min(...ys)}, expected ~100`);
    assert.ok(Math.abs(Math.max(...xs) - 299) <= 3, `right edge ${Math.max(...xs)}, expected ~299`);
    assert.ok(Math.abs(Math.max(...ys) - 199) <= 3, `bottom edge ${Math.max(...ys)}, expected ~199`);
  });
});
