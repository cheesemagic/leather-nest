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

  // photoWidth/photoHeight are the pixel dimensions of the photo this
  // calibration was captured on -- the only thing that makes reusing it safe.
  // A saved p1x/p1y is a pixel position; applying it to a photo of different
  // dimensions would silently point at the wrong spot and report the wrong
  // scale. The caller is responsible for checking a new photo's dimensions
  // match before reusing one of these -- this store just persists them.
  function create({ name, p1x, p1y, p2x, p2y, realDistanceMm, photoWidth, photoHeight }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      name,
      p1x,
      p1y,
      p2x,
      p2y,
      realDistanceMm,
      photoWidth,
      photoHeight,
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
