// test/svg-components.test.js
// Importing a whole pattern file: several pieces, each with its own interior
// cuts. Built against a real downloaded card-wallet pattern whose structure
// is mirrored by the fixtures here (the pattern itself is someone's product
// and is not committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { parseSVGComponents, unitOptions, groupSubpaths } from '../src/svg/parse.js';
import { validateInteriorPaths } from '../src/interior.js';
import { boundingBox } from '../src/nesting/geometry.js';

// A ring of `sides` points, like the tiny circles a stitch hole is drawn as.
const ring = (cx, cy, r, sides = 8) =>
  Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
const pathOf = (points) =>
  `M ${points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' L ')} Z`;
const box = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

// One piece, one outline, three stitch holes — the shape of a real pattern.
const piece = (x, y, w, h, holes) =>
  `<path d="${[pathOf(box(x, y, w, h)), ...holes.map((c) => pathOf(ring(c.x, c.y, 1)))].join(' ')}" />`;

const size = (polygon) => {
  const b = boundingBox(polygon);
  return [b.maxX - b.minX, b.maxY - b.minY];
};

const WALLET =
  '<svg viewBox="0 0 400 200">' +
  piece(10, 10, 100, 150, [{ x: 30, y: 30 }, { x: 60, y: 30 }, { x: 90, y: 30 }]) +
  piece(150, 10, 100, 120, [{ x: 170, y: 30 }, { x: 200, y: 30 }]) +
  '</svg>';

test('each piece comes in separately, with its own holes', () => {
  const pieces = parseSVGComponents(WALLET);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].interiorPaths.length, 3);
  assert.equal(pieces[1].interiorPaths.length, 2);
});

test('the outline is the ring nothing else contains, not just the biggest', () => {
  // A file with several pieces has no single "biggest" — the second piece's
  // outline is smaller than the first's, and must still be an outline.
  const pieces = parseSVGComponents(WALLET);
  assert.deepEqual(size(pieces[0].polygon), [100, 150]);
  assert.deepEqual(size(pieces[1].polygon), [100, 120]);
});

test('every hole lands inside the piece it belongs to', () => {
  // The whole point of grouping by containment rather than by file order.
  for (const component of parseSVGComponents(WALLET)) {
    assert.deepEqual(validateInteriorPaths(component.polygon, component.interiorPaths), []);
  }
});

test('pieces keep the order they appear in the file', () => {
  const pieces = parseSVGComponents(WALLET);
  assert.ok(boundingBox(pieces[0].polygon).minX < boundingBox(pieces[1].polygon).minX);
});

test('holes are grouped by containment even when the file mixes them up', () => {
  // Every ring in one <path>, pieces and holes interleaved. Element
  // boundaries mean nothing; only containment does.
  const jumbled =
    '<svg viewBox="0 0 400 200"><path d="' +
    [
      pathOf(ring(170, 30, 1)),
      pathOf(box(10, 10, 100, 150)),
      pathOf(ring(30, 30, 1)),
      pathOf(box(150, 10, 100, 120)),
    ].join(' ') +
    '" /></svg>';

  const pieces = parseSVGComponents(jumbled);
  assert.equal(pieces.length, 2);
  const bySize = pieces.sort((a, b) => size(b.polygon)[1] - size(a.polygon)[1]);
  assert.equal(bySize[0].interiorPaths.length, 1);
  assert.equal(bySize[1].interiorPaths.length, 1);
});

