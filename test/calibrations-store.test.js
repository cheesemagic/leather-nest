import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/calibrations/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calibrations-store-test-'));
}

test('create() writes a JSON record, list() returns it', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'desk setup',
    p1x: 100, p1y: 200, p2x: 400, p2y: 200, realDistanceMm: 100,
    photoWidth: 4032, photoHeight: 3024,
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.name, 'desk setup');
  assert.equal(record.realDistanceMm, 100);
  assert.equal(record.photoWidth, 4032);
  assert.equal(record.photoHeight, 3024);

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes the record and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({
    name: 'desk setup', p1x: 0, p1y: 0, p2x: 100, p2y: 0, realDistanceMm: 100,
    photoWidth: 100, photoHeight: 100,
  });

  assert.equal(store.remove(record.id), true);
  assert.equal(store.list().length, 0);
  assert.equal(store.remove(record.id), false);
  assert.equal(store.remove('does-not-exist'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() rejects an id shaped like path traversal', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  assert.equal(store.remove('../../etc/passwd'), false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
