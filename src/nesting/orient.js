import { nest } from './index.js';
import {
  rotatePolygon,
  normalizeToOrigin,
  boundingBox,
  polygonArea,
  placedPolygon,
} from './geometry.js';

// Nest the same parts onto the hide at several orientations and keep the
// best layout.
//
// Placement is greedy: it takes the FIRST position where a part fits,
// scanning from the bottom left. That makes the result depend entirely on
// which way the hide happens to be facing — the scan either runs along the
// hide's natural grain or across it. Measured on a real traced offcut with a
// real card-wallet pattern:
//
//     as it arrives (0 degrees)    54 pieces, 59% of hide
//     best of nine orientations    60 pieces, 65%   (at 140 degrees)
//     worst orientation            48 pieces, 52%
//
// 11% more pieces for nine times the work, with no new algorithm. Nudging
// the grid origin was measured alongside this and did nothing at all —
// identical results at every offset — so it is deliberately absent.
export const DEFAULT_ORIENTATIONS = 6;

// Each candidate layout is scored on placed area, so a run that fits more
// leather wins even when the piece count ties.
const placedAreaOf = (placements, partsById) =>
  placements.reduce((total, placement) => {
    const part = partsById.get(placement.id);
    return total + (part ? polygonArea(part.polygon) : 0);
  }, 0);

// Placements come back in the rotated hide's frame. Mapping them back is the
// whole risk in this file: get it wrong and every piece is reported in a
// position it does not occupy, which a cut file would then hand to the laser.
//
// Rather than invert the transform algebraically, each placement is re-solved
// in the original frame: rotate the part the other way, and put it where its
// own placed outline lands once that outline is rotated back. The two frames
// therefore agree by construction, not by a derivation that could be off by
// a sign — the failure this repo has already had once, in blotch_match.py.
function mapBack(placements, parts, degrees, rotatedOffset) {
  if (degrees === 0) return placements;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  return placements.map((placement) => {
    const part = partsById.get(placement.id);
    // Where the piece physically sits, in the rotated frame, undoing the
    // normalise-to-origin shift that was applied to the hide.
    const inRotatedFrame = placedPolygon(part, placement).map((point) => ({
      x: point.x + rotatedOffset.x,
      y: point.y + rotatedOffset.y,
    }));
    // The same piece, back in the original hide's frame.
    const inOriginalFrame = rotatePolygon(inRotatedFrame, -degrees);

    // placedPolygon normalises before translating, so the offset is whatever
    // moves the normalised shape onto the outline computed above.
    const rotation = (((placement.rotation - degrees) % 360) + 360) % 360;
    const normalised = normalizeToOrigin(rotatePolygon(part.polygon, rotation));
    const target = boundingBox(inOriginalFrame);
    const source = boundingBox(normalised);

    return {
      id: placement.id,
      rotation,
      x: target.minX - source.minX,
      y: target.minY - source.minY,
    };
  });
}

export function nestBestOrientation(hidePolygon, parts, options = {}) {
  // Number.isFinite first: Math.max(1, Math.floor(NaN)) is NaN, which makes
  // the loop below run zero times and leaves nothing to return.
  const requested = options.orientations ?? DEFAULT_ORIENTATIONS;
  const orientations = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  // Spread across a half turn. A hide turned 180 degrees presents the same
  // shape to a bottom-left scan as the original does, so the second half of
  // the circle repeats the first.
  let best = null;
  for (let i = 0; i < orientations; i++) {
    // forceDegrees exists so a test can nest at one named angle and check
    // that the search really does return the best of them, rather than
    // whichever happened to run last.
    const degrees = options.forceDegrees ?? (180 / orientations) * i;
    const rotated = rotatePolygon(hidePolygon, degrees);
    const bounds = boundingBox(rotated);
    const normalised = normalizeToOrigin(rotated);

    const result = nest(normalised, parts, options);
    const score = placedAreaOf(result.placements, partsById);
    if (!best || score > best.score) {
      best = {
        score,
        degrees,
        result,
        offset: { x: bounds.minX, y: bounds.minY },
      };
    }
  }

  return {
    placements: mapBack(best.result.placements, parts, best.degrees, best.offset),
    noFit: best.result.noFit,
    noDie: best.result.noDie,
    orientationDegrees: best.degrees,
  };
}
