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
