import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-canvas.png');

function withServer(fn) {
  return withServerBase(fn, { withDiesDataDir: true, withSessionsDataDir: true });
}

async function postSession(baseUrl, overrides = {}) {
  const fileBuffer = await readFile(CANVAS);
  const formData = new FormData();
  formData.append('photo', new Blob([fileBuffer]), 'skin.png');
  const calibration = { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100, ...overrides.calibration };
  for (const [key, value] of Object.entries(calibration)) formData.append(key, String(value));
  const roi = { roiX: 0, roiY: 0, roiWidth: 500, roiHeight: 500, ...overrides.roi };
  for (const [key, value] of Object.entries(roi)) formData.append(key, String(value));
  return fetch(`${baseUrl}/sessions`, { method: 'POST', body: formData });
}

async function postDie(baseUrl) {
  const formData = new FormData();
  formData.append('name', 'Test die');
  formData.append('svg', new Blob(['<polygon points="0,0 60,0 60,40 0,40" />']), 'die.svg');
  const response = await fetch(`${baseUrl}/dies`, { method: 'POST', body: formData });
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
    const die = await postDie(baseUrl);

    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dieId: die.id, x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.placements.length, 1);
    assert.ok(updated.placements[0].match);
    assert.ok(Math.abs(updated.placements[0].match.x - 300) <= 2);
  });
});

test('POST /sessions/:id/placements returns 404 for an unknown session', async () => {
  await withServer(async (baseUrl) => {
    const die = await postDie(baseUrl);
    const response = await fetch(`${baseUrl}/sessions/does-not-exist/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dieId: die.id, x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 404);
  });
});

test('POST /sessions/:id/placements returns 404 for an unknown die', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dieId: 'does-not-exist', x: 100, y: 100, rotation: 0 }),
    });
    assert.equal(response.status, 404);
  });
});

test('POST /sessions/:id/placements returns 422 when the reference placement is invalid', async () => {
  await withServer(async (baseUrl) => {
    const session = await (await postSession(baseUrl)).json();
    const die = await postDie(baseUrl);
    const response = await fetch(`${baseUrl}/sessions/${session.id}/placements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dieId: die.id, x: 480, y: 480, rotation: 0 }),
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
