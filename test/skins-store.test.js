import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/skins/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skins-store-test-'));
}

function makeTmpPhoto(dir) {
  const photoPath = path.join(dir, 'source.jpg');
  fs.writeFileSync(photoPath, 'fake-photo-bytes');
  return photoPath;
}

test('create() writes a JSON record and copies the photo, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const record = store.create({
    label: 'Cayman #1',
    species: 'cayman',
    dominantWavelengthMm: 4.2,
    radialSpectrum: [0.1, 0.5, 1.0],
    photoPath,
    photoExt: '.jpg',
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.label, 'Cayman #1');

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);
  assert.ok(fs.existsSync(path.join(dataDir, `${record.id}${record.photoExt}`)));

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes both files and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({
    label: 'Croc #1',
    species: 'crocodile',
    dominantWavelengthMm: 6.1,
    radialSpectrum: [0.2],
    photoPath,
    photoExt: '.jpg',
  });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);
  assert.equal(store.remove('does-not-exist'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('photoPath() and remove() reject ids shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.photoPath('../../etc/passwd'), null);
  assert.equal(store.remove('../../etc/passwd'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('create() accepts outline/thickness fields, defaults remainingAreaPct, and round-trips omitted fields as null', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const outlineOnly = store.create({
    label: 'Cayman #2',
    species: 'cayman',
    outlinePolygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    thicknessMm: 1.2,
    photoPath,
    photoExt: '.jpg',
  });

  assert.deepEqual(outlineOnly.outlinePolygon, [
    [0, 0],
    [10, 0],
    [10, 5],
    [0, 5],
  ]);
  assert.equal(outlineOnly.thicknessMm, 1.2);
  assert.equal(outlineOnly.remainingAreaPct, 100);
  assert.equal(outlineOnly.dominantWavelengthMm, null);
  assert.equal(outlineOnly.radialSpectrum, null);

  const signatureOnly = store.create({
    label: 'Cayman #3',
    species: 'cayman',
    dominantWavelengthMm: 4.2,
    radialSpectrum: [0.1, 0.5],
    photoPath,
    photoExt: '.jpg',
  });

  assert.equal(signatureOnly.remainingAreaPct, 100);
  assert.equal(signatureOnly.outlinePolygon, null);
  assert.equal(signatureOnly.thicknessMm, null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
