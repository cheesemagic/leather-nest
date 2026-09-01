import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/dies/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dies-store-test-'));
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
