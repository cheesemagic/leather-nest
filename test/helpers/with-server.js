import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../server.js';

export async function withServer(fn, { withDataDir = false, withPartsDataDir = false, withSessionsDataDir = false, withProductsDataDir = false, withCalibrationsDataDir = false } = {}) {
  const dataDir = withDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'skins-route-test-')) : undefined;
  const partsDataDir = withPartsDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'parts-route-test-')) : undefined;
  const sessionsDataDir = withSessionsDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-route-test-')) : undefined;
  const productsDataDir = withProductsDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'products-route-test-')) : undefined;
  const calibrationsDataDir = withCalibrationsDataDir ? fs.mkdtempSync(path.join(os.tmpdir(), 'calibrations-route-test-')) : undefined;
  const options = {};
  if (dataDir) options.dataDir = dataDir;
  if (partsDataDir) options.partsDataDir = partsDataDir;
  if (sessionsDataDir) options.sessionsDataDir = sessionsDataDir;
  if (productsDataDir) options.productsDataDir = productsDataDir;
  if (calibrationsDataDir) options.calibrationsDataDir = calibrationsDataDir;

  const server = createServer(Object.keys(options).length ? options : undefined);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    if (partsDataDir) fs.rmSync(partsDataDir, { recursive: true, force: true });
    if (sessionsDataDir) fs.rmSync(sessionsDataDir, { recursive: true, force: true });
    if (productsDataDir) fs.rmSync(productsDataDir, { recursive: true, force: true });
    if (calibrationsDataDir) fs.rmSync(calibrationsDataDir, { recursive: true, force: true });
  }
}
