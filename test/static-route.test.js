import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { withServer } from './helpers/with-server.js';

test('serves a static page when the URL carries a query string', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/public/parts.html?hide=abc123`);
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

// Added 2026-09-27. The server used to hand back any file under the repo root
// that was asked for by name -- the traversal guard only stopped a path from
// climbing OUT of the root, not from reaching anything inside it. Verified at
// the time: `.git/config`, `.git/HEAD`, `.claude/settings.local.json` and a
// live hide record under `data/skins/` all answered 200.
const PRIVATE_PATHS = [
  '/.git/config',
  '/.git/HEAD',
  '/.claude/settings.local.json',
  '/package.json',
  '/server.js',
  '/data/skins/some-id.json',
  '/docs/magna-visit.md',
  '/requirements.txt',
];

for (const urlPath of PRIVATE_PATHS) {
  test(`${urlPath} is not readable over HTTP`, async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${urlPath}`);
      assert.equal(response.status, 403, `${urlPath} must not be served`);
    });
  });
}

// fetch() resolves `..` in the CLIENT, so `fetch('/public/../.git/HEAD')` puts
// `/.git/HEAD` on the wire and tests nothing about traversal. These go over a
// raw socket, which sends the path exactly as written -- the only way to
// exercise the guard from the outside.
function rawGet(baseUrl, requestTarget) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`GET ${requestTarget} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { response += chunk; });
    socket.on('error', reject);
    socket.on('end', () => resolve(Number(response.split(' ')[1])));
  });
}

const TRAVERSALS = [
  '/public/../.git/HEAD',
  '/public/./../.git/HEAD',
  '/src/../server.js',
  '/node_modules/../package.json',
  '/public/../../leather-nest/.git/HEAD',
  '/../../../../etc/passwd',
  '/public/../data/skins/some-id.json',
];

for (const target of TRAVERSALS) {
  test(`${target} cannot climb out of a permitted root`, async () => {
    await withServer(async (baseUrl) => {
      assert.equal(await rawGet(baseUrl, target), 403, `${target} must be refused`);
    });
  });
}

test('a raw request for a permitted file still succeeds', () => {
  // So the tests above are proving the guard rejects, not that rawGet is broken.
  return withServer(async (baseUrl) => {
    assert.equal(await rawGet(baseUrl, '/public/styles.css'), 200);
  });
});

test('the pages, their modules and the vendored clipper build still load', async () => {
  await withServer(async (baseUrl) => {
    for (const urlPath of [
      '/',
      '/public/hides.html',
      '/public/styles.css',
      '/src/hides-app.js',
      '/node_modules/clipper-lib/clipper.js',
    ]) {
      const response = await fetch(`${baseUrl}${urlPath}`);
      assert.equal(response.status, 200, `${urlPath} must stay reachable`);
    }
  });
});
