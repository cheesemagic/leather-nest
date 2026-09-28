import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { withServer as withServerBase } from './helpers/with-server.js';
import { createServer } from '../server.js';

// Added 2026-09-27, all of it regression cover for the HTTP trust boundary.
//
// `POST /sessions` is the subject because it is the only photo upload that
// stores a file without shelling out to OpenCV first -- the same
// `photoExtension` helper and the same origin check guard hide creation,
// redigitize and session creation alike, so testing the cheap one tests the
// rule.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANVAS = path.join(__dirname, 'fixtures', 'test-blotch-canvas.png');

// A local wrapper, the convention every other route test file here follows.
// Passing the options at each call site invited the mistake this file shipped
// with: `test(name, fn, options)` is a valid node:test signature that silently
// DROPS the options, so every test in this file ran against the operator's real
// data/sessions/ directory and left 81 records behind.
function withServer(fn) {
  return withServerBase(fn, { withSessionsDataDir: true });
}

const CALIBRATION = { p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100 };
const ROI = { roiX: 0, roiY: 0, roiWidth: 500, roiHeight: 500 };

async function sessionForm(filename) {
  const form = new FormData();
  form.append('photo', new Blob([await readFile(CANVAS)]), filename);
  for (const [key, value] of Object.entries({ ...CALIBRATION, ...ROI })) {
    form.append(key, String(value));
  }
  return form;
}

// The photo's real bytes are always a PNG here. Only the name the client claims
// changes, which is exactly the point: the name decided the stored extension,
// and the stored extension decides the Content-Type that both the photo routes
// and the static server send back.
const DISGUISED_NAMES = [
  ['hide.html', '.jpg'],
  ['hide.js', '.jpg'],
  ['hide.svg', '.jpg'],
  ['hide.json', '.jpg'],
  ['hide', '.jpg'],
  ['hide.PNG', '.png'],
  ['hide.JPEG', '.jpeg'],
  ['hide.png', '.png'],
  ['hide.jpg', '.jpg'],
];

for (const [filename, expected] of DISGUISED_NAMES) {
  test(`an upload named ${filename} is stored as ${expected}`, async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        body: await sessionForm(filename),
      });
      assert.equal(response.status, 200);
      const record = await response.json();
      assert.equal(record.photoExt, expected);
    });
  });
}

test('a disguised upload never lands on disk under an executable name', async () => {
  // The extension is not cosmetic -- it becomes a real filename in the data
  // directory. Before the allowlist this wrote `<uuid>.html`, which the static
  // server then served as a page from this app's own origin. Driven against a
  // known directory rather than withServer's hidden temp one, because the
  // filename on disk IS the assertion.
  const sessionsDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-boundary-'));
  const server = createServer({ sessionsDataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.html'),
    });
    const { id } = await response.json();

    const written = fs.readdirSync(sessionsDataDir);
    assert.ok(written.includes(`${id}.jpg`), `expected ${id}.jpg, got ${written.join(', ')}`);
    assert.ok(
      !written.some((name) => /\.(html|js|svg|json)$/.test(name) && name !== `${id}.json`),
      `no executable-looking photo may be written: ${written.join(', ')}`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(sessionsDataDir, { recursive: true, force: true });
  }
});

test('a cross-origin multipart POST is refused', async () => {
  // A browser sends a multipart form cross-origin with no preflight, so any
  // page the operator visited could reach these routes. Nothing about a
  // multipart POST triggers CORS on its own -- only this check does.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
      headers: { Origin: 'https://not-this-app.example' },
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.match(body.error, /cross-origin/i);
  });
});

test('a cross-origin DELETE is refused too', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
    });
    const { id } = await created.json();

    const response = await fetch(`${baseUrl}/sessions/${id}`, {
      method: 'DELETE',
      headers: { Origin: 'https://not-this-app.example' },
    });
    assert.equal(response.status, 403);

    const stillThere = await fetch(`${baseUrl}/sessions/${id}`);
    assert.equal(stillThere.status, 200, 'the record survived the refused delete');
  });
});

test("the app's own pages can still write", async () => {
  // The check compares Origin against the host actually being served, so the
  // real UI keeps working on whatever ephemeral port the server came up on.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
      headers: { Origin: baseUrl },
    });
    assert.equal(response.status, 200);
  });
});

test('a request with no Origin at all is allowed', async () => {
  // curl, the test suite, and anything that is not a browser send none. They
  // are not the threat, and blocking them would break every route test here.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
    });
    assert.equal(response.status, 200);
  });
});

test('a cross-origin GET is still allowed', async () => {
  // Reads are not what this guards, and a browser does not send Origin on a
  // plain GET anyway -- blocking it would only break non-browser clients.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      headers: { Origin: 'https://not-this-app.example' },
    });
    assert.equal(response.status, 200);
  });
});

// Found by the verifier, 2026-09-27. Constraining what gets WRITTEN left the
// read side still trusting the record: the photo routes derived their
// Content-Type from the stored extension, so a record already carrying `.html`
// kept being served as a page from the app's own origin. Uploads are fixed AND
// reads are now constrained independently -- neither relies on the other.
test('a record carrying a disguised extension is never served as that type', async () => {
  await withServerBase(async (baseUrl, dirs) => {
    const created = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
    });
    const { id } = await created.json();

    // Forge the state a pre-fix upload left behind: rename the photo and point
    // the record at it. This is exactly what four records in the operator's real
    // data directory looked like.
    for (const ext of ['.html', '.js', '.svg', '.json']) {
      const record = JSON.parse(
        fs.readFileSync(path.join(dirs.sessionsDataDir, `${id}.json`), 'utf8')
      );
      fs.renameSync(
        path.join(dirs.sessionsDataDir, `${id}${record.photoExt}`),
        path.join(dirs.sessionsDataDir, `${id}${ext}`)
      );
      record.photoExt = ext;
      fs.writeFileSync(path.join(dirs.sessionsDataDir, `${id}.json`), JSON.stringify(record));

      const response = await fetch(`${baseUrl}/sessions/${id}/photo`);
      const type = response.headers.get('content-type');
      assert.doesNotMatch(type, /html|javascript|svg|json/, `${ext} was served as ${type}`);
      assert.equal(type, 'application/octet-stream');
    }
  });
});

test('a genuine photo is still served as an image', async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      body: await sessionForm('hide.png'),
    });
    const { id } = await created.json();
    const response = await fetch(`${baseUrl}/sessions/${id}/photo`);
    assert.equal(response.headers.get('content-type'), 'image/png');
  });
});
