// test/digitize-confidence.test.js
//
// digitize.py reports how much to trust the outline it just returned. It does
// not refuse on this — the thing that goes wrong (a tidy outline around the
// wrong object) could not be separated from a correct one by any single
// measured signal, so a limit would be a number someone invented. See the
// assess() docstring and the 2026-11-23 spike findings.
//
// These tests pin the two conditions that DID separate the known-wrong set
// from the known-right one, and pin that the report never gates the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = path.join(__dirname, '..', 'venv', 'bin', 'python3');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'digitize.py');
const fixture = (n) => path.join(__dirname, 'fixtures', n);

const digitize = (file, ...extra) =>
  JSON.parse(execFileSync(PYTHON, [SCRIPT, file, '0', '0', '200', '0', '100', ...extra]).toString());

test('a clean single-candidate trace reports itself as certain', () => {
  const { confidence } = digitize(fixture('test-rectangle.png'));
  assert.equal(confidence.certain, true);
  assert.deepEqual(confidence.reasons, []);
  assert.equal(confidence.edgesTouched, 0);
});

test('a piece running into the frame edge is reported as uncertain', () => {
  // test-edge-piece.png is exactly that case, and it is genuinely ambiguous:
  // a piece against the edge and a trace that has wandered onto the bench
  // look the same from here.
  const { confidence } = digitize(fixture('test-edge-piece.png'));
  assert.equal(confidence.certain, false);
  assert.ok(
    confidence.reasons.some((r) => /edge/.test(r)),
    `expected an edge reason, got ${JSON.stringify(confidence.reasons)}`,
  );
  assert.ok(confidence.edgesTouched >= 1);
});

test('attempts that point at different parts of the photo are reported as uncertain', () => {
  // test-disagreeing.png holds two squares of identical brightness, one found
  // on each colour axis. Brightness finds nothing, so the two surviving
  // readings are disjoint and the winner is simply whichever was bigger.
  // Neither square touches the frame, so this isolates the disagreement
  // condition from the edge one.
  const { confidence } = digitize(fixture('test-disagreeing.png'));
  assert.equal(confidence.certain, false);
  assert.equal(confidence.edgesTouched, 0, 'this fixture must not trip the edge reason');
  assert.equal(confidence.agreeing, 0, 'the two readings must not be counted as agreeing');
  assert.ok(confidence.attempts > 1);
  assert.ok(
    confidence.reasons.some((r) => /disagreed/.test(r)),
    `expected a disagreement reason, got ${JSON.stringify(confidence.reasons)}`,
  );
});

test('an uncertain trace still returns its outline — the report never gates the result', () => {
  const result = digitize(fixture('test-edge-piece.png'));
  assert.equal(result.confidence.certain, false);
  assert.ok(Array.isArray(result.polygon) && result.polygon.length >= 3,
    'the outline must still come back; this reports doubt, it does not refuse');
  assert.ok(Number.isFinite(result.colourL), 'colour must still come back too');
});

test('the report carries the evidence, not just a verdict', () => {
  const { confidence } = digitize(fixture('test-colour-rectangle.png'));
  for (const key of ['roughness', 'areaPct', 'attempts', 'agreeing', 'edgesTouched']) {
    assert.ok(Number.isFinite(confidence[key]), `expected a number for ${key}`);
  }
  // Several attempts survive on this fixture and they agree with each other,
  // which is what "certain" means here — not that the roughness was low.
  assert.ok(confidence.attempts > 1, 'expected more than one surviving attempt');
  assert.ok(confidence.agreeing > 0, 'expected the attempts to agree');
  assert.equal(confidence.certain, true);
});

test('every reason reads as a sentence an operator could act on', () => {
  const { confidence } = digitize(fixture('test-edge-piece.png'));
  for (const reason of confidence.reasons) {
    assert.ok(reason.length > 20, `too terse to act on: ${reason}`);
    assert.ok(/ /.test(reason.trim()), 'reasons are prose, not identifiers');
    assert.doesNotMatch(reason, /[_{}[\]<>]|[A-Za-z]+\.[A-Za-z]/, `leaked code vocabulary: ${reason}`);
  }
});
