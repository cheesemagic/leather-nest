import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'test-grid-10px.png');

function withServer(fn) {
  return withServerBase(fn, { withDataDir: true });
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

test('POST /skins with captureType=outline and no ROI fields still succeeds (omits all four from args)', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, {
      roiX: undefined,
      roiY: undefined,
      roiWidth: undefined,
      roiHeight: undefined,
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
  });
});

test('POST /skins with captureType=outline and partial ROI fields behaves as no ROI (hasROI guard requires all four)', async () => {
  await withServer(async (baseUrl) => {
    const response = await postOutlineSkin(baseUrl, {
      roiX: 10,
      roiY: undefined,
      roiWidth: undefined,
      roiHeight: undefined,
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(Array.isArray(created.outlinePolygon));
    assert.ok(created.outlinePolygon.length >= 3);
    assert.equal(created.thicknessMm, 1.4);
  });
});
