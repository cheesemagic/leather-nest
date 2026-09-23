import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';
import { polygonArea } from '../src/nesting/geometry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-canvas.png');

function withServer(fn) {
  return withServerBase(fn, { withDataDir: true, withPartsDataDir: true, withSessionsDataDir: true });
}

async function postSession(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(CANVAS);
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'skin.png');
  const calibration = { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100, ...overrides.calibration };
  for (const [key, value] of Object.entries(calibration)) formData.append(key, String(value));
  const roi = { roiX: 0, roiY: 0, roiWidth: 500, roiHeight: 500, ...overrides.roi };
  for (const [key, value] of Object.entries(roi)) formData.append(key, String(value));
  if (overrides.hideId) formData.append('hideId', overrides.hideId);
  return fetch(`${baseUrl}/sessions`, { method: 'POST', body: formData });
}

async function postOutlineHide(baseUrl, overrides = {}) {
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
  return (await fetch(`${baseUrl}/skins`, { method: 'POST', body: formData })).json();
}

function setStatus(baseUrl, id, status) {
  return fetch(`${baseUrl}/sessions/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

async function getHide(baseUrl, id) {
  const list = await (await fetch(`${baseUrl}/skins`)).json();
  return list.find((h) => h.id === id);
}

// Sends a status POST with the JSON body split into two writes with a delay
// between them, so the request handler's `for await` body-read genuinely
// suspends before either request's session lookup runs — reproducing the
// interleaving a double-click plus normal TCP chunking produces. Uses
// node:http directly because fetch won't let the body be split like this.
function postStatusSplit(baseUrl, id, status) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/sessions/${id}/status`);
    const body = JSON.stringify({ status });
    const mid = Math.ceil(body.length / 2);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.write(body.slice(0, mid));
    setTimeout(() => {
      req.write(body.slice(mid));
      req.end();
    }, 20);
  });
}

async function postPart(baseUrl) {
  const formData = new FormData();
  formData.append('name', 'Test part');
  formData.append('svg', new Blob(['<polygon points="0,0 60,0 60,40 0,40" />']), 'part.svg');
  const response = await fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
  return response.json();
}

test('POST /sessions creates a session and GET /sessions lists it', async () => {
  await withServer(async (baseUrl) => {
    const response = await postSession(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.ok(created.id);
    assert.deepEqual(created.placements, []);

    const list = await (await fetch(`${baseUrl}/sessions`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('GET /sessions/:id/photo serves the stored photo', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSession(baseUrl)).json();
    const response = await fetch(`${baseUrl}/sessions/${created.id}/photo`);
    assert.equal(response.status, 200);
  });
});

test('POST /sessions/:id/placements finds a match and appends it', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    const part = await postPart(baseUrl);

    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.placements.length, 1);
    assert.ok(updated.placements[0].match);
    assert.ok(Math.abs(updated.placements[0].match.x - 300) <= 2);
    assert.deepEqual(updated.placements[0].polygon, part.polygon);
  });
});