test('a piece with no holes is still a piece', () => {
  const plain = `<svg viewBox="0 0 200 200"><path d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  const pieces = parseSVGComponents(plain);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0].interiorPaths, []);
});

test('interior rings are marked as cuts, and closed', () => {
  const [first] = parseSVGComponents(WALLET);
  for (const path of first.interiorPaths) {
    assert.equal(path.kind, 'cut');
    assert.equal(path.closed, true);
  }
});

test('the interior kind can be overridden, since the file cannot say', () => {
  // A stitch guide that must NOT be cut is geometrically identical to a hole
  // that must. Only the operator knows which.
  const [first] = parseSVGComponents(WALLET, { interiorKind: 'mark' });
  assert.ok(first.interiorPaths.every((p) => p.kind === 'mark'));
});

// --- units, which the file often does not state -------------------------

test('a file with no stated size reports what it would measure per unit', () => {
  const options = unitOptions(WALLET);
  assert.equal(options.stated, false);
  const asMm = options.options.find((o) => o.unit === 'mm');
  const asPt = options.options.find((o) => o.unit === 'pt');
  assert.ok(asMm.widthMm > asPt.widthMm, 'millimetres should read larger than points');
  assert.ok(Math.abs(asPt.widthMm / asMm.widthMm - 25.4 / 72) < 1e-6);
});

test('the chosen unit scales the whole import', () => {
  const asMm = parseSVGComponents(WALLET, { unit: 'mm' });
  const asPt = parseSVGComponents(WALLET, { unit: 'pt' });
  assert.deepEqual(size(asMm[0].polygon), [100, 150]);
  const [w, h] = size(asPt[0].polygon);
  assert.ok(Math.abs(w - 100 * 25.4 / 72) < 0.01, `width was ${w}`);
  assert.ok(Math.abs(h - 150 * 25.4 / 72) < 0.01);
});

test('a file that states its own size ignores the unit argument', () => {
  const stated =
    '<svg width="50mm" height="25mm" viewBox="0 0 100 50">' +
    `<path d="${pathOf(box(0, 0, 100, 50))}" /></svg>`;
  for (const unit of ['mm', 'pt', 'in']) {
    assert.deepEqual(size(parseSVGComponents(stated, { unit })[0].polygon), [50, 25]);
  }
});

test('an unknown unit is refused rather than silently treated as millimetres', () => {
  assert.throws(() => parseSVGComponents(WALLET, { unit: 'furlongs' }), /furlongs/);
});

// --- the refusals -------------------------------------------------------

test('a dashed stroke is refused, because the dashes are not in the geometry', () => {
  // Real patterns draw a row of stitch holes as ONE line with a dash pattern.
  // Every importer keeps the line and drops the dashes; cut, that is a
  // continuous slit through the piece.
  const dashed =
    '<svg viewBox="0 0 200 200"><style>.s{stroke-dasharray:1,3;}</style>' +
    `<path class="s" d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  assert.throws(() => parseSVGComponents(dashed), /dashed stroke/i);

  const attribute =
    `<svg viewBox="0 0 200 200"><path stroke-dasharray="2 2" d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  assert.throws(() => parseSVGComponents(attribute), /dashed stroke/i);
});

test('an explicitly solid stroke is not mistaken for a dashed one', () => {
  const solid =
    `<svg viewBox="0 0 200 200"><path style="stroke-dasharray:none" d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  assert.equal(parseSVGComponents(solid).length, 1);
});

test('transforms and stretched aspect ratios are refused here too', () => {
  const moved = `<svg viewBox="0 0 200 200"><path transform="translate(5,5)" d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  assert.throws(() => parseSVGComponents(moved), /transform/);

  const stretched =
    `<svg viewBox="0 0 200 100" preserveAspectRatio="none" width="100mm" height="100mm">` +
    `<path d="${pathOf(box(10, 10, 50, 50))}" /></svg>`;
  assert.throws(() => parseSVGComponents(stretched), /preserveAspectRatio/);
});

test('a file with no shapes at all says so', () => {
  assert.throws(() => parseSVGComponents('<svg viewBox="0 0 10 10"><title>x</title></svg>'), /No <polygon/);
});

// --- grouping on its own -------------------------------------------------

test('a ring inside a hole is not silently treated as a piece', () => {
  // An island in the middle of a hole. Rare, but it must not become a
  // free-floating component the nester tries to place.
  const { components } = groupSubpaths([
    box(0, 0, 100, 100),
    box(20, 20, 60, 60),
    box(40, 40, 20, 20),
  ]);
  assert.equal(components.length, 1, 'only the outermost ring is a piece');
  assert.equal(components[0].interior.length, 2);
});
