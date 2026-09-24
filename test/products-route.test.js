import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer as withServerBase } from './helpers/with-server.js';

function withServer(fn) {
  return withServerBase(fn, { withPartsDataDir: true, withProductsDataDir: true });
}

async function postPart(baseUrl, name = 'back') {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('svg', new Blob(['<polygon points="0,0 40,0 40,20 0,20" />']), 'part.svg');
  const response = await fetch(`${baseUrl}/parts`, { method: 'POST', body: formData });
  return response.json();
}

function postProduct(baseUrl, body) {
  return fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /products creates a product and GET /products lists it', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl, 'back');
    const pocket = await postPart(baseUrl, 'pocket');

    const response = await postProduct(baseUrl, {
      name: 'card wallet',
      parts: [
        { partId: back.id, quantity: 1, mustMatch: true },
        { partId: pocket.id, quantity: 2 },
      ],
    });
    assert.equal(response.status, 200);
    const created = await response.json();
    assert.equal(created.name, 'card wallet');
    assert.deepEqual(created.parts, [
      { partId: back.id, quantity: 1, mustMatch: true },
      { partId: pocket.id, quantity: 2, mustMatch: true },
    ]);

    const list = await (await fetch(`${baseUrl}/products`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
  });
});

test('POST /products returns 400 when name is missing', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);
    const response = await postProduct(baseUrl, { parts: [{ partId: back.id, quantity: 1 }] });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /name/);
  });
});

test('POST /products returns 400 when parts is empty', async () => {
  await withServer(async (baseUrl) => {
    const response = await postProduct(baseUrl, { name: 'card wallet', parts: [] });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /parts/);
  });
});

test('POST /products returns 400 when a partId does not name an existing part', async () => {
  await withServer(async (baseUrl) => {
    const response = await postProduct(baseUrl, {
      name: 'card wallet',
      parts: [{ partId: 'does-not-exist', quantity: 1 }],
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /does not name an existing part/);
  });
});

test('POST /products returns 400 for a non-positive or non-integer quantity', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);

    const zero = await postProduct(baseUrl, { name: 'x', parts: [{ partId: back.id, quantity: 0 }] });
    assert.equal(zero.status, 400);

    const fractional = await postProduct(baseUrl, { name: 'x', parts: [{ partId: back.id, quantity: 1.5 }] });
    assert.equal(fractional.status, 400);
  });
});

test('POST /products returns 400 for a non-boolean mustMatch', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);
    const response = await postProduct(baseUrl, {
      name: 'x',
      parts: [{ partId: back.id, quantity: 1, mustMatch: 'yes' }],
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /mustMatch/);
  });
});

test('POST /products defaults demand to 0, accepts an explicit target', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);

    const noTarget = await (
      await postProduct(baseUrl, { name: 'card wallet', parts: [{ partId: back.id, quantity: 1 }] })
    ).json();
    assert.equal(noTarget.demand, 0);

    const withTarget = await (
      await postProduct(baseUrl, { name: 'belt', parts: [{ partId: back.id, quantity: 1 }], demand: 5 })
    ).json();
    assert.equal(withTarget.demand, 5);
  });
});

test('POST /products returns 400 for a negative or non-numeric demand', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);

    const negative = await postProduct(baseUrl, {
      name: 'x',
      parts: [{ partId: back.id, quantity: 1 }],
      demand: -1,
    });
    assert.equal(negative.status, 400);
    assert.match((await negative.json()).error, /demand/);

    const nonNumeric = await postProduct(baseUrl, {
      name: 'x',
      parts: [{ partId: back.id, quantity: 1 }],
      demand: 'five',
    });
    assert.equal(nonNumeric.status, 400);
  });
});

test('DELETE /products/:id removes it, GET /products no longer lists it', async () => {
  await withServer(async (baseUrl) => {
    const back = await postPart(baseUrl);
    const created = await (
      await postProduct(baseUrl, { name: 'card wallet', parts: [{ partId: back.id, quantity: 1 }] })
    ).json();

    const deleteResponse = await fetch(`${baseUrl}/products/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);

    const list = await (await fetch(`${baseUrl}/products`)).json();
    assert.equal(list.length, 0);
  });
});

test('DELETE /products/:id returns 404 for an unknown id', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/products/does-not-exist`, { method: 'DELETE' });
    assert.equal(response.status, 404);
  });
});
