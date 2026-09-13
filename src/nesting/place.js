import {
  getClipperLib,
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  toClipperPath,
  placedPolygon,
  polygonContains,
  inflatePolygon,
  translatePolygon,
  SCALE,
} from './geometry.js';
import { computeNFP } from './nfp.js';

export const GRID_STEP_MM = 1;

export function place(sheetPolygon, parts, options = {}) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;
  const defaultClearanceMm = options.clearanceMm;

  // Containment is tested against the sheet's true outline via
  // polygonContains, which is now exact (backed by a clipper difference, not
  // just the cheap vertex/edge checks). The axis-aligned bounds below are
  // kept only as a free pre-filter — they reject far-outside positions
  // before any real work, but they are never the authority on whether a
  // part fits. Part-vs-part overlap is a separate story: it still goes
  // through computeNFP (nfp.js), which is exact for convex parts only.
  const placed = [];
  const placements = [];
  const noFit = [];

  for (const part of parts) {
    let accepted = null;

    // Clearances are not shared between neighbours: each part reserves its
    // full clearance around its own cut line, so an 8mm part beside a 2mm
    // part ends up 10mm away. Inflating each by its FULL clearance (rather
    // than half) is what produces that.
    const rawClearance = part.clearanceMm ?? defaultClearanceMm;
    // Cap as well as floor. A finite but absurd clearance (1e18) passes
    // Number.isFinite yet overflows clipper's coordinate range, and clipper
    // reports that by calling alert() — which throws in Node and, worse,
    // returns silently in a browser, leaving placement to run on a bogus
    // offset. Anything wider than the sheet can never fit anyway, so the
    // cap costs no real placement and keeps the offset in range.
    const maxUsefulClearanceMm = sheetWidth + sheetHeight;
    const clearanceMm =
      Number.isFinite(rawClearance) && rawClearance > 0
        ? Math.min(rawClearance, maxUsefulClearanceMm)
        : 0;

    // Records predating the component metadata feature have no
    // allowedRotations key at all; default to full rotation freedom rather
    // than throwing on `for...of undefined`.
    for (const rotation of part.allowedRotations ?? [0, 90, 180, 270]) {
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));

      // The test shape carries the clearance and is deliberately NOT
      // re-normalized: expressed relative to the true part's origin it
      // spans (-c,-c)..(w+c,h+c), which keeps the scan position, the NFP's
      // reference point, and the reported polygon on one shared origin.
      const testShape = inflatePolygon(normalized, clearanceMm);
      const testBounds = boundingBox(testShape);
      const testWidth = testBounds.maxX - testBounds.minX;
      const testHeight = testBounds.maxY - testBounds.minY;

      if (testWidth > sheetWidth || testHeight > sheetHeight) {
        continue;
      }

      const minX = sheetBounds.minX - testBounds.minX;
      const minY = sheetBounds.minY - testBounds.minY;
      const maxX = sheetBounds.maxX - testBounds.maxX;
      const maxY = sheetBounds.maxY - testBounds.maxY;
      const forbiddenRegions = placed.flatMap((p) => computeNFP(p.testPolygon, testShape));
      // Forbidden regions don't change during the grid scan below, so
      // convert to clipper format once per rotation trial rather than once
      // per candidate point (was 4.8x slower re-converting per point).
      const forbiddenClipperPaths = forbiddenRegions.map(toClipperPath);

      let found = null;
      // Bottom-left-fill scan: rows from sheet minY upward, left to right
      // within each row, first valid position wins.
      //
      // Worst case, synchronous, no early exit: a part that fits the
      // sheet's bounding box but no reachable position on the true outline
      // pays a full grid traversal — every (x, y) at GRID_STEP_MM spacing,
      // per allowed rotation — before it's reported noFit. Measured at
      // ~680ms for one such part on a 200-vertex hide; ~6.9s for ten of
      // them in a row. The AABB pre-filter above only catches parts bigger
      // than the box, so "fits the box, not the hide" is the common failure
      // mode on an irregular hide, not an edge case. No caching, early
      // exit, or yielding here by design — that's a later optimization
      // pass, not this fix.
      for (let y = minY; y <= maxY && !found; y += GRID_STEP_MM) {
        for (let x = minX; x <= maxX && !found; x += GRID_STEP_MM) {
          const clipperPoint = new ClipperLib.IntPoint2(
            Math.round(x * SCALE),
            Math.round(y * SCALE)
          );
          const overlapsPlacedPart = forbiddenClipperPaths.some(
            (path) =>
              // 1 = strictly inside (overlap, reject); -1 = on boundary
              // (touching, allowed — enables flush nesting); 0 = outside (allowed).
              ClipperLib.Clipper.PointInPolygon(clipperPoint, path) === 1
          );
          if (!overlapsPlacedPart) {
            const placedTestShape = translatePolygon(testShape, x, y);
            if (polygonContains(sheetPolygon, placedTestShape)) {
              found = {
                x,
                y,
                rotation,
                polygon: placedPolygon(part, { x, y, rotation }),
                testPolygon: placedTestShape,
              };
            }
          }
        }
      }

      if (found) {
        accepted = found;
        break;
      }
    }

    if (accepted) {
      placed.push({ polygon: accepted.polygon, testPolygon: accepted.testPolygon });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
    } else {
      noFit.push(part.id);
    }
  }

  return { placements, noFit };
}
