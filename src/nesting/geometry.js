export function getClipperLib() {
  if (!globalThis.ClipperLib) {
    throw new Error(
      'ClipperLib global not found — load clipper-lib before using nesting ' +
        'functions (see public/index.html <script> tag or test setup).'
    );
  }
  return globalThis.ClipperLib;
}

export const SCALE = 1000;

export function toClipperPath(polygon) {
  const ClipperLib = getClipperLib();
  return polygon.map(
    (p) => new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
  );
}

export function fromClipperPath(path) {
  return path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

export function rotatePolygon(polygon, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return polygon.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
}

export function translatePolygon(polygon, dx, dy) {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function boundingBox(polygon) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// Coordinates are millimetres and clipper works at 0.001mm, so a nanometre
// of slop absorbs floating-point drift from rotation without admitting any
// real gap.
const ON_SEGMENT_EPSILON = 1e-9;

function isOnSegment(pt, a, b) {
  const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
  if (Math.abs(cross) > ON_SEGMENT_EPSILON) return false;
  return (
    pt.x >= Math.min(a.x, b.x) - ON_SEGMENT_EPSILON &&
    pt.x <= Math.max(a.x, b.x) + ON_SEGMENT_EPSILON &&
    pt.y >= Math.min(a.y, b.y) - ON_SEGMENT_EPSILON &&
    pt.y <= Math.max(a.y, b.y) + ON_SEGMENT_EPSILON
  );
}

// Boundary-inclusive: a point exactly on an edge counts as inside. The
// on-segment pass runs FIRST because ray casting is not merely ambiguous on
// the boundary, it is asymmetric — a half-open convention reads a point
// flush on the left edge as inside and one flush on the right edge as
// outside. place.js deliberately allows a part to sit flush against the
// far edge, so without this pass every such placement would be rejected.
export function pointInPolygon(pt, polygon) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (isOnSegment(pt, polygon[j], polygon[i])) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Strict crossing only: collinear or merely touching segments do not count,
// which is what lets a part sit flush against the outline.
function segmentsProperlyCross(p1, p2, p3, p4) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// True when `inner` lies entirely within `outer`. Both conditions are
// required: the vertex test alone admits a part spanning a concavity with
// all its corners on material, and the edge test alone admits a part
// sitting entirely outside.
export function polygonContains(outer, inner) {
  if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
  if (outer.length < 3 || inner.length < 3) return false;

  for (const pt of inner) {
    if (!pointInPolygon(pt, outer)) return false;
  }
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j];
      const d = outer[(j + 1) % outer.length];
      if (segmentsProperlyCross(a, b, c, d)) return false;
    }
  }

  // The cheap tests above are a fast reject, not the authority. They have a
  // blind spot: when a part's edges are exactly collinear with the outline's
  // (integer coordinates on a 1mm grid make this reachable), no edge
  // *properly* crosses and every vertex reads inside via the boundary rule,
  // yet the part can still span a notch and sit over air. Clipper's exact
  // difference closes that gap. It only runs on candidates that survive both
  // cheap tests, which in a grid scan is a handful per part.
  const ClipperLib = getClipperLib();
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(toClipperPath(inner), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(toClipperPath(outer), ClipperLib.PolyType.ptClip, true);
  const leftover = new ClipperLib.Paths();
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    leftover,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  let outsideArea = 0;
  for (const path of leftover) outsideArea += Math.abs(ClipperLib.Clipper.Area(path));
  return outsideArea / (SCALE * SCALE) < 1e-6;
}

