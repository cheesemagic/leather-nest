import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../server.js';

export async function withServer(fn, { withDataDir = false, withDiesDataDir = false } = {}) {
  const dataDir = withDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'skins-route-test-')) : undefined;
  const diesDataDir = withDiesDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'dies-route-test-')) : undefined;
  const options = {};
  if (dataDir) options.dataDir = dataDir;
  if (diesDataDir) options.diesDataDir = diesDataDir;

  const server = createServer(Object.keys(options).length ? options : undefined);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    if (diesDataDir) fs.rmSync(diesDataDir, { recursive: true, force: true });
  }
}
