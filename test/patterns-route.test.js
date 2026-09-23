// test/patterns-route.test.js
// Importing a whole pattern file: several pieces from one upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer as withServerBase } from './helpers/with-server.js';

function withServer(fn) {
  return withServerBase(fn, { withPartsDataDir: true });
}

// Two pieces, each an outline plus a couple of stitch holes — the shape of a
// real pattern file. Coordinates are bare numbers, so the unit is ambiguous,
// which is the case that matters.
const ring = (cx, cy, r) =>
  Array.from({ length: 8 }, (_, i) => {
    const t = (i / 8) * Math.PI * 2;
    return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`;
  });
const path = (points) => `M ${points.join(' L ')} Z`;
const box = (x, y, w, h) => [`${x},${y}`, `${x + w},${y}`, `${x + w},${y + h}`, `${x},${y + h}`];
const PATTERN =
  '<svg viewBox="0 0 400 200">' +
  `<path d="${[path(box(10, 10, 100, 150)), path(ring(40, 40, 2)), path(ring(70, 40, 2))].join(' ')}" />` +
  `<path d="${[path(box(150, 10, 100, 120)), path(ring(180, 40, 2))].join(' ')}" />` +
  '</svg>';

const upload = (baseUrl, svg, fields = {}) => {
  const form = new FormData();
  form.append('svg', new Blob([svg]), 'pattern.svg');
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return form;
};

test('preview reports what is in the file without saving anything', () => {
  return withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/patterns/preview`, {
      method: 'POST', body: upload(baseUrl, PATTERN),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.pieces.length, 2);
    assert.equal(body.pieces[0].interiorCount, 2);
    assert.equal(body.pieces[1].interiorCount, 1);

    // Nothing was created.
    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 0, 'preview must not save');
  });
});

test('preview offers a size for each unit the file could be in', () => {
  return withServer(async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/patterns/preview`, {
      method: 'POST', body: upload(baseUrl, PATTERN),
    })).json();

    assert.equal(body.statesItsOwnSize, false);
    const mm = body.units.find((u) => u.unit === 'mm');
    const pt = body.units.find((u) => u.unit === 'pt');
    assert.ok(mm && pt, 'both readings should be offered');
    // The whole reason this is asked: the same file is 2.8x bigger read one
    // way than the other. A real pattern came out near A4 against a wallet.
    assert.ok(mm.widthMm > pt.widthMm * 2, 'the readings should differ sharply');
  });
});

test('one file becomes one component per piece', () => {
  return withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(baseUrl, PATTERN, { name: 'card wallet', unit: 'mm', demand: 4 }),
    });
    const created = await response.json();

    assert.equal(response.status, 200);
    assert.equal(created.length, 2);
    assert.deepEqual(created.map((c) => c.name), ['card wallet 1', 'card wallet 2']);
    for (const component of created) assert.equal(component.demand, 4);

    const parts = await (await fetch(`${baseUrl}/parts`)).json();
    assert.equal(parts.length, 2);
  });
});

test('the stitch holes come through with the pieces', () => {
  return withServer(async (baseUrl) => {
    const created = await (await fetch(`${baseUrl}/patterns`, {
      method: 'POST', body: upload(baseUrl, PATTERN, { name: 'wallet', unit: 'mm' }),
    })).json();

    assert.equal(created[0].interiorPaths.length, 2);
    assert.equal(created[1].interiorPaths.length, 1);
    for (const path of created[0].interiorPaths) assert.equal(path.kind, 'cut');
  });
});

test('holes can be marked instead of cut', () => {
  // A stitch guide is geometrically identical to a hole that must be cut, so
  // the file cannot say. Cutting the wrong one slits the piece.
  return withServer(async (baseUrl) => {
    const created = await (await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(baseUrl, PATTERN, { name: 'wallet', unit: 'mm', interiorKind: 'mark' }),
    })).json();

    for (const path of created[0].interiorPaths) assert.equal(path.kind, 'mark');
  });
});

test('the chosen unit sizes the pieces', () => {
  return withServer(async (baseUrl) => {
    const asMm = await (await fetch(`${baseUrl}/patterns`, {
      method: 'POST', body: upload(baseUrl, PATTERN, { name: 'a', unit: 'mm' }),
    })).json();
    const asPt = await (await fetch(`${baseUrl}/patterns`, {
      method: 'POST', body: upload(baseUrl, PATTERN, { name: 'b', unit: 'pt' }),
    })).json();

    const width = (component) => {
      const xs = component.polygon.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    assert.ok(Math.abs(width(asMm[0]) - 100) < 1, `expected 100mm, got ${width(asMm[0])}`);
    assert.ok(Math.abs(width(asPt[0]) - 100 * 25.4 / 72) < 1, `expected 35mm, got ${width(asPt[0])}`);
  });
});

test('a single-piece file keeps the name it was given', () => {
  return withServer(async (baseUrl) => {
    const single = `<svg viewBox="0 0 200 200"><path d="${path(box(10, 10, 50, 50))}" /></svg>`;
    const created = await (await fetch(`${baseUrl}/patterns`, {
      method: 'POST', body: upload(baseUrl, single, { name: 'keeper', unit: 'mm' }),
    })).json();

    assert.equal(created.length, 1);
    assert.equal(created[0].name, 'keeper', 'a lone piece should not be numbered');
  });
});

test('a file the importer refuses explains itself', () => {
  return withServer(async (baseUrl) => {
    // A dashed stroke: real patterns draw a row of stitch holes as ONE
    // dashed line, and every importer keeps the line and drops the dashes.
    const dashed =
      `<svg viewBox="0 0 200 200"><path stroke-dasharray="2 2" d="${path(box(10, 10, 50, 50))}" /></svg>`;
    const response = await fetch(`${baseUrl}/patterns/preview`, {
      method: 'POST', body: upload(baseUrl, dashed),
    });
    const body = await response.json();

    assert.equal(response.status, 422);
    assert.match(body.error, /dashed stroke/i);
  });
});

test('importing without a name is refused', () => {
  return withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST', body: upload(baseUrl, PATTERN, { unit: 'mm' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /name/i);
  });
});

test('a negative price is refused rather than stored', () => {
  return withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/patterns`, {
      method: 'POST',
      body: upload(baseUrl, PATTERN, { name: 'x', unit: 'mm', valuePerPiece: -5 }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valuePerPiece/);
  });
});

test('no file at all is refused', () => {
  return withServer(async (baseUrl) => {
    const form = new FormData();
    form.append('name', 'x');
    const response = await fetch(`${baseUrl}/patterns`, { method: 'POST', body: form });
    assert.equal(response.status, 400);
  });
});
