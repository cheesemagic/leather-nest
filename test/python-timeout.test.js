import test from 'node:test';
import assert from 'node:assert/strict';
import { execPython } from '../server.js';

// These run the project's real venv python, the same interpreter every route
// shells out to -- a stubbed child process would not prove the wrapper passes
// its options through to execFile correctly, which is the whole risk.

test('a script that outruns its timeout is killed and says so', async () => {
  const { err, stderr } = await new Promise((resolve) => {
    execPython(['-c', 'import time; time.sleep(30)'], { timeout: 300 }, (err, stdout, stderr) =>
      resolve({ err, stderr })
    );
  });

  assert.ok(err, 'a timed-out call must report an error');
  assert.ok(err.killed, 'the child must actually be killed, not left running');
  // Node hands back an empty stderr for a killed child, and every handler in
  // server.js surfaces `stderr.trim() || <generic fallback>` -- so without the
  // substitution this asserts, a three-minute hang reads as "Search failed."
  assert.match(stderr, /timed out/i);
  assert.match(stderr, /0s|1s/, 'the message names the limit it hit');
});

test('a script that finishes in time is untouched', async () => {
  const { err, stdout, stderr } = await new Promise((resolve) => {
    execPython(['-c', 'print("done")'], { timeout: 10_000 }, (err, stdout, stderr) =>
      resolve({ err, stdout, stderr })
    );
  });

  assert.equal(err, null);
  assert.equal(stdout.trim(), 'done');
  assert.equal(stderr, '', 'a successful run must not acquire a timeout message');
});

test('real stderr survives when a script fails for its own reasons', async () => {
  // The substitution must not swallow a genuine error message -- that is how
  // digitize.py and skin_signature.py explain what went wrong.
  const { err, stderr } = await new Promise((resolve) => {
    execPython(['-c', 'import sys; sys.stderr.write("could not read the photo"); sys.exit(1)'], (err, stdout, stderr) =>
      resolve({ err, stderr })
    );
  });

  assert.ok(err, 'a non-zero exit is still an error');
  assert.ok(!err.killed, 'it failed on its own, it was not killed');
  assert.match(stderr, /could not read the photo/);
});

test('the default timeout applies when a caller passes no options at all', async () => {
  // How eight of the nine call sites invoke it. The point of the wrapper is
  // that omitting options does NOT mean omitting the timeout.
  const { err, stdout } = await new Promise((resolve) => {
    execPython(['-c', 'print("no options")'], (err, stdout) => resolve({ err, stdout }));
  });

  assert.equal(err, null);
  assert.equal(stdout.trim(), 'no options');
});