// Grows a polygon outward by `mm` on every side. Used to apply a part's
// clearance: the inflated shape is what gets fit-tested, while the true
// polygon is what gets cut.
// Shrinks a polygon inward. The mirror of inflatePolygon, and separate from
// it because inflate deliberately ignores a negative distance — callers pass
// clearances there, and a negative clearance is a mistake, not an instruction
// to shrink.
//
// Returns null when the shape collapses: a 3mm hole shrunk by 2mm a side has
// nothing left, and silently returning the original would cut it at full size.
export function deflatePolygon(polygon, mm) {
  if (!(mm > 0)) return polygon;
  const ClipperLib = getClipperLib();
  const offset = new ClipperLib.ClipperOffset();
  offset.AddPath(toClipperPath(polygon), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, -mm * SCALE);
  if (!solution.length) return null;

  let largest = solution[0];
  for (const path of solution) {
    if (Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(largest))) {
      largest = path;
    }
  }
  const shrunk = fromClipperPath(largest);
  return shrunk.length >= 3 ? shrunk : null;
}

// Drops points that sit within `toleranceMm` of the line between their
// neighbours (Douglas-Peucker).
//
// This is not tidying — it is the difference between a usable program and an
// unusable one. Nesting cost between two placed parts scales with the product
// of their vertex counts, and a real pattern traced from a supplier's file
// carries far more points than its shape needs. The card-wallet back that
// prompted this arrived with 207 points; placing eight of them took 263
// seconds. At 0.25mm tolerance it becomes 34 points, the area moves by 0.11%,
// and the same eight place in 1.0 second.
//
// 0.25mm is well under the width the laser beam itself removes, so the error
// is smaller than the cut it is describing.
export function simplifyPolygon(polygon, toleranceMm) {
  if (!Array.isArray(polygon) || polygon.length < 4 || !(toleranceMm > 0)) return polygon;

  const squareTolerance = toleranceMm * toleranceMm;
  const squareDistanceToSegment = (point, start, end) => {
    let x = start.x;
    let y = start.y;
    const dx = end.x - x;
    const dy = end.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = end.x;
        y = end.y;
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    return (point.x - x) ** 2 + (point.y - y) ** 2;
  };

  const keep = new Uint8Array(polygon.length);
  keep[0] = 1;
  keep[polygon.length - 1] = 1;
  const stack = [[0, polygon.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = squareDistanceToSegment(polygon[i], polygon[first], polygon[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > squareTolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const simplified = polygon.filter((_, i) => keep[i]);
  // Never hand back something that is no longer a shape.
  return simplified.length >= 3 ? simplified : polygon;
}

export function inflatePolygon(polygon, mm) {
  if (!(mm > 0)) return polygon;
  const ClipperLib = getClipperLib();
  const offset = new ClipperLib.ClipperOffset();
  offset.AddPath(toClipperPath(polygon), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, mm * SCALE);
  if (!solution.length) return polygon;

  let largest = solution[0];
  for (const path of solution) {
    if (Math.abs(ClipperLib.Clipper.Area(path)) > Math.abs(ClipperLib.Clipper.Area(largest))) {
      largest = path;
    }
  }
  return fromClipperPath(largest);
}

// Shoelace formula. Absolute value so winding order doesn't matter, and
// rotation/translation preserve area — so a part's raw polygon area is
// exact for every placement of it, no transform needed first.
export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Perimeter, for estimating how much a polygon grows when inflated without
// paying for a real clipper offset. See estimateCapacity.
export function polygonPerimeter(polygon) {
  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function normalizeToOrigin(polygon) {
  const bounds = boundingBox(polygon);
  return translatePolygon(polygon, -bounds.minX, -bounds.minY);
}

// The one place the placement transform (rotate -> normalize to origin ->
// translate) is implemented. Used by placement, SVG export, preview
// rendering, and tests so all four stay in lockstep.
//
// Takes arbitrary points rather than only the outline, because a component's
// interior cuts — holes, stitch guides — have to land in the same frame as
// the piece they belong to. Crucially the offset comes from the ROTATED
// OUTLINE's bounds, not from the points' own: a hole normalised to its own
// bounding box would sit wherever its piece's corner is, which is how a hole
// ends up neatly punched through the wrong part of the leather.
export function placedPoints(part, placement, points) {
  const rotatedOutline = rotatePolygon(part.polygon, placement.rotation);
  const { minX, minY } = boundingBox(rotatedOutline);
  const rotated = rotatePolygon(points, placement.rotation);
  const normalized = rotated.map((point) => ({ x: point.x - minX, y: point.y - minY }));
  return translatePolygon(normalized, placement.x, placement.y);
}

export function placedPolygon(part, placement) {
  return placedPoints(part, placement, part.polygon);
}

export function polygonToSVGPoints(polygon) {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ');
}

// Added 2026-09-27. Geometry enters this app from two places -- an OpenCV
// contour traced off a photograph, and an uploaded SVG -- and until now
// neither was checked before being written to a record. A broken outline does
// not announce itself either: clipper applies a fill rule to a
// self-intersecting path rather than complaining, so a hide whose outline
// crosses itself yields containment answers that look authoritative and are
// wrong about where the leather actually is.
//
// Returns a sentence for the operator, or null when the polygon is usable.
// Deliberately not a repair. A polygon this badly formed means the photo, the
// selected region or the file was wrong, and silently straightening it would
// hide the thing they need to fix.

// A hide is under two metres and the largest laser bed in reach is about 1.5m,
// so ten metres is nowhere near a real constraint -- it is a unit-error trap.
// The realistic failure is an SVG read in the wrong unit, which lands 10x to
// 100x out, and a 10m wallet piece is certainly one of those.
export const MAX_DIMENSION_MM = 10_000;

// One square millimetre. Every real pattern piece and hide is orders of
// magnitude above this; anything below it is a tracing artefact, not a shape.
export const MIN_AREA_SQ_MM = 1;

export function validatePolygon(polygon) {
  if (!Array.isArray(polygon)) return 'The outline is missing.';

  // A closing point that repeats the first is how plenty of drawing tools
  // write a closed path, and every function here treats a point array as
  // implicitly closed. Tolerated rather than rejected: it is a notation
  // difference, not a broken shape.
  const points = closingPointRemoved(polygon);

  if (points.length < 3) {
    return `An outline needs at least 3 points; this one has ${points.length}.`;
  }
  for (const point of points) {
    if (
      !point ||
      typeof point !== 'object' ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return 'The outline contains a point that is not a pair of numbers.';
    }
  }

  const area = polygonArea(points);
  if (area < MIN_AREA_SQ_MM) {
    // Covers the flat and the doubled-back cases together: three points on one
    // line and a shape that retraces itself both enclose nothing.
    return 'The outline encloses no area — the points are in a line, or on top of each other.';
  }

  const { minX, minY, maxX, maxY } = boundingBox(points);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width > MAX_DIMENSION_MM || height > MAX_DIMENSION_MM) {
    return `The outline measures ${Math.round(width)}mm by ${Math.round(height)}mm, which is too large to be real — check the unit the file was read in.`;
  }

  if (polygonSelfIntersects(points)) {
    return 'The outline crosses itself, so there is no single inside to cut from.';
  }

  return null;
}

function closingPointRemoved(polygon) {
  if (polygon.length < 2) return polygon;
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (!first || !last || typeof first !== 'object' || typeof last !== 'object') return polygon;
  return first.x === last.x && first.y === last.y ? polygon.slice(0, -1) : polygon;
}

// Exported because holes need the same test as outlines: src/interior.js checks
// closed cut rings with it. A crossing ring has no single inside, whether it is
// the edge of the piece or the edge of a hole in it.
//
// ponytail: every edge against every other, O(n²). Outlines here run to a few
// hundred points -- a 280-vertex hide is ~39k segment tests, microseconds --
// so a sweep-line is not worth its own bugs. Revisit if outlines ever reach
// thousands of points.
//
// Reuses segmentsProperlyCross, so touching and collinear edges do NOT count.
// That matters: simplifyPolygon leaves collinear runs behind, and a real
// traced outline often doubles back exactly along an edge without ever
// enclosing two separate insides.
export function polygonSelfIntersects(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    // j starts past i's neighbour, and the last edge is skipped when i is 0,
    // because adjacent edges share a vertex by definition.
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsProperlyCross(a1, a2, points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}
