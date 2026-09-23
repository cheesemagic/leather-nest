import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/parts/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parts-store-test-'));
}

test('create() writes a JSON record, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Vamp',
    polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.name, 'Vamp');

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes the record and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({
    name: 'Quarter',
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);
  assert.equal(store.remove('does-not-exist'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() rejects ids shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.remove('../../etc/passwd'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test('create() defaults the component metadata fields', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({ name: 'Belt keeper 35mm', polygon: SQUARE });

  assert.equal(record.valuePerPiece, null);
  assert.equal(record.productFamily, null);
  assert.equal(record.allowedSpecies, null);
  assert.equal(record.thicknessMinMm, null);
  assert.equal(record.thicknessMaxMm, null);
  assert.deepEqual(record.allowedRotations, [0, 90, 180, 270]);
  assert.equal(record.demand, 0);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('create() round-trips given metadata through list()', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Sneaker heel patch',
    polygon: SQUARE,
    valuePerPiece: 3.5,
    productFamily: 'sneaker',
    allowedSpecies: ['cayman', 'crocodile'],
    thicknessMinMm: 1.0,
    thicknessMaxMm: 1.8,
    allowedRotations: [0, 180],
    demand: 24,
  });

  const listed = store.list().find((r) => r.id === record.id);
  assert.equal(listed.valuePerPiece, 3.5);
  assert.equal(listed.productFamily, 'sneaker');
  assert.deepEqual(listed.allowedSpecies, ['cayman', 'crocodile']);
  assert.equal(listed.thicknessMinMm, 1.0);
  assert.equal(listed.thicknessMaxMm, 1.8);
  assert.deepEqual(listed.allowedRotations, [0, 180]);
  assert.equal(listed.demand, 24);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('update() changes metadata, never geometry or identity', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({ name: 'Keeper', polygon: SQUARE, demand: 5 });

  const updated = store.update(record.id, {
    name: 'Belt keeper 35mm',
    valuePerPiece: 1.25,
    demand: 100,
    polygon: [{ x: 0, y: 0 }],
    id: 'hacked',
    createdAt: '1999-01-01T00:00:00.000Z',
  });

  assert.equal(updated.name, 'Belt keeper 35mm');
  assert.equal(updated.valuePerPiece, 1.25);
  assert.equal(updated.demand, 100);
  assert.deepEqual(updated.polygon, SQUARE);
  assert.equal(updated.id, record.id);
  assert.equal(updated.createdAt, record.createdAt);

  const reread = store.list().find((r) => r.id === record.id);
  assert.equal(reread.valuePerPiece, 1.25);
  assert.deepEqual(reread.polygon, SQUARE);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('update() leaves omitted fields alone and returns null for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({ name: 'Keeper', polygon: SQUARE, demand: 5, valuePerPiece: 2 });

  const updated = store.update(record.id, { demand: 9 });
  assert.equal(updated.demand, 9);
  assert.equal(updated.valuePerPiece, 2);
  assert.equal(updated.name, 'Keeper');

  assert.equal(store.update('does-not-exist', { demand: 1 }), null);
  assert.equal(store.update('../../etc/passwd', { demand: 1 }), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('list() and update() handle a legacy record with none of the metadata fields', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const id = 'aaaaaaaa-0000-0000-0000-000000000009';
  const legacy = {
    id,
    name: 'Legacy vamp',
    polygon: SQUARE,
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify(legacy, null, 2));

  const listed = store.list().find((r) => r.id === id);
  assert.ok(listed);
  assert.equal(listed.name, 'Legacy vamp');
  assert.equal(listed.valuePerPiece, undefined);
  assert.equal(listed.allowedRotations, undefined);

  const updated = store.update(id, { demand: 5 });
  assert.equal(updated.demand, 5);
  assert.equal(updated.name, 'Legacy vamp');
  // Fields absent on the legacy record and not part of this update stay
  // absent — update() merges in whitelisted keys, it doesn't backfill.
  assert.equal(updated.valuePerPiece, undefined);
  assert.equal(updated.allowedRotations, undefined);
  assert.deepEqual(updated.polygon, SQUARE);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('dieClearanceMm defaults to null, and 0 survives a round trip', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'Belt strap 38mm',
    polygon: [{ x: 0, y: 0 }, { x: 38, y: 0 }, { x: 38, y: 900 }, { x: 0, y: 900 }],
  });
  assert.equal(record.dieClearanceMm, null, 'a brand new component owns no die');

  assert.equal(store.update(record.id, { dieClearanceMm: 8 }).dieClearanceMm, 8);

  // 0 is a real die that needs no margin beyond its cut line. If anything
  // treats it as falsy it will read as "no die" and the component will be
  // wrongly excluded from every die job.
  assert.equal(store.update(record.id, { dieClearanceMm: 0 }).dieClearanceMm, 0);
  assert.equal(store.list()[0].dieClearanceMm, 0, '0 persists to disk as 0');

  assert.equal(store.update(record.id, { dieClearanceMm: null }).dieClearanceMm, null);

  // create() with an EXPLICIT 0, not merely an omitted field. Omitting it
  // yields null under both `?? null` and `|| null`, so the assertions above
  // pass either way — mutation testing confirmed a `||` here goes unnoticed.
  // Nothing calls create() with this today, but the first caller that does
  // would silently record "no die" for a die needing no margin.
  const flushDie = store.create({
    name: 'Flush die',
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    dieClearanceMm: 0,
  });
  assert.equal(flushDie.dieClearanceMm, 0, 'create() must not coerce an explicit 0 to null');

  fs.rmSync(dataDir, { recursive: true, force: true });
});
