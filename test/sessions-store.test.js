import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/sessions/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-store-test-'));
}

function makeTmpPhoto(dir) {
  const photoPath = path.join(dir, 'source.jpg');
  fs.writeFileSync(photoPath, 'fake-photo-bytes');
  return photoPath;
}

const CALIBRATION = { p1x: 0, p1y: 0, p2x: 200, p2y: 0, realDistanceMm: 100 };
const SEARCH_REGION = { roiX: 0, roiY: 0, roiWidth: 2000, roiHeight: 1500 };

test('create() writes a JSON record and copies the photo, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const record = store.create({
    calibration: CALIBRATION,
    searchRegion: SEARCH_REGION,
    photoPath,
    photoExt: '.jpg',
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.deepEqual(record.calibration, CALIBRATION);
  assert.deepEqual(record.placements, []);

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);
  assert.ok(fs.existsSync(path.join(dataDir, `${record.id}${record.photoExt}`)));

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('addPlacement() appends a placement with a cycled color and persists it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({ calibration: CALIBRATION, searchRegion: SEARCH_REGION, photoPath, photoExt: '.jpg' });

  const polygon = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
  const updated = store.addPlacement(record.id, {
    dieId: 'die-1',
    dieName: 'Vamp',
    polygon,
    reference: { x: 100, y: 100, rotation: 0 },
    match: { x: 300, y: 250, rotation: 45, score: 0.01 },
  });

  assert.equal(updated.placements.length, 1);
  assert.equal(updated.placements[0].dieId, 'die-1');
  assert.deepEqual(updated.placements[0].polygon, polygon);
  assert.ok(updated.placements[0].color);

  const reloaded = store.list()[0];
  assert.deepEqual(reloaded, updated);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('addPlacement() cycles colors and returns null for an unknown session', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({ calibration: CALIBRATION, searchRegion: SEARCH_REGION, photoPath, photoExt: '.jpg' });

  const placement = { dieId: 'd', dieName: 'D', polygon: [], reference: { x: 0, y: 0, rotation: 0 }, match: null };
  let updated = record;
  for (let i = 0; i < 11; i++) {
    updated = store.addPlacement(updated.id, placement);
  }
  assert.equal(updated.placements.length, 11);
  assert.equal(updated.placements[0].color, updated.placements[10].color);

  assert.equal(store.addPlacement('does-not-exist', placement), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes both files and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({ calibration: CALIBRATION, searchRegion: SEARCH_REGION, photoPath, photoExt: '.jpg' });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('photoPath() and remove() reject ids shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.photoPath('../../etc/passwd'), null);
  assert.equal(store.remove('../../etc/passwd'), false);
  assert.equal(store.addPlacement('../../etc/passwd', {}), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('create() defaults the job fields, and accepts a hideId', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const unlinked = store.create({
    calibration: CALIBRATION,
    searchRegion: SEARCH_REGION,
    photoPath,
    photoExt: '.jpg',
  });
  assert.equal(unlinked.hideId, null);
  assert.equal(unlinked.status, 'draft');
  assert.equal(unlinked.cutAt, null);
  assert.equal(unlinked.consumedAreaMm2, null);

  const linked = store.create({
    calibration: CALIBRATION,
    searchRegion: SEARCH_REGION,
    photoPath,
    photoExt: '.jpg',
    hideId: 'hide-123',
  });
  assert.equal(linked.hideId, 'hide-123');
  assert.equal(store.list().find((r) => r.id === linked.id).hideId, 'hide-123');

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('setStatus() writes the transition fields together and persists them', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({
    calibration: CALIBRATION,
    searchRegion: SEARCH_REGION,
    photoPath,
    photoExt: '.jpg',
  });

  const cutAt = '2026-09-11T12:00:00.000Z';
  const updated = store.setStatus(record.id, { status: 'cut', cutAt, consumedAreaMm2: 1234.5 });
  assert.equal(updated.status, 'cut');
  assert.equal(updated.cutAt, cutAt);
  assert.equal(updated.consumedAreaMm2, 1234.5);

  const reread = store.list().find((r) => r.id === record.id);
  assert.equal(reread.status, 'cut');
  assert.equal(reread.consumedAreaMm2, 1234.5);

  const reverted = store.setStatus(record.id, { status: 'draft', cutAt: null, consumedAreaMm2: null });
  assert.equal(reverted.status, 'draft');
  assert.equal(reverted.cutAt, null);
  assert.equal(reverted.consumedAreaMm2, null);

  assert.equal(store.setStatus('does-not-exist', { status: 'cut', cutAt, consumedAreaMm2: 1 }), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
