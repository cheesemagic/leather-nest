// Turns one SVG shape into the flat point array the nester works in.
//
// Two accepted forms: a `points` attribute (<polygon>/<polyline>), which is
// what this understood originally, and a `d` attribute (<path>), which is what
// every real vector export actually produces. Curves are flattened to line
// segments because `component.polygon` is a point array and the nester has no
// curve representation.
//
// UNITS: coordinates are millimetres, as the `points` form has always assumed.
// When the root <svg> declares BOTH a physical size and a viewBox, that
// assumption is wrong and the file says so — width="100mm" over
// viewBox="0 0 1000 1000" means each user unit is 0.1mm, and importing it
// unscaled would be 10x out. scaleFactor() below reads that pair and converts.
// A file that gives no physical unit is still taken as millimetres, because
// nothing in it says otherwise and that is what every existing die record
// already assumes.

// One segment per millimetre of curve, clamped. Chord error for a circular arc
// is about s^2/8r, so a 1mm step on a 10mm fillet is off by 0.0125mm — well
// under anything a laser cares about. The ceiling exists because every extra
// vertex costs NFP time in place().
function segmentsFor(approxLengthMm) {
  if (!Number.isFinite(approxLengthMm) || approxLengthMm <= 0) return 4;
  return Math.max(4, Math.min(48, Math.ceil(approxLengthMm)));
}

const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function parsePoints(raw) {
  return raw
    .trim()
    .split(/[\s,]+/)
    .reduce((pairs, value, i) => {
      if (i % 2 === 0) pairs.push([Number(value)]);
      else pairs[pairs.length - 1].push(Number(value));
      return pairs;
    }, [])
    .filter((pair) => pair.length === 2)
    .map(([x, y]) => ({ x, y }));
}

// --------------------------------------------------------------- curves

function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3) {
  const hull =
    distance(x0, y0, x1, y1) + distance(x1, y1, x2, y2) + distance(x2, y2, x3, y3);
  const n = segmentsFor(hull);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    });
  }
  return out;
}

function flattenQuadratic(x0, y0, x1, y1, x2, y2) {
  const hull = distance(x0, y0, x1, y1) + distance(x1, y1, x2, y2);
  const n = segmentsFor(hull);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * x0 + 2 * u * t * x1 + t * t * x2,
      y: u * u * y0 + 2 * u * t * y1 + t * t * y2,
    });
  }
  return out;
}

// Endpoint parameterisation -> centre parameterisation, per SVG 1.1 F.6.5.
// Rounded corners on a die outline arrive as these, so refusing them would
// close the door this change exists to open.
function flattenArc(x1, y1, rx, ry, rotationDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  // A zero radius degenerates to a straight line, which the spec mandates.
  if (rx === 0 || ry === 0) return [{ x: x2, y: y2 }];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Radii too small to span the chord get scaled up, again per the spec.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const numerator = rx * rx * ry * ry - denominator;
  const coefficient =
    (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const value = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -value : value;
  };

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let sweepAngle = angle(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  else if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const n = segmentsFor(Math.abs(sweepAngle) * Math.max(rx, ry));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = theta1 + sweepAngle * (i / n);
    out.push({
      x: cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t) + cx,
      y: sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t) + cy,
    });
  }
  return out;
}

// ------------------------------------------------------------- the path

const PATH_TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;

function tokenizePath(d) {
  const tokens = [];
  for (const match of d.matchAll(PATH_TOKEN)) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  return tokens;
}

