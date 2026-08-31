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
