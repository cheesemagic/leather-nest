// test/geometry-boundary.test.js
// Added 2026-09-27. Geometry used to be written to a record exactly as it
// arrived -- from an OpenCV contour or an uploaded SVG -- with nothing checked
// in between. These are the route-level halves of test/validate-polygon.test.js:
// that file proves the rule, this one proves the rule is actually applied where
// shapes come in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer as withServerBase } from './helpers/with-server.js';

function withServer(fn) {
  return withServerBase(fn, { withPartsDataDir: true });
}

const path = (points) => `M ${points.join(' L ')} Z`;
const box = (x, y, w, h) => [`${x},${y}`, `${x + w},${y}`, `${x + w},${y + h}`, `${x},${y + h}`];

// Lopsided so it is caught as a crossing rather than as zero area.
const CROSSED = path(['0,0', '100,80', '100,0', '0,100']);

function upload(svg, fields = {}) {
  const form = new FormData();
  form.append('svg', new Blob([svg]), 'pattern.svg');
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return form;
}

test('a single self-crossing component is refused, and nothing is saved', () => {
  return withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/parts`, {
      method: 'POST',
      body: upload(`<svg viewBox="0 0 200 200"><path d="${CROSSED}" /></svg>`, { name: 'bad piece' }),
    });

    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /crosses itself/);

    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 0, 'a refused shape must not leave a record behind');
  });
});

test('a flat component is refused for enclosing nothing', () => {
  return withServer(async (baseUrl) => {
    const flat = path(['0,0', '50,0', '100,0']);
    const response = await fetch(`${baseUrl}/parts`, {
      method: 'POST',
      body: upload(`<svg viewBox="0 0 200 200"><path d="${flat}" /></svg>`, { name: 'flat' }),
    });

    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /encloses no area/);
  });
});

test('a typed rectangle too large to be real is refused', () => {
  return withServer(async (baseUrl) => {
    const form = new FormData();
    form.append('name', 'enormous');
    form.append('widthMm', '25000');
    form.append('heightMm', '400');

    const response = await fetch(`${baseUrl}/parts`, { method: 'POST', body: form });
    assert.equal(response.status, 422);
    const { error } = await response.json();
    assert.match(error, /too large to be real/);
    assert.match(error, /unit/, 'the message points at the likely cause');
  });
});

test('a sanely sized typed rectangle still saves', () => {
  return withServer(async (baseUrl) => {
    const form = new FormData();
    form.append('name', 'card wallet');
    form.append('widthMm', '110');
    form.append('heightMm', '80');

    const response = await fetch(`${baseUrl}/parts`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).name, 'card wallet');
  });
});

// The partial-write case. A pattern file yields many components in one request,
// and the import wrote them in a loop -- so a bad piece halfway down used to
// leave every piece before it saved, and the operator with a half-imported
// pattern to find and clean up by hand.
test('one bad piece in a multi-piece file saves none of them', () => {
  return withServer(async (baseUrl) => {
    const mixed =
      '<svg viewBox="0 0 400 200">' +
      `<path d="${path(box(10, 10, 100, 150))}" />` +
      `<path d="${CROSSED}" />` +
      `<path d="${path(box(250, 10, 80, 100))}" />` +
      '</svg>';

    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(mixed, { name: 'mixed pattern', unit: 'mm' }),
    });

    assert.equal(response.status, 422);
    const { error } = await response.json();
    assert.match(error, /crosses itself/);
    assert.match(error, /Piece 2/, 'the operator is told which piece is wrong');

    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 0, 'a refused import must be all-or-nothing');
  });
});

test('a multi-piece file where every piece is sound imports all of them', () => {
  return withServer(async (baseUrl) => {
    const good =
      '<svg viewBox="0 0 400 200">' +
      `<path d="${path(box(10, 10, 100, 150))}" />` +
      `<path d="${path(box(150, 10, 100, 120))}" />` +
      '</svg>';

    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(good, { name: 'sound pattern', unit: 'mm' }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 2);

    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 2);
  });
});

// Found by the verifier, 2026-09-27. The outline is not the whole shape.
// Interior rings become cut paths in the exported file, in the SAME COLOUR as
// the real cuts, so a self-crossing hole leaves an X slashed across the
// finished piece. Nothing between upload and laser file rejected it.
test('a component whose hole crosses itself is refused', () => {
  return withServer(async (baseUrl) => {
    // A square with a bowtie where a stitch hole should be.
    const withBadHole =
      '<svg viewBox="0 0 200 200">' +
      `<path d="${path(box(10, 10, 100, 100))} ${path(['30,30', '70,70', '70,30', '30,70'])}" />` +
      '</svg>';

    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(withBadHole, { name: 'bad hole', unit: 'mm' }),
    });

    assert.equal(response.status, 422);
    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 0, 'nothing may be saved when a hole is broken');
  });
});

test('a real stitch hole is small, and is still accepted', () => {
  // The reason interior rings get their own validator rather than
  // validatePolygon: a real stitch hole in this repo's own part records measures
  // about 1mm across, roughly half a square millimetre. validatePolygon's
  // one-square-millimetre floor would refuse every one of them.
  return withServer(async (baseUrl) => {
    const ring = (cx, cy, r) =>
      Array.from({ length: 8 }, (_, i) => {
        const t = (i / 8) * Math.PI * 2;
        return `${(cx + r * Math.cos(t)).toFixed(3)},${(cy + r * Math.sin(t)).toFixed(3)}`;
      });
    const withRealHoles =
      '<svg viewBox="0 0 200 200">' +
      `<path d="${path(box(10, 10, 100, 100))} ${path(ring(40, 40, 0.5))} ${path(ring(60, 40, 0.5))}" />` +
      '</svg>';

    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(withRealHoles, { name: 'stitched', unit: 'mm' }),
    });

    assert.equal(response.status, 200);
    const [part] = await response.json();
    assert.equal(part.interiorPaths.length, 2, 'both holes survived');
  });
});

test('a hole outside its own outline is refused', () => {
  return withServer(async (baseUrl) => {
    // parseSVGComponents groups by containment, so a ring that is not inside
    // anything becomes its own component rather than a stray hole -- in which
    // case it must be judged as an outline. Either way nothing broken is stored.
    const strayHole =
      '<svg viewBox="0 0 400 400">' +
      `<path d="${path(box(10, 10, 50, 50))} ${path(['300,300', '340,340', '340,300', '300,340'])}" />` +
      '</svg>';

    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(strayHole, { name: 'stray', unit: 'mm' }),
    });

    assert.equal(response.status, 422, 'a self-crossing shape is refused wherever it sits');
    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 0);
  });
});
