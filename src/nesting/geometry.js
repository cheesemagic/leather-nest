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
