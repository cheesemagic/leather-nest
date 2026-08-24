import {
  getClipperLib,
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  toClipperPath,
  placedPolygon,
  SCALE,
} from './geometry.js';
import { computeNFP } from './nfp.js';

export const GRID_STEP_MM = 1;

export function place(sheetPolygon, parts) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;

  // v0 assumes a rectangular sheet, so containment is a simple AABB check
  // against sheetBounds rather than a general inner-fit-polygon (see spec
  // Non-goals). computeNFP is only used for part-vs-placed-part overlap.
  const placed = [];
  const placements = [];
  const noFit = [];

  for (const part of parts) {
    let accepted = null;

    for (const rotation of part.allowedRotations) {
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));
      const partBounds = boundingBox(normalized);
      const width = partBounds.maxX;
      const height = partBounds.maxY;

      if (width > sheetWidth || height > sheetHeight) {
        continue;
      }

      const maxX = sheetBounds.maxX - width;
      const maxY = sheetBounds.maxY - height;
      const forbiddenRegions = placed.flatMap((p) => computeNFP(p.polygon, normalized));
      // Forbidden regions don't change during the grid scan below, so
      // convert to clipper format once per rotation trial rather than once
      // per candidate point (was 4.8x slower re-converting per point).
      const forbiddenClipperPaths = forbiddenRegions.map(toClipperPath);

      let found = null;
      // Bottom-left-fill scan: rows from sheet minY upward, left to right
      // within each row, first valid position wins.
      for (let y = sheetBounds.minY; y <= maxY && !found; y += GRID_STEP_MM) {
        for (let x = sheetBounds.minX; x <= maxX && !found; x += GRID_STEP_MM) {
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
            found = { x, y, rotation, polygon: placedPolygon(part, { x, y, rotation }) };
          }
        }
      }

      if (found) {
        accepted = found;
        break;
      }
    }

    if (accepted) {
      placed.push({ polygon: accepted.polygon });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
    } else {
      noFit.push(part.id);
    }
  }

  return { placements, noFit };
}
