// test/svg-path.test.js
// <path d="..."> import. The `points` form is covered in svg.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSVGPolygon } from '../src/svg/parse.js';
import { boundingBox, polygonArea } from '../src/nesting/geometry.js';

const path = (d, extra = '') => `<svg><path ${extra} d="${d}" /></svg>`;
const close = (n, expected, tolerance = 0.01) =>
  assert.ok(
    Math.abs(n - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, got ${n}`
  );

test('a straight-line path gives the same polygon as the points form', () => {
  const fromPath = parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 Z'));
  const fromPoints = parseSVGPolygon('<polygon points="0,0 40,0 40,20 0,20" />');
  assert.deepEqual(fromPath, fromPoints);
});

test('relative commands describe the same shape as absolute ones', () => {
  const absolute = parseSVGPolygon(path('M 10 10 L 50 10 L 50 30 L 10 30 Z'));
  const relative = parseSVGPolygon(path('m 10 10 l 40 0 l 0 20 l -40 0 z'));
  assert.deepEqual(relative, absolute);
});

test('H and V are honoured, including their relative forms', () => {
  const polygon = parseSVGPolygon(path('M 0 0 H 40 V 20 H 0 Z'));
  assert.deepEqual(polygon, [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 },
  ]);
  assert.deepEqual(parseSVGPolygon(path('M 0 0 h 40 v 20 h -40 z')), polygon);
});

test('extra coordinate pairs after a moveto are implicit linetos', () => {
  // "M 0 0 40 0 40 20 0 20 Z" is a rectangle, per the SVG grammar.
  assert.deepEqual(
    parseSVGPolygon(path('M 0 0 40 0 40 20 0 20 Z')),
    parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 Z'))
  );
});

test('numbers survive missing separators and scientific notation', () => {
  // "40-10" is two numbers; exports emit this to save bytes.
  const polygon = parseSVGPolygon(path('M0 0L40 0L40-10L0-10Z'));
  const bounds = boundingBox(polygon);
  assert.equal(bounds.minY, -10);
  assert.equal(bounds.maxX, 40);
  assert.deepEqual(
    parseSVGPolygon(path('M 0 0 L 4e1 0 L 4e1 2e1 L 0 2e1 Z')),
    parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 Z'))
  );
});

test('a cubic curve flattens inside its control hull', () => {
  // A quarter-turn-ish bulge to the right of a 0,0 -> 0,40 line.
  const polygon = parseSVGPolygon(path('M 0 0 C 20 0 20 40 0 40 L 0 0 Z'));
  const bounds = boundingBox(polygon);

  assert.ok(polygon.length > 8, 'the curve should have been subdivided');
  assert.equal(bounds.minX, 0);
  assert.ok(bounds.maxX > 10 && bounds.maxX <= 20, `bulge was ${bounds.maxX}`);
  assert.equal(bounds.minY, 0);
  assert.equal(bounds.maxY, 40);
});

test('a smooth cubic reflects the previous control point', () => {
  // Every control point WRITTEN here is non-negative in x, so the only way
  // the shape can reach negative x is the reflection: the preceding C ends at
  // 0,20 with its second control at 10,20, which mirrors to -10,20.
  // An earlier version of this test wrote "S -10 40" and passed against a
  // parser that never reflected at all.
  const polygon = parseSVGPolygon(path('M 0 0 C 10 0 10 20 0 20 S 10 40 0 40 L 5 20 Z'));
  const bounds = boundingBox(polygon);

  assert.ok(bounds.minX < -1, `reflection should swing negative, got ${bounds.minX}`);
  assert.ok(bounds.maxX > 1, 'and the explicit control should swing positive');
});

test('quadratic and smooth-quadratic curves actually bow', () => {
  // Counting points is not enough: a curve collapsed to its chord still
  // subdivides, just along a straight line. Check the bulge itself. A
  // quadratic peaks at the midpoint of its control hull, so this one should
  // reach y = 10, half of the control point's 20.
  // The control x is deliberately NOT the midpoint of the endpoints: at
  // x1 = 20 the quadratic and the straight chord give identical x values, so
  // a collapsed x would be invisible.
  const q = parseSVGPolygon(path('M 0 0 Q 5 20 40 0 L 40 -5 L 0 -5 Z'));
  const peak = Math.max(...q.map((point) => point.y));
  close(peak, 10, 0.2);
  // At the halfway parameter the curve sits at x = (0 + 2*5 + 40)/4 = 12.5,
  // well short of the chord's 20.
  const atPeak = q.find((point) => Math.abs(point.y - peak) < 0.01);
  close(atPeak.x, 12.5, 0.6);

  // T mirrors the previous quadratic's control point, so the second hump bows
  // the opposite way. The closing path runs along POSITIVE y, so any negative
  // y in the result can only have come from the reflected hump — closing it
  // at y = -20 instead made the assertion true no matter what T did.
  const t = parseSVGPolygon(path('M 0 0 Q 10 10 20 0 T 40 0 L 40 20 L 0 20 Z'));
  const bounds = boundingBox(t);
  assert.ok(bounds.maxY > 4, `first hump did not bow, maxY ${bounds.maxY}`);
  assert.ok(
    bounds.minY < -1,
    `the reflected hump should bow the other way, minY was ${bounds.minY}`
  );
});

test('Z returns the pen to the start of the subpath', () => {
  // Drawing after a closepath continues from the subpath start, not from
  // where the pen happened to stop. Rare in exports, but legal and silent
  // if wrong.
  // The trailing lineto must be RELATIVE: an absolute one lands in the same
  // place whether or not Z moved the pen, so it proves nothing.
  const polygon = parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 Z l -10 0'));
  // Pen returns to 0,0, so l -10 0 lands at -10,0 — not at 30,20.
  assert.deepEqual(polygon[polygon.length - 1], { x: -10, y: 0 });
});

test('an arc traces a real circle, not its chord', () => {
  // Two semicircular arcs of radius 20 make a full circle: area ~= pi*r^2.
  const circle = parseSVGPolygon(path('M 0 0 A 20 20 0 0 1 40 0 A 20 20 0 0 1 0 0 Z'));
  const bounds = boundingBox(circle);

  close(bounds.maxX - bounds.minX, 40, 0.2);
  close(bounds.maxY - bounds.minY, 40, 0.2);
  // Flattening inscribes the polygon, so area lands just under the true circle.
  const area = polygonArea(circle);
  assert.ok(area > Math.PI * 400 * 0.99, `area ${area.toFixed(1)} too small`);
  assert.ok(area <= Math.PI * 400, `area ${area.toFixed(1)} exceeds the true circle`);
});

test('arc flags select the right one of the four possible arcs', () => {
  // Radius 30 across a 40mm chord, deliberately NOT r=20: when the chord is
  // exactly the diameter both flags describe the same semicircle, and a test
  // written that way passes against a parser that ignores the flag entirely.
  const small = parseSVGPolygon(path('M 0 0 A 30 30 0 0 1 40 0 L 20 -40 Z'));
  const large = parseSVGPolygon(path('M 0 0 A 30 30 0 1 1 40 0 L 20 -40 Z'));

  const width = (polygon) => {
    const b = boundingBox(polygon);
    return b.maxX - b.minX;
  };
  // The minor arc stays inside the chord; the major arc swings past both ends.
  close(width(small), 40, 0.1);
  close(width(large), 60, 0.2);
});

test('the sweep flag mirrors the arc to the other side of the chord', () => {
  const up = parseSVGPolygon(path('M 0 0 A 30 30 0 0 1 40 0 L 20 -40 Z'));
  const down = parseSVGPolygon(path('M 0 0 A 30 30 0 0 0 40 0 L 20 40 Z'));
  assert.ok(boundingBox(up).minY < 0, 'sweep 1 should bulge one way');
  assert.ok(boundingBox(down).maxY > 0, 'sweep 0 should bulge the other');
});

test('x-axis-rotation is applied to elliptical arcs', () => {
  // Every other arc test here uses a circle, where rotation is a no-op — so
  // they all pass against a parser that drops the parameter. An ellipse
  // rotated 90 degrees is the same shape as one with its radii swapped.
  const extent = (d) => {
    const b = boundingBox(parseSVGPolygon(path(d)));
    return [b.maxX - b.minX, b.maxY - b.minY];
  };

  const rotated = extent('M 0 0 A 40 20 90 0 1 0 80 Z');
  const swapped = extent('M 0 0 A 20 40 0 0 1 0 80 Z');
  close(rotated[0], swapped[0], 0.05);
  close(rotated[1], swapped[1], 0.05);

  // And the unrotated ellipse is a genuinely different shape: four times wider.
  const unrotated = extent('M 0 0 A 40 20 0 0 1 0 80 Z');
  close(unrotated[0], 80, 0.1);
  assert.ok(unrotated[0] > rotated[0] * 3, 'rotation must change the geometry');
});

test('a degenerate arc radius falls back to a straight line', () => {
  assert.deepEqual(
    parseSVGPolygon(path('M 0 0 A 0 0 0 0 1 40 0 L 40 20 L 0 20 Z')),
    parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 Z'))
  );
});

// --- the two deliberate refusals ---------------------------------------

test('a transform is refused rather than silently ignored', () => {
  // Applying it is not implemented, and a die that imports offset would cut
  // wrong while looking fine.
  assert.throws(
    () => parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 Z', 'transform="translate(10,5)"')),
    /transform attribute/
  );
  assert.throws(
    () => parseSVGPolygon('<g transform="scale(2)"><polygon points="0,0 1,0 1,1" /></g>'),
    /transform attribute/
  );
});

test('a path with a hole is refused, not silently reduced to its outline', () => {
  const withHole =
    'M 0 0 L 100 0 L 100 100 L 0 100 Z M 40 40 L 60 40 L 60 60 L 40 60 Z';
  assert.throws(() => parseSVGPolygon(path(withHole)), /subpaths/);
});

// --- malformed input ----------------------------------------------------

test('a shape with neither points nor d reports both forms', () => {
  assert.throws(
    () => parseSVGPolygon('<rect width="10" height="10" />'),
    /No <polygon points.*or <path d/s
  );
});

test('an id attribute is not mistaken for the d attribute', () => {
  assert.throws(() => parseSVGPolygon('<path id="outline" />'), /No <polygon points/);
});

test('drawing before a moveto is refused', () => {
  assert.throws(() => parseSVGPolygon(path('L 10 10 L 20 20 Z')), /before any moveto/);
});

test('a path enclosing no area is refused', () => {
  assert.throws(() => parseSVGPolygon(path('M 0 0 L 10 10')), /encloses no area/);
});

test('an unsupported command is named rather than skipped', () => {
  assert.throws(() => parseSVGPolygon(path('M 0 0 B 5 L 10 10 L 0 10 Z')), /Unsupported|number/);
});

test('an explicit return to the start does not leave a duplicate vertex', () => {
  // Many exports close with a lineto back to the origin AND a Z. That would
  // leave a zero-length edge, which the nester has no reason to carry into
  // every NFP it computes.
  const explicit = parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 L 0 0 Z'));
  const implicit = parseSVGPolygon(path('M 0 0 L 40 0 L 40 20 L 0 20 Z'));

  assert.deepEqual(explicit, implicit);
  assert.equal(explicit.length, 4);
});

test('a rounded-corner die outline imports at the right size', () => {
  // The shape a real export produces for a 60x40mm die with 5mm radius
  // corners: straight runs joined by quarter-circle arcs, relative commands,
  // no separators between a number and a following minus sign.
  const d =
    'M 5,0 H 55 A 5,5 0 0 1 60,5 V 35 A 5,5 0 0 1 55,40 H 5 ' +
    'A 5,5 0 0 1 0,35 V 5 A 5,5 0 0 1 5,0 Z';
  const polygon = parseSVGPolygon(path(d));
  const bounds = boundingBox(polygon);

  close(bounds.maxX - bounds.minX, 60, 0.01);
  close(bounds.maxY - bounds.minY, 40, 0.01);

  // 60x40 minus the four corner bites: 2400 - (100 - 25*pi) = 2378.5mm^2.
  // A parser that straight-lined the arcs would cut the corners off and land
  // near 2350; one that ignored them entirely would report the full 2400.
  close(polygonArea(polygon), 2400 - (100 - 25 * Math.PI), 1.0);
});
