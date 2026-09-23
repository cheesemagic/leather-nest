import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/products/store.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'products-store-test-'));
}

test('create() writes a JSON record, list() returns it, mustMatch defaults true', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'card wallet',
    parts: [
      { partId: 'back-1', quantity: 1, mustMatch: true },
      { partId: 'pocket-1', quantity: 2 },
    ],
  });

  assert.ok(record.id);
  assert.ok(record.createdAt);
  assert.equal(record.name, 'card wallet');
  assert.deepEqual(record.parts, [
    { partId: 'back-1', quantity: 1, mustMatch: true },
    { partId: 'pocket-1', quantity: 2, mustMatch: true },
  ]);

  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], record);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a part explicitly marked mustMatch: false keeps that value', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);

  const record = store.create({
    name: 'wallet with liner',
    parts: [{ partId: 'liner-1', quantity: 1, mustMatch: false }],
  });

  assert.equal(record.parts[0].mustMatch, false);

  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('remove() deletes the record and returns true, false for an unknown id', () => {
  const dataDir = makeTmpDir();
  const store = createStore(dataDir);
  const record = store.create({ name: 'belt', parts: [{ partId: 'strap-1', quantity: 1 }] });

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
