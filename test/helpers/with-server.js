import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../server.js';

// EVERY store gets a temp directory, on every call, whether or not the caller
// asked for one.
//
// It used to hand `createServer` no override unless a `withXDataDir` flag was
// set, which meant the default applied -- and the default is the OPERATOR'S REAL
// `data/` directory. A test that wrote a record without setting its flag wrote
// it there for keeps. That happened: `test/upload-boundary.test.js` passed its
// options as `test(name, fn, options)`, a signature node:test accepts and
// silently drops, and left 81 records and their photos in `data/sessions/`.
//
// The flags survive because callers pass them and because a caller may want the
// path back, but they no longer decide whether isolation happens. Nothing a test
// does can reach `data/` now.
const STORES = [
  ['dataDir', 'skins'],
  ['partsDataDir', 'parts'],
  ['sessionsDataDir', 'sessions'],
  ['productsDataDir', 'products'],
  ['calibrationsDataDir', 'calibrations'],
];

export async function withServer(fn, options = {}) {
  const dirs = {};
  for (const [key, label] of STORES) {
    dirs[key] = fs.mkdtempSync(path.join(os.tmpdir(), `leather-nest-${label}-test-`));
  }

  const server = createServer({ ...dirs, ...pickOverrides(options) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`, dirs);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const dir of Object.values(dirs)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// An explicit directory still wins, so a test that needs to inspect a known
// path can pass one. Anything else in `options` -- including the legacy
// `withXDataDir` booleans -- is ignored, since isolation is now unconditional.
function pickOverrides(options) {
  const overrides = {};
  for (const [key] of STORES) {
    if (typeof options[key] === 'string') overrides[key] = options[key];
  }
  return overrides;
}
