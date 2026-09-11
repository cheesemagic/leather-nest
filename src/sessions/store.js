import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[0-9a-f-]+$/i;

const PLACEMENT_COLORS = [
  '#FF3B30', '#007AFF', '#34C759', '#FF9500', '#AF52DE',
  '#FF2D55', '#5AC8FA', '#FFCC00', '#8E8E93', '#00C7BE',
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

  function create({ calibration, searchRegion, photoPath, photoExt, hideId }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      hideId: hideId ?? null,
      calibration,
      searchRegion,
      photoExt,
      placements: [],
      status: 'draft',
      cutAt: null,
      consumedAreaMm2: null,
      createdAt: new Date().toISOString(),
    };
    fs.copyFileSync(photoPath, path.join(dataDir, `${id}${photoExt}`));
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function addPlacement(id, { dieId, dieName, polygon, reference, match }) {
    const record = readRecord(id);
    if (!record) return null;
    const color = PLACEMENT_COLORS[record.placements.length % PLACEMENT_COLORS.length];
    record.placements.push({ dieId, dieName, polygon, color, reference, match });
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  function remove(id) {
    const record = readRecord(id);
    if (!record) return false;
    fs.unlinkSync(recordPath(id));
    const photo = path.join(dataDir, `${id}${record.photoExt}`);
    if (fs.existsSync(photo)) fs.unlinkSync(photo);
    return true;
  }

  function photoPath(id) {
    const record = readRecord(id);
    return record ? path.join(dataDir, `${id}${record.photoExt}`) : null;
  }

  // The three transition fields only ever change together — a partial
  // write is always a bug, so there is one method rather than three setters.
  function setStatus(id, { status, cutAt, consumedAreaMm2 }) {
    const record = readRecord(id);
    if (!record) return null;
    record.status = status;
    record.cutAt = cutAt;
    record.consumedAreaMm2 = consumedAreaMm2;
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  return { list, create, addPlacement, setStatus, remove, photoPath };
}
