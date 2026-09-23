import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[0-9a-f-]+$/i;

// Only these are writable after creation. A component's polygon is its
// identity — a changed shape would invalidate any layout already computed
// against it — so a new shape means a new component. interiorPaths are
// deliberately absent for the same reason: moving a hole changes the piece
// as surely as moving its edge does.
const METADATA_FIELDS = [
  'name',
  'valuePerPiece',
  'productFamily',
  'allowedSpecies',
  'thicknessMinMm',
  'thicknessMaxMm',
  'allowedRotations',
  'demand',
  'dieClearanceMm',
];

export function createStore(dataDir) {
  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function recordPath(id) {
    return path.join(dataDir, `${id}.json`);
  }

  function readRecord(id) {
    if (!SAFE_ID.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
    } catch {
      return null;
    }
  }

  function list() {
    ensureDir();
    return fs
      .readdirSync(dataDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function create({
    name,
    polygon,
    interiorPaths,
    valuePerPiece,
    productFamily,
    allowedSpecies,
    thicknessMinMm,
    thicknessMaxMm,
    allowedRotations,
    demand,
    dieClearanceMm,
  }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      name,
      polygon,
      // Holes, stitch guides, fringe slits. Absent on every component made
      // before they existed, so default rather than require.
      interiorPaths: interiorPaths ?? [],
      valuePerPiece: valuePerPiece ?? null,
      productFamily: productFamily ?? null,
      allowedSpecies: allowedSpecies ?? null,
      thicknessMinMm: thicknessMinMm ?? null,
      thicknessMaxMm: thicknessMaxMm ?? null,
      allowedRotations: allowedRotations ?? [0, 90, 180, 270],
      demand: demand ?? 0,
      dieClearanceMm: dieClearanceMm ?? null,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function update(id, fields) {
    const record = readRecord(id);
    if (!record) return null;
    for (const key of METADATA_FIELDS) {
      if (fields[key] !== undefined) record[key] = fields[key];
    }
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

  return { list, create, update, remove };
}