function parsePath(d) {
  const tokens = tokenizePath(d);
  const subpaths = [];
  let current = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Where the last cubic/quadratic control point was, for S and T.
  let lastCubicControl = null;
  let lastQuadControl = null;

  let i = 0;
  let command = null;
  const number = () => {
    const value = tokens[i++];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Malformed SVG path: expected a number near "${command}"`);
    }
    return value;
  };
  const push = (points) => {
    for (const point of points) current.push(point);
    if (points.length) {
      x = points[points.length - 1].x;
      y = points[points.length - 1].y;
    }
  };

  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') {
      command = tokens[i++];
    } else if (command === 'M') {
      command = 'L'; // extra pairs after a moveto are implicit linetos
    } else if (command === 'm') {
      command = 'l';
    } else if (command === null) {
      throw new Error('Malformed SVG path: coordinates before any command');
    }

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === 'Z') {
      if (current && current.length) {
        x = startX;
        y = startY;
      }
      continue;
    }

    if (upper === 'M') {
      const nx = number();
      const ny = number();
      x = relative ? x + nx : nx;
      y = relative ? y + ny : ny;
      startX = x;
      startY = y;
      current = [{ x, y }];
      subpaths.push(current);
      lastCubicControl = lastQuadControl = null;
      continue;
    }

    if (!current) throw new Error('Malformed SVG path: drawing before any moveto');

    if (upper === 'L') {
      const nx = number();
      const ny = number();
      push([{ x: relative ? x + nx : nx, y: relative ? y + ny : ny }]);
      lastCubicControl = lastQuadControl = null;
    } else if (upper === 'H') {
      const nx = number();
      push([{ x: relative ? x + nx : nx, y }]);
      lastCubicControl = lastQuadControl = null;
    } else if (upper === 'V') {
      const ny = number();
      push([{ x, y: relative ? y + ny : ny }]);
      lastCubicControl = lastQuadControl = null;
    } else if (upper === 'C' || upper === 'S') {
      let c1x;
      let c1y;
      if (upper === 'C') {
        c1x = relative ? x + number() : number();
        c1y = relative ? y + number() : number();
      } else {
        // S reflects the previous cubic's second control point through the
        // current point; with no previous cubic the control point is the
        // current point itself.
        c1x = lastCubicControl ? 2 * x - lastCubicControl.x : x;
        c1y = lastCubicControl ? 2 * y - lastCubicControl.y : y;
      }
      const c2x = relative ? x + number() : number();
      const c2y = relative ? y + number() : number();
      const ex = relative ? x + number() : number();
      const ey = relative ? y + number() : number();
      const sx = x;
      const sy = y;
      push(flattenCubic(sx, sy, c1x, c1y, c2x, c2y, ex, ey));
      lastCubicControl = { x: c2x, y: c2y };
      lastQuadControl = null;
    } else if (upper === 'Q' || upper === 'T') {
      let cx;
      let cy;
      if (upper === 'Q') {
        cx = relative ? x + number() : number();
        cy = relative ? y + number() : number();
      } else {
        cx = lastQuadControl ? 2 * x - lastQuadControl.x : x;
        cy = lastQuadControl ? 2 * y - lastQuadControl.y : y;
      }
      const ex = relative ? x + number() : number();
      const ey = relative ? y + number() : number();
      const sx = x;
      const sy = y;
      push(flattenQuadratic(sx, sy, cx, cy, ex, ey));
      lastQuadControl = { x: cx, y: cy };
      lastCubicControl = null;
    } else if (upper === 'A') {
      const rx = number();
      const ry = number();
      const rotation = number();
      const largeArc = number() !== 0;
      const sweep = number() !== 0;
      const ex = relative ? x + number() : number();
      const ey = relative ? y + number() : number();
      push(flattenArc(x, y, rx, ry, rotation, largeArc, sweep, ex, ey));
      lastCubicControl = lastQuadControl = null;
    } else {
      throw new Error(`Unsupported SVG path command "${command}"`);
    }
  }

  const drawn = subpaths.filter((points) => points.length >= 3);
  if (drawn.length === 0) {
    throw new Error('SVG path encloses no area — expected at least three points');
  }
  if (drawn.length > 1) {
    // A die with a hole is two subpaths, and component.polygon is a single
    // flat point array — the nester cannot represent a hole. Silently keeping
    // the outer ring would cut through the hole, so refuse instead.
    throw new Error(
      `SVG path has ${drawn.length} subpaths; only a single closed outline is supported. ` +
        'Holes and multi-part shapes cannot be represented.'
    );
  }

  const points = drawn[0];
  // A closing Z leaves the start point repeated at the end; the nester treats
  // polygons as implicitly closed.
  const last = points[points.length - 1];
  if (points.length > 3 && last.x === points[0].x && last.y === points[0].y) points.pop();
  return points;
}

// CSS absolute units, in millimetres. Unitless lengths are deliberately absent:
// per spec they are user units, which is exactly the ambiguous case this
// function refuses to guess at.
const UNIT_TO_MM = {
  mm: 1,
  cm: 10,
  q: 0.25,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
  px: 25.4 / 96,
};

// "100mm" -> 100. "2in" -> 50.8. "100" or "50%" -> null, meaning "this file
// does not state a physical size", which is a different thing from zero.
function physicalLengthMm(raw) {
  if (!raw) return null;
  const match = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  if (!unit || unit === '%') return null;
  const factor = UNIT_TO_MM[unit];
  return factor ? value * factor : null;
}

function rootAttribute(svgTag, name) {
  const match = new RegExp(`[\\s"']${name}\\s*=\\s*"([^"]*)"`, 'i').exec(svgTag);
  return match ? match[1] : null;
}

// How many millimetres one user unit represents. 1 unless the file states a
// physical size alongside a viewBox.
function scaleFactor(svgString) {
  // Only the ROOT <svg> element's attributes count. Searching the whole string
  // would happily read width= off a child <rect> and scale by something
  // unrelated to the document.
  const svgTag = /<svg\b[^>]*>/i.exec(svgString);
  if (!svgTag) return 1;
  const tag = svgTag[0];

  const viewBox = rootAttribute(tag, 'viewBox');
  if (!viewBox) return 1;
  const box = viewBox.trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite)) return 1;
  const [, , boxWidth, boxHeight] = box;

  const widthMm = physicalLengthMm(rootAttribute(tag, 'width'));
  const heightMm = physicalLengthMm(rootAttribute(tag, 'height'));
  const sx = widthMm !== null && boxWidth > 0 ? widthMm / boxWidth : null;
  const sy = heightMm !== null && boxHeight > 0 ? heightMm / boxHeight : null;
  if (sx === null && sy === null) return 1;

  // preserveAspectRatio defaults to "meet", which scales uniformly by the
  // SMALLER ratio and letterboxes the remainder — so a width and height that
  // disagree is normal, not a malformed file, and min() is the spec answer
  // rather than a guess. "none" stretches the axes independently, which would
  // distort the die; that one is refused in parseSVGPolygon.
  if (sx === null) return sy;
  if (sy === null) return sx;
  return Math.min(sx, sy);
}

function scaled(points, scale) {
  if (scale === 1) return points;
  return points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
}

export function parseSVGPolygon(svgString) {
  // A transform on the shape or any ancestor <g> changes the geometry, and
  // applying it is not implemented. Importing a die that is silently offset or
  // scaled is worse than refusing it, so refuse.
  if (/\stransform\s*=\s*"/.test(svgString)) {
    throw new Error(
      'SVG contains a transform attribute, which is not applied. Flatten transforms ' +
        'before export (in Inkscape: Edit > Preferences > Behaviour > Transforms > ' +
        'Store transformation: Optimized) and try again.'
    );
  }

  // preserveAspectRatio="none" scales x and y by different factors, which
  // changes the shape rather than its size. Same reasoning as transforms:
  // a die that imports distorted looks plausible and cuts wrong.
  if (/[\s"']preserveAspectRatio\s*=\s*"\s*none\s*"/i.test(svgString)) {
    throw new Error(
      'SVG uses preserveAspectRatio="none", which stretches the drawing unevenly. ' +
        'Re-export with a viewBox matching the document proportions.'
    );
  }

  const scale = scaleFactor(svgString);

  const points = svgString.match(/points\s*=\s*"([^"]+)"/);
  if (points) return scaled(parsePoints(points[1]), scale);

  const d = svgString.match(/[\s"']d\s*=\s*"([^"]+)"/);
  if (d) return scaled(parsePath(d[1]), scale);

  throw new Error('No <polygon points="..."> or <path d="..."> found in SVG string');
}
