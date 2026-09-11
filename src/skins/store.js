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
    label,
    species,
    dominantWavelengthMm,
    radialSpectrum,
    outlinePolygon,
    thicknessMm,
    photoPath,
    photoExt,
  }) {
    ensureDir();
    const id = crypto.randomUUID();
    const record = {
      id,
      label,
      species,
      dominantWavelengthMm: dominantWavelengthMm ?? null,
      radialSpectrum: radialSpectrum ?? null,
      outlinePolygon: outlinePolygon ?? null,
      thicknessMm: thicknessMm ?? null,
      remainingAreaPct: 100,
      photoExt,
      createdAt: new Date().toISOString(),
    };
    fs.copyFileSync(photoPath, path.join(dataDir, `${id}${photoExt}`));
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

  // Persists the true value, including negative (over-committed) or
  // above-100 results, rather than clamping — the stored value is a real
  // quantity, and clamping it would hide over-commitment instead of
  // measuring it. Callers clamp only where the value is displayed.
  function setRemainingAreaPct(id, pct) {
    const record = readRecord(id);
    if (!record) return null;
    record.remainingAreaPct = pct;
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  return { list, create, setRemainingAreaPct, remove, photoPath };
}
