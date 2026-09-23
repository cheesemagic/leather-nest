// test/svg-units.test.js
// viewBox + physical-size scaling. The hazard this closes: a file whose
// coordinates are user units but whose root <svg> declares a physical size,
// which imports at the wrong scale with nothing to show for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSVGPolygon } from '../src/svg/parse.js';
import { boundingBox, polygonArea } from '../src/nesting/geometry.js';

// A 1000x600 user-unit rectangle, so any scale error is obvious.
const RECT = 'M 0,0 L 1000,0 L 1000,600 L 0,600 Z';
const doc = (attrs, d = RECT) => `<svg ${attrs}><path d="${d}" /></svg>`;
const size = (polygon) => {
  const b = boundingBox(polygon);
  return [b.maxX - b.minX, b.maxY - b.minY];
};
const close = (n, expected, tol = 0.01) =>
  assert.ok(Math.abs(n - expected) <= tol, `expected ${expected} +/- ${tol}, got ${n}`);

test('mm over a larger viewBox scales down — the 10x hazard', () => {
  // 1000 user units declared as 100mm: each unit is 0.1mm.
  const [w, h] = size(parseSVGPolygon(doc('width="100mm" height="60mm" viewBox="0 0 1000 600"')));
  close(w, 100);
  close(h, 60);
});

test('a viewBox matching the declared mm size scales by exactly 1', () => {
  // The common, already-correct export. Must not be disturbed.
  const [w, h] = size(parseSVGPolygon(doc('width="1000mm" height="600mm" viewBox="0 0 1000 600"')));
  close(w, 1000);
  close(h, 600);
});

test('inches, points, picas, centimetres and px all convert', () => {
  const cases = [
    ['width="4in" height="2.4in" viewBox="0 0 1000 600"', 101.6],
    ['width="283.46pt" height="170.08pt" viewBox="0 0 1000 600"', 100],
    ['width="23.62pc" height="14.17pc" viewBox="0 0 1000 600"', 100],
    ['width="10cm" height="6cm" viewBox="0 0 1000 600"', 100],
    ['width="377.95px" height="226.77px" viewBox="0 0 1000 600"', 100],
  ];
  for (const [attrs, expectedWidthMm] of cases) {
    const [w] = size(parseSVGPolygon(doc(attrs)));
    close(w, expectedWidthMm, 0.1);
  }
});

test('a unitless width does not scale — coordinates stay millimetres', () => {
  // Unitless is user units per spec: genuinely ambiguous, and every existing
  // part record already assumes raw numbers are mm. Changing that silently
  // would rescale a library that is currently correct.
  const [w, h] = size(parseSVGPolygon(doc('width="1000" height="600" viewBox="0 0 1000 600"')));
  close(w, 1000);
  close(h, 600);
});

test('a viewBox with no physical size does not scale', () => {
  const [w] = size(parseSVGPolygon(doc('viewBox="0 0 1000 600"')));
  close(w, 1000);
});

test('a physical size with no viewBox does not scale', () => {
  // Without a viewBox there is no stated user-unit extent to scale against,
  // so there is nothing to compute — guessing from the geometry's own bounds
  // would assume the drawing fills the page, which it need not.
  const [w] = size(parseSVGPolygon(doc('width="100mm" height="60mm"')));
  close(w, 1000);
});

test('a percentage width is treated as no physical size', () => {
  const [w] = size(parseSVGPolygon(doc('width="100%" height="100%" viewBox="0 0 1000 600"')));
  close(w, 1000);
});

test('mismatched aspect uses the smaller ratio, as preserveAspectRatio=meet does', () => {
  // 100mm/1000 = 0.1 across, 100mm/600 = 0.1667 down. "meet" scales uniformly
  // by the smaller and letterboxes, so the shape stays a 1000x600 rectangle
  // at 0.1mm per unit — not stretched to fill 100x100.
  const [w, h] = size(parseSVGPolygon(doc('width="100mm" height="100mm" viewBox="0 0 1000 600"')));
  close(w, 100);
  close(h, 60);
});

test('scaling preserves shape: area falls by the square of the factor', () => {
  const unscaled = parseSVGPolygon(doc('viewBox="0 0 1000 600"'));
  const halved = parseSVGPolygon(doc('width="500mm" height="300mm" viewBox="0 0 1000 600"'));
  close(polygonArea(halved), polygonArea(unscaled) / 4, 1);
});

test('a width on a CHILD element is not mistaken for the root size', () => {
  // Searching the whole document would read this rect's width and scale the
  // drawing by something unrelated to it.
  const svg =
    '<svg viewBox="0 0 1000 600"><rect width="5mm" height="5mm" />' +
    `<path d="${RECT}" /></svg>`;
  const [w] = size(parseSVGPolygon(svg));
  close(w, 1000);
});

test('the points form is scaled too, not just paths', () => {
  const svg =
    '<svg width="100mm" height="60mm" viewBox="0 0 1000 600">' +
    '<polygon points="0,0 1000,0 1000,600 0,600" /></svg>';
  const [w, h] = size(parseSVGPolygon(svg));
  close(w, 100);
  close(h, 60);
});

test('a bare shape with no <svg> wrapper still imports unscaled', () => {
  // How src/app.js and the original tests call this.
  const polygon = parseSVGPolygon('<polygon points="0,0 40,0 40,20 0,20" />');
  assert.deepEqual(polygon, [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
  ]);
});

test('preserveAspectRatio="none" is refused, not silently distorted', () => {
  assert.throws(
    () =>
      parseSVGPolygon(
        doc('width="100mm" height="100mm" viewBox="0 0 1000 600" preserveAspectRatio="none"')
      ),
    /preserveAspectRatio/
  );
});

test('a malformed viewBox falls back to no scaling rather than NaN', () => {
  for (const bad of ['viewBox="0 0 1000"', 'viewBox="a b c d"', 'viewBox=""']) {
    const [w] = size(parseSVGPolygon(doc(`width="100mm" height="60mm" ${bad}`)));
    close(w, 1000, 0.01);
  }
});

test('a zero or negative declared size is ignored rather than collapsing the shape', () => {
  for (const bad of ['width="0mm" height="0mm"', 'width="-100mm" height="-60mm"']) {
    const [w] = size(parseSVGPolygon(doc(`${bad} viewBox="0 0 1000 600"`)));
    close(w, 1000);
  }
});
