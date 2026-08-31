import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../server.js';

export async function withServer(fn, { withDataDir = false } = {}) {
  const dataDir = withDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'skins-route-test-')) : undefined;
  const server = createServer(dataDir ? { dataDir } : undefined);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
