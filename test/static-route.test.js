import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers/with-server.js';

test('serves a static page when the URL carries a query string', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/public/dies.html?hide=abc123`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html');
  });
});

test('still 404s a path that does not exist', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/public/nope.html?x=1`);
    assert.equal(response.status, 404);
  });
});
