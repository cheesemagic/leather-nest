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
  return withServerBase(fn, { withPartsDataDir: true });
}

async function postPartSvg(baseUrl, overrides = {}) {
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Vamp');
  formData.append('svg', new Blob([overrides.svgContent ?? SVG_CONTENT]), 'part.svg');
  return fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
}

async function postPartPhoto(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(PHOTO_FIXTURE);
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Quarter');
  formData.append('photo', new Blob([fileBuffer]), 'part.png');
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
  return fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
}

async function postPartDimensions(baseUrl, overrides = {}) {
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Belt keeper 35mm');
  const fields = { widthMm: 35, heightMm: 12, ...overrides.fields };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, String(value));
  }
  return fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
}

function updatePart(baseUrl, id, body) {
  return fetch(`${baseUrl}/parts/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /parts via SVG upload creates a part and GET /parts lists it', async () => {
  await withServer(async (baseUrl) => {
    const createResponse = await postPartSvg(baseUrl);
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.ok(created.id);
    assert.deepEqual(created.polygon, [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
    ]);

    const list = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('POST /parts via photo digitizes the part and creates a record', async () => {
  await withServer(async (baseUrl) => {
    const response = await postPartPhoto(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(created.id);
    assert.ok(Array.isArray(created.polygon));
    assert.ok(created.polygon.length >= 3);
  });
});

test('POST /parts via photo returns 400 when the region is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postPartPhoto(baseUrl, { roi: null });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /roiX, roiY, roiWidth, and roiHeight are required/);
  });
});

test('POST /parts returns 422 with a clear error for a malformed SVG', async () => {
  await withServer(async (baseUrl) => {
    const response = await postPartSvg(baseUrl, { svgContent: '<rect width="10" height="10" />' });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /No <polygon points/);
  });
});

test('POST /parts returns 400 when name is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postPartSvg(baseUrl, { name: '' });
    assert.equal(response.status, 400);
  });
});

test('POST /parts returns 400 when neither svg nor photo is provided', async () => {
  await withServer(async (baseUrl) => {
    const formData = new FormData();
    formData.append('name', 'Empty');
    const response = await fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
    assert.equal(response.status, 400);
  });
});

test('DELETE /parts/:id removes it, GET /parts no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartSvg(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/parts/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /parts/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/parts/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});

test('POST /parts via dimensions creates a rectangle of the requested size', async () => {
  await withServer(async (baseUrl) => {
    const response = await postPartDimensions(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();

    const xs = created.polygon.map((p) => p.x);
    const ys = created.polygon.map((p) => p.y);
    assert.equal(Math.max(...xs) - Math.min(...xs), 35);
    assert.equal(Math.max(...ys) - Math.min(...ys), 12);
    assert.equal(created.polygon.length, 4);
  });
});

test('POST /parts carries the component metadata through on every creation mode', async () => {
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

    const fromDimensions = await (await postPartDimensions(baseUrl, { fields: { widthMm: 35, heightMm: 12, ...metadata } })).json();
    assert.equal(fromDimensions.valuePerPiece, 1.25);
    assert.equal(fromDimensions.productFamily, 'belt');
    assert.deepEqual(fromDimensions.allowedSpecies, ['cayman', 'crocodile']);
    assert.equal(fromDimensions.thicknessMinMm, 1.2);
    assert.equal(fromDimensions.thicknessMaxMm, 2.4);
    assert.deepEqual(fromDimensions.allowedRotations, [0, 180]);
    assert.equal(fromDimensions.demand, 100);

    const svgFormData = new FormData();
    svgFormData.append('name', 'Tip accent');
    svgFormData.append('svg', new Blob([SVG_CONTENT]), 'part.svg');
    for (const [key, value] of Object.entries(metadata)) svgFormData.append(key, String(value));
    const fromSvg = await (await fetch(`${baseUrl}/parts`, { method: 'POST', body: svgFormData })).json();
    assert.equal(fromSvg.valuePerPiece, 1.25);
    assert.deepEqual(fromSvg.allowedSpecies, ['cayman', 'crocodile']);
  });
});

test('POST /parts defaults metadata when none is sent (existing callers unchanged)', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartSvg(baseUrl)).json();
    assert.equal(created.valuePerPiece, null);
    assert.equal(created.allowedSpecies, null);
    assert.deepEqual(created.allowedRotations, [0, 90, 180, 270]);
    assert.equal(created.demand, 0);
  });
});

test('POST /parts returns 400 for a non-positive dimension', async () => {
  await withServer(async (baseUrl) => {
    const zero = await postPartDimensions(baseUrl, { fields: { widthMm: 0, heightMm: 12 } });
    assert.equal(zero.status, 400);
    assert.match((await zero.json()).error, /widthMm/);

    const negative = await postPartDimensions(baseUrl, { fields: { widthMm: 35, heightMm: -4 } });
    assert.equal(negative.status, 400);

    const missing = await postPartDimensions(baseUrl, { fields: { widthMm: 35, heightMm: undefined } });
    assert.equal(missing.status, 400);
  });
});

test('POST /parts/:id updates metadata but not geometry', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();

    const response = await updatePart(baseUrl, created.id, {
      valuePerPiece: 2.5,
      demand: 40,
      polygon: [{ x: 0, y: 0 }],
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.valuePerPiece, 2.5);
    assert.equal(updated.demand, 40);
    assert.deepEqual(updated.polygon, created.polygon);

    const listed = (await (await fetch(`${baseUrl}/parts`)).json()).find((d) => d.id === created.id);
    assert.equal(listed.valuePerPiece, 2.5);
  });
});

test('POST /parts/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await updatePart(baseUrl, 'does-not-exist', { demand: 1 })).status, 404);
  });
});

test('POST /parts/:id returns 400 for a blank name', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();
    const response = await updatePart(baseUrl, created.id, { name: '   ' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /name/);
  });
});

test('POST /parts/:id returns 400 for a string valuePerPiece', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();
    const response = await updatePart(baseUrl, created.id, { valuePerPiece: '12.50' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valuePerPiece/);
  });
});

test('POST /parts/:id accepts a null valuePerPiece to clear it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl, { fields: { widthMm: 35, heightMm: 12, valuePerPiece: 5 } })).json();
    assert.equal(created.valuePerPiece, 5);

    const response = await updatePart(baseUrl, created.id, { valuePerPiece: null });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.valuePerPiece, null);
  });
});

test('POST /parts/:id returns 400 for an empty allowedRotations array', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();
    const response = await updatePart(baseUrl, created.id, { allowedRotations: [] });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowedRotations/);
  });
});

test('POST /parts/:id returns 400 for a negative thickness bound', async () => {
  // The inverted-range check below only catches min > max, so a LONE negative
  // slipped through and was stored: POST { thicknessMinMm: -5 } used to
  // return 200. A thickness is a magnitude; it cannot be negative.
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();

    const min = await updatePart(baseUrl, created.id, { thicknessMinMm: -5 });
    assert.equal(min.status, 400);
    assert.match((await min.json()).error, /thicknessMinMm/);

    const max = await updatePart(baseUrl, created.id, { thicknessMaxMm: -1 });
    assert.equal(max.status, 400);
    assert.match((await max.json()).error, /thicknessMaxMm/);
  });
});

test('POST /parts rejects a negative magnitude at creation too', async () => {
  // The create path is the back door: numberOrNull passes -5 straight
  // through, so without a guard a component could be CREATED with a negative
  // thickness or price that the update route would refuse to set.
  await withServer(async (baseUrl) => {
    const negThickness = await postPartDimensions(baseUrl, {
      fields: { widthMm: 35, heightMm: 12, thicknessMinMm: -5 },
    });
    assert.equal(negThickness.status, 400);
    assert.match((await negThickness.json()).error, /thicknessMinMm/);

    const negValue = await postPartDimensions(baseUrl, {
      fields: { widthMm: 35, heightMm: 12, valuePerPiece: -2 },
    });
    assert.equal(negValue.status, 400);
    assert.match((await negValue.json()).error, /valuePerPiece/);

    // A legitimate component still creates cleanly.
    const ok = await postPartDimensions(baseUrl, {
      fields: { widthMm: 35, heightMm: 12, thicknessMinMm: 1.2, thicknessMaxMm: 2.4 },
    });
    assert.equal(ok.status, 200);
  });
});

test('POST /parts/:id returns 400 for an inverted thickness range', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();

    const bothAtOnce = await updatePart(baseUrl, created.id, { thicknessMinMm: 3, thicknessMaxMm: 1 });
    assert.equal(bothAtOnce.status, 400);
    assert.match((await bothAtOnce.json()).error, /thicknessMinMm/);

    // Partial update: raising the stored min above the stored max should
    // also be rejected, not just an inversion sent in one request.
    const seeded = await (await postPartDimensions(baseUrl, {
      fields: { widthMm: 35, heightMm: 12, thicknessMinMm: 1, thicknessMaxMm: 2 },
    })).json();
    const partial = await updatePart(baseUrl, seeded.id, { thicknessMinMm: 5 });
    assert.equal(partial.status, 400);
  });
});

test('POST /parts/:id accepts a valid update end to end', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();

    const response = await updatePart(baseUrl, created.id, {
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

    const listed = (await (await fetch(`${baseUrl}/parts`)).json()).find((d) => d.id === created.id);
    assert.equal(listed.name, 'Belt keeper 35mm v2');
  });
});

test('POST /parts/:id accepts dieClearanceMm, including 0 and null', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();
    assert.equal(created.dieClearanceMm, null, 'new components own no die');

    const set = await updatePart(baseUrl, created.id, { dieClearanceMm: 8 });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).dieClearanceMm, 8);

    // A die needing no margin. Must not be coerced to null.
    const zero = await updatePart(baseUrl, created.id, { dieClearanceMm: 0 });
    assert.equal(zero.status, 200);
    assert.equal((await zero.json()).dieClearanceMm, 0);

    const cleared = await updatePart(baseUrl, created.id, { dieClearanceMm: null });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).dieClearanceMm, null);
  });
});

test('POST /parts/:id returns 400 for a string or negative dieClearanceMm', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postPartDimensions(baseUrl)).json();

    const asString = await updatePart(baseUrl, created.id, { dieClearanceMm: '8' });
    assert.equal(asString.status, 400);
    assert.match((await asString.json()).error, /dieClearanceMm/);

    const negative = await updatePart(baseUrl, created.id, { dieClearanceMm: -1 });
    assert.equal(negative.status, 400);
    assert.match((await negative.json()).error, /negative/);
  });
});
