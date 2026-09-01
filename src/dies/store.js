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

  function create({ name, polygon }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = { id, name, polygon, createdAt: new Date().toISOString() };
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
