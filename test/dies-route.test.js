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
  const roi =
    'roi' in overrides
      ? overrides.roi
      : { roiX: 0, roiY: 0, roiWidth: 400, roiHeight: 300 };
  for (const [key, value] of Object.entries(roi ?? {})) {
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
}

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

test('POST /dies via photo returns 400 when the region is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postDiePhoto(baseUrl, { roi: null });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /roiX, roiY, roiWidth, and roiHeight are required/);
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

test('POST /dies/:id returns 400 for a blank name', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();
    const response = await updateDie(baseUrl, created.id, { name: '   ' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /name/);
  });
});

test('POST /dies/:id returns 400 for a string valuePerPiece', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();
    const response = await updateDie(baseUrl, created.id, { valuePerPiece: '12.50' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valuePerPiece/);
  });
});

test('POST /dies/:id accepts a null valuePerPiece to clear it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl, { fields: { widthMm: 35, heightMm: 12, valuePerPiece: 5 } })).json();
    assert.equal(created.valuePerPiece, 5);

    const response = await updateDie(baseUrl, created.id, { valuePerPiece: null });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.valuePerPiece, null);
  });
});

test('POST /dies/:id returns 400 for an empty allowedRotations array', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();
    const response = await updateDie(baseUrl, created.id, { allowedRotations: [] });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowedRotations/);
  });
});

test('POST /dies/:id returns 400 for an inverted thickness range', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();

    const bothAtOnce = await updateDie(baseUrl, created.id, { thicknessMinMm: 3, thicknessMaxMm: 1 });
    assert.equal(bothAtOnce.status, 400);
    assert.match((await bothAtOnce.json()).error, /thicknessMinMm/);

    // Partial update: raising the stored min above the stored max should
    // also be rejected, not just an inversion sent in one request.
    const seeded = await (await postDieDimensions(baseUrl, {
      fields: { widthMm: 35, heightMm: 12, thicknessMinMm: 1, thicknessMaxMm: 2 },
    })).json();
    const partial = await updateDie(baseUrl, seeded.id, { thicknessMinMm: 5 });
    assert.equal(partial.status, 400);
  });
});

test('POST /dies/:id accepts a valid update end to end', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postDieDimensions(baseUrl)).json();

    const response = await updateDie(baseUrl, created.id, {
      name: 'Belt keeper 35mm v2',
      productFamily: 'belt',
      valuePerPiece: 1.5,
      demand: 10,
      allowedSpecies: ['Cayman', ' crocodile '],
      thicknessMinMm: 1,
      thicknessMaxMm: 2,
      allowedRotations: [0, 90],
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.name, 'Belt keeper 35mm v2');
    assert.equal(updated.productFamily, 'belt');
    assert.equal(updated.valuePerPiece, 1.5);
    assert.equal(updated.demand, 10);
    assert.deepEqual(updated.allowedSpecies, ['cayman', 'crocodile']);
    assert.equal(updated.thicknessMinMm, 1);
    assert.equal(updated.thicknessMaxMm, 2);
    assert.deepEqual(updated.allowedRotations, [0, 90]);

    const listed = (await (await fetch(`${baseUrl}/dies`)).json()).find((d) => d.id === created.id);
    assert.equal(listed.name, 'Belt keeper 35mm v2');
  });
});

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
