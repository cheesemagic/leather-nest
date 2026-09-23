import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer as withServerBase } from './helpers/with-server.js';

function withServer(fn) {
  return withServerBase(fn, { withCalibrationsDataDir: true });
}

function postCalibration(baseUrl, overrides = {}) {
  return fetch(`${baseUrl}/calibrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'desk setup',
      p1x: 100, p1y: 200, p2x: 400, p2y: 200, realDistanceMm: 100,
      photoWidth: 4032, photoHeight: 3024,
      ...overrides,
    }),
  });
}

test('POST /calibrations creates one and GET /calibrations lists it', async () => {
  await withServer(async (baseUrl) => {
    const response = await postCalibration(baseUrl);
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.equal(created.name, 'desk setup');
    assert.equal(created.photoWidth, 4032);

    const list = await (await fetch(`${baseUrl}/calibrations`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('POST /calibrations returns 400 when name is missing', async () => {
  await withServer(async (baseUrl) => {
    const response = await postCalibration(baseUrl, { name: '' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /name/);
  });
});

test('POST /calibrations returns 400 for a non-finite numeric field', async () => {
  await withServer(async (baseUrl) => {
    const response = await postCalibration(baseUrl, { p1x: 'nope' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /p1x/);
  });
});

test('POST /calibrations returns 400 for a non-positive realDistanceMm', async () => {
  await withServer(async (baseUrl) => {
    const response = await postCalibration(baseUrl, { realDistanceMm: 0 });
    assert.equal(response.status, 400);
  });
});

test('POST /calibrations returns 400 for a non-integer photo dimension', async () => {
  await withServer(async (baseUrl) => {
    const response = await postCalibration(baseUrl, { photoWidth: 1080.5 });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /photoWidth/);
  });
});

test('DELETE /calibrations/:id removes it, GET /calibrations no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const created = await (await postCalibration(baseUrl)).json();
    const deleteResponse = await fetch(`${baseUrl}/calibrations/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/calibrations`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /calibrations/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/calibrations/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});
