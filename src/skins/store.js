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
    colourL,
    colourA,
    colourB,
    finish,
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
      colourL: colourL ?? null,
      colourA: colourA ?? null,
      colourB: colourB ?? null,
      finish: finish ?? null,
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

  // A hide's stored outline is only ever a snapshot of the last photo taken
  // of it, not a live shape that shrinks as sessions get cut against it (see
  // setRemainingAreaPct). Once real leather has actually been cut, that
  // snapshot is wrong, not just stale -- the true remaining shape is
  // irregular, not the old outline at some smaller percentage. Re-photographing
  // replaces the outline and colour outright and resets remainingAreaPct to
  // 100: the new outline IS the full extent of what's left, exactly like the
  // first capture was 100% of an untouched hide. The old photo is replaced
  // too, since it no longer shows the hide's current state.
  function redigitize(id, { outlinePolygon, colourL, colourA, colourB, photoPath, photoExt }) {
    const record = readRecord(id);
    if (!record) return null;
    const oldPhoto = path.join(dataDir, `${id}${record.photoExt}`);
    if (fs.existsSync(oldPhoto)) fs.unlinkSync(oldPhoto);
    record.outlinePolygon = outlinePolygon;
    record.colourL = colourL ?? null;
    record.colourA = colourA ?? null;
    record.colourB = colourB ?? null;
    record.remainingAreaPct = 100;
    record.photoExt = photoExt;
    fs.copyFileSync(photoPath, path.join(dataDir, `${id}${photoExt}`));
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  // Measures an existing hide for matching after the fact. Separate from
  // redigitize() on purpose: this adds a measurement and changes nothing
  // else, where redigitize replaces the hide's shape and resets how much of
  // it is left. A hide part-way through being cut must be able to become
  // matchable without its remaining area being thrown back to 100%.
  function setSignature(id, { dominantWavelengthMm, radialSpectrum }) {
    const record = readRecord(id);
    if (!record) return null;
    record.dominantWavelengthMm = dominantWavelengthMm;
    record.radialSpectrum = radialSpectrum;
    fs.writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return record;
  }

  return { list, create, setRemainingAreaPct, redigitize, setSignature, remove, photoPath };
}
