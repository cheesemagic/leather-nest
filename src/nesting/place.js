import {
  getClipperLib,
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  toClipperPath,
  placedPolygon,
  polygonContains,
  SCALE,
} from './geometry.js';
import { computeNFP } from './nfp.js';

export const GRID_STEP_MM = 1;

export function place(sheetPolygon, parts) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;

  // Containment is tested against the sheet's true outline via
  // polygonContains. The axis-aligned bounds below are kept only as a free
  // pre-filter — they reject far-outside positions before any real work,
  // but they are never the authority on whether a part fits.
  const placed = [];
  const placements = [];
  const noFit = [];

  for (const part of parts) {
    let accepted = null;

    // Records predating the component metadata feature have no
    // allowedRotations key at all; default to full rotation freedom rather
    // than throwing on `for...of undefined`.
    for (const rotation of part.allowedRotations ?? [0, 90, 180, 270]) {
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
            const candidate = placedPolygon(part, { x, y, rotation });
            if (polygonContains(sheetPolygon, candidate)) {
              found = { x, y, rotation, polygon: candidate };
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
      placed.push({ polygon: accepted.polygon });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
    } else {
      noFit.push(part.id);
    }
  }

  return { placements, noFit };
}
