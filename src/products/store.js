import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[0-9a-f-]+$/i;

export function createStore(dataDir) {
  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function recordPath(id) {
    return path.join(dataDir, `${id}.json`);
  }

  function list() {
    ensureDir();
    return fs
      .readdirSync(dataDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // parts' mustMatch has no effect yet -- it only matters once a product can
  // span more than one hide (see the products spec's "Order of work"), which
  // this store predates. Stored now so that step doesn't need a migration.
  function create({ name, parts, demand }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      name,
      parts: parts.map((p) => ({
        partId: p.partId,
        quantity: p.quantity,
        mustMatch: p.mustMatch ?? true,
      })),
      // How many of this product are actually wanted -- 0 (the default)
      // means no order to fill; see evaluateProductCandidate's demandSatisfied.
      demand: demand ?? 0,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function remove(id) {
    if (!SAFE_ID.test(id)) return false;
    const filePath = recordPath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  return { list, create, remove };
}
