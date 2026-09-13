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
  return true;
}

// Grows a polygon outward by `mm` on every side. Used to apply a part's
// clearance: the inflated shape is what gets fit-tested, while the true
// polygon is what gets cut.
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
// rotation/translation preserve area — so a die's raw polygon area is
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

export function normalizeToOrigin(polygon) {
  const bounds = boundingBox(polygon);
  return translatePolygon(polygon, -bounds.minX, -bounds.minY);
}

// The one place the placement transform (rotate -> normalize to origin ->
// translate) is implemented. Used by placement, SVG export, preview
// rendering, and tests so all four stay in lockstep.
export function placedPolygon(part, placement) {
  const normalized = normalizeToOrigin(rotatePolygon(part.polygon, placement.rotation));
  return translatePolygon(normalized, placement.x, placement.y);
}

export function polygonToSVGPoints(polygon) {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ');
}