test('POST /sessions/:id/placements returns 404 for an unknown session', async () => {
  await withServer(async (baseUrl) => {
    const part = await postPart(baseUrl);
    const response = await fetch(`${baseUrl}/sessions/does-not-exist/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 404);
  });
});

test('POST /sessions/:id/placements returns 404 for an unknown part', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: 'does-not-exist', x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 404);
  });
});

test('POST /sessions/:id/placements returns 422 when the reference placement is invalid', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    const part = await postPart(baseUrl);
    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 480, y: 480, rotation: 0 }),
    });
    assert.equal(response.status, 422);
  });
});

test('DELETE /sessions/:id removes it, GET /sessions no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postSession(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/sessions/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);
    const list = await (await fetch(`${baseUrl}/sessions`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /sessions/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});

test('cutting a job decrements the linked hide, un-cutting restores it exactly', async () => {
  await withServer(async (baseUrl) => {
    const hide = await postOutlineHide(baseUrl);
    const session = await (await postSession(baseUrl, { hideId: hide.id })).json();
    const part = await postPart(baseUrl);
    await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 100, y: 100, rotation: 0 }),
    });

    assert.equal((await getHide(baseUrl, hide.id)).remainingAreaPct, 100);

    const cutResponse = await setStatus(baseUrl, session.id, 'cut');
    assert.equal(cutResponse.status, 200);
    const cut = await cutResponse.json();
    assert.equal(cut.status, 'cut');
    assert.ok(cut.cutAt);
    assert.ok(cut.consumedAreaMm2 > 0);

    const afterCut = (await getHide(baseUrl, hide.id)).remainingAreaPct;
    // 60x40 part (2400 mm²) with a matched twin -> 4800 mm² consumed, computed
    // independently of consumedAreaMm2 so a units regression can't hide.
    const hideArea = polygonArea(hide.outlinePolygon);
    const expected = 100 - (4800 / hideArea) * 100;
    assert.ok(
      Math.abs(afterCut - expected) < 0.01,
      `expected ~${expected}, got ${afterCut}`
    );

    const uncutResponse = await setStatus(baseUrl, session.id, 'draft');
    assert.equal(uncutResponse.status, 200);
    const uncut = await uncutResponse.json();
    assert.equal(uncut.status, 'draft');
    assert.equal(uncut.cutAt, null);
    assert.equal(uncut.consumedAreaMm2, null);

    assert.ok(Math.abs((await getHide(baseUrl, hide.id)).remainingAreaPct - 100) < 1e-9);
  });
});

test('deleting a cut job restores the hide area', async () => {
  await withServer(async (baseUrl) => {
    const hide = await postOutlineHide(baseUrl);
    const session = await (await postSession(baseUrl, { hideId: hide.id })).json();
    const part = await postPart(baseUrl);
    await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 100, y: 100, rotation: 0 }),
    });
    await setStatus(baseUrl, session.id, 'cut');
    assert.ok((await getHide(baseUrl, hide.id)).remainingAreaPct < 100);

    const deleteResponse = await fetch(`${baseUrl}/sessions/${session.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);
    assert.ok(Math.abs((await getHide(baseUrl, hide.id)).remainingAreaPct - 100) < 1e-9);
  });
});

test('invalid status transitions return 400 and leave the hide untouched', async () => {
  await withServer(async (baseUrl) => {
    const hide = await postOutlineHide(baseUrl);
    const session = await (await postSession(baseUrl, { hideId: hide.id })).json();

    assert.equal((await setStatus(baseUrl, session.id, 'draft')).status, 400);

    assert.equal((await setStatus(baseUrl, session.id, 'cut')).status, 200);
    const afterCut = (await getHide(baseUrl, hide.id)).remainingAreaPct;

    const doubleCut = await setStatus(baseUrl, session.id, 'cut');
    assert.equal(doubleCut.status, 400);
    assert.equal((await getHide(baseUrl, hide.id)).remainingAreaPct, afterCut);

    assert.equal((await setStatus(baseUrl, session.id, 'bogus')).status, 400);
  });
});

test('concurrent cut requests with the body split across chunks apply the decrement exactly once', async () => {
  await withServer(async (baseUrl) => {
    const hide = await postOutlineHide(baseUrl);
    const session = await (await postSession(baseUrl, { hideId: hide.id })).json();
    const part = await postPart(baseUrl);
    await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId: part.id, x: 100, y: 100, rotation: 0 }),
    });

    const [r1, r2] = await Promise.all([
      postStatusSplit(baseUrl, session.id, 'cut'),
      postStatusSplit(baseUrl, session.id, 'cut'),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 400], `expected one 200 and one 400, got ${statuses}`);

    const winner = r1.status === 200 ? r1.body : r2.body;
    const afterCut = (await getHide(baseUrl, hide.id)).remainingAreaPct;
    const hideArea = polygonArea(hide.outlinePolygon);
    const expected = 100 - (winner.consumedAreaMm2 / hideArea) * 100;
    assert.ok(
      Math.abs(afterCut - expected) < 1e-6,
      `expected a single decrement (${expected}), got ${afterCut} — looks like a double-subtract`
    );
  });
});

test('POST /sessions/:id/status returns 404 for an unknown session', async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await setStatus(baseUrl, 'does-not-exist', 'cut')).status, 404);
  });
});

test('a job with no hideId cuts cleanly with no decrement', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    assert.equal(session.hideId, null);
    const response = await setStatus(baseUrl, session.id, 'cut');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'cut');
  });
});

test('a job on a signature-only hide cuts cleanly with no decrement', async () => {
  await withServer(async (baseUrl) => {
    const fileBuffer = await readFile(path.join(__dirname, 'fixtures', 'test-grid-10px.png'));
    const formData = new FormData();
    formData.append('photo', new Blob([fileBuffer]), 'skin.png');
    for (const [key, value] of Object.entries({
      label: 'Signature Only',
      species: 'cayman',
      roiX: 0, roiY: 0, roiWidth: 256, roiHeight: 256,
      p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100,
    })) formData.append(key, String(value));
    const hide = await (await fetch(`${baseUrl}/skins`, { method: 'POST', body: formData })).json();
    assert.equal(hide.outlinePolygon, null);

    const session = await (await postSession(baseUrl, { hideId: hide.id })).json();
    const response = await setStatus(baseUrl, session.id, 'cut');
    assert.equal(response.status, 200);
    assert.equal((await getHide(baseUrl, hide.id)).remainingAreaPct, 100);
  });
});
