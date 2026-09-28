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
    execPython(['-c', 'print(\'{"done": true}\')'], { timeout: 10_000 }, (err, stdout, stderr) =>
      resolve({ err, stdout, stderr })
    );
  });

  assert.equal(err, null);
  assert.equal(stdout.trim(), '{"done": true}');
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
    execPython(['-c', 'print(\'{"noOptions": true}\')'], (err, stdout) => resolve({ err, stdout }));
  });

  assert.equal(err, null);
  assert.equal(stdout.trim(), '{"noOptions": true}');
});

// Added 2026-09-27. Seven handlers called JSON.parse on this stdout with no
// catch around it, inside an execFile callback -- nothing above that catches
// either, so one malformed line from a photo script killed the server and left
// the operator's upload in the temp directory. The wrapper owns the guard for
// the same reason it owns the timeout: the call sites all forgot it.
test('output that is not JSON is reported as a failure rather than thrown', async () => {
  const { err, stderr } = await new Promise((resolve) => {
    execPython(['-c', 'print("this is not json")'], (err, stdout, stderr) =>
      resolve({ err, stderr })
    );
  });

  assert.ok(err, 'unreadable output on a zero exit must surface as an error');
  assert.ok(!err.killed, 'it is a broken result, not a timeout');
  assert.match(stderr, /unreadable/i, 'the operator is told the tool misbehaved');
});

test("a script's own error message still wins over the unreadable-output one", async () => {
  // A failing script prints diagnostics to stderr and nothing to stdout. That
  // empty stdout must not be reclassified as an unreadable result, or every
  // real digitization error would read as "returned something unreadable".
  const { err, stderr } = await new Promise((resolve) => {
    execPython(
      ['-c', 'import sys; sys.stderr.write("no outline found"); sys.exit(1)'],
      (err, stdout, stderr) => resolve({ err, stderr })
    );
  });

  assert.ok(err);
  assert.match(stderr, /no outline found/);
  assert.doesNotMatch(stderr, /unreadable/i);
});
