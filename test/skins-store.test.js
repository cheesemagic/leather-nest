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
    colourL: 43.1,
    colourA: 17.0,
    colourB: 26.0,
    finish: 'glossy',
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
  assert.equal(outlineOnly.colourL, 43.1);
  assert.equal(outlineOnly.colourA, 17.0);
  assert.equal(outlineOnly.colourB, 26.0);
  assert.equal(outlineOnly.finish, 'glossy');
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
  assert.equal(signatureOnly.colourL, null);
  assert.equal(signatureOnly.colourA, null);
  assert.equal(signatureOnly.colourB, null);
  assert.equal(signatureOnly.finish, null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('setRemainingAreaPct() persists the true value without clamping, and returns null for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);
  const record = store.create({
    label: 'Cayman #9',
    species: 'cayman',
    photoPath,
    photoExt: '.jpg',
  });

  assert.equal(store.setRemainingAreaPct(record.id, 62.5).remainingAreaPct, 62.5);
  assert.equal(store.list().find((r) => r.id === record.id).remainingAreaPct, 62.5);

  assert.equal(store.setRemainingAreaPct(record.id, 140).remainingAreaPct, 140);
  assert.equal(store.setRemainingAreaPct(record.id, -20).remainingAreaPct, -20);

  assert.equal(store.setRemainingAreaPct('does-not-exist', 50), null);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('setSignature() adds a measurement to an existing hide without disturbing anything else', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const record = store.create({
    label: 'Cayman #11',
    species: 'cayman',
    outlinePolygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    colourL: 43.1,
    colourA: 17.0,
    colourB: 26.0,
    thicknessMm: 1.2,
    photoPath,
    photoExt: '.jpg',
  });
  // Part-way cut. This is the property that separates setSignature from
  // redigitize: making a hide matchable must not hand it back its whole area.
  store.setRemainingAreaPct(record.id, 40);

  const updated = store.setSignature(record.id, {
    dominantWavelengthMm: 4.2,
    radialSpectrum: [0.1, 0.5, 1],
  });

  assert.equal(updated.dominantWavelengthMm, 4.2);
  assert.deepEqual(updated.radialSpectrum, [0.1, 0.5, 1]);
  assert.equal(updated.remainingAreaPct, 40, 'a part-cut hide must stay part-cut');
  assert.deepEqual(updated.outlinePolygon, record.outlinePolygon);
  assert.equal(updated.colourL, 43.1);
  assert.equal(updated.thicknessMm, 1.2);
  assert.equal(updated.createdAt, record.createdAt);

  assert.equal(store.list().find((r) => r.id === record.id).dominantWavelengthMm, 4.2);
  assert.equal(
    store.setSignature('does-not-exist', { dominantWavelengthMm: 1, radialSpectrum: [] }),
    null
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('redigitize() replaces outline/colour/photo and resets remainingAreaPct to 100, even if it had drifted', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const photoPath = makeTmpPhoto(dataDir);

  const record = store.create({
    label: 'Cayman #10',
    species: 'cayman',
    outlinePolygon: [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ],
    colourL: 43.1,
    colourA: 17.0,
    colourB: 26.0,
    photoPath,
    photoExt: '.jpg',
  });
  store.setRemainingAreaPct(record.id, 40);

  const newPhotoPath = path.join(dataDir, 'remainder.png');
  fs.writeFileSync(newPhotoPath, 'new-fake-photo-bytes');

  const updated = store.redigitize(record.id, {
    outlinePolygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    colourL: 50,
    colourA: 5,
    colourB: -5,
    photoPath: newPhotoPath,
    photoExt: '.png',
  });

  assert.equal(updated.id, record.id);
  assert.deepEqual(updated.outlinePolygon, [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]);
  assert.equal(updated.colourL, 50);
  assert.equal(updated.colourA, 5);
  assert.equal(updated.colourB, -5);
  // The whole point: a hide part-way cut (40% left) gets re-measured and its
  // NEW outline is the new 100%, not still-40%-of-the-old-one.
  assert.equal(updated.remainingAreaPct, 100);
  assert.equal(updated.photoExt, '.png');

  assert.equal(fs.existsSync(path.join(dataDir, `${record.id}.jpg`)), false);
  assert.ok(fs.existsSync(path.join(dataDir, `${record.id}.png`)));

  assert.equal(
    store.redigitize('does-not-exist', { outlinePolygon: [], photoPath: newPhotoPath, photoExt: '.png' }),
    null
  );

  fs.rmSync(dataDir, { recursive: true, force: true });
});
