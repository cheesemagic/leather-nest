import { polygonArea, polygonPerimeter } from '../nesting/geometry.js';
import { clearanceFor } from '../nesting/clearance.js';

// Deliberately generous rather than accurate. A shortlist's only job is to
// avoid discarding a winner: over-estimating costs one wasted exact nest,
// while under-estimating silently loses the best answer. Measured packing on
// an irregular outline runs 60-70%, so 0.75 keeps this an upper bound.
export const PACKING_EFFICIENCY = 0.75;

// Cheap, area-only. NEVER returns placements — only nest() produces a layout.
export function estimateCapacity(hide, component, options = {}) {
  const efficiency = options.packingEfficiency ?? PACKING_EFFICIENCY;
  const hideArea = polygonArea(hide.outlinePolygon);
  const cutArea = polygonArea(component.polygon);

  if (!(hideArea > 0) || !(cutArea > 0)) return { pieces: 0, estimatedValue: 0 };

  // What a piece actually OCCUPIES, not what it cuts. For small components
  // the clearance is most of the footprint: a 35x12mm keeper (420mm^2) with
  // a 6mm die board around it takes up 47x24mm (1128mm^2). Estimating on the
  // cut area alone over-counted such a component by 2.7x — and because the
  // bias scales with perimeter-to-area, it hit SMALL parts hardest, which
  // distorted the shortlist's ranking rather than just its magnitude.
  //
  // Computed analytically (A + P*c + pi*c^2) rather than by a real clipper
  // offset, so the cheap stage stays cheap and free of a ClipperLib global.
  // Measured within 2.7% of the exact miter offset, erring LOW — which
  // over-estimates pieces, the safe direction for a shortlist.
  const clearanceMm = clearanceFor(component, options) ?? 0;
  const footprintArea =
    clearanceMm > 0
      ? cutArea + polygonPerimeter(component.polygon) * clearanceMm + Math.PI * clearanceMm ** 2
      : cutArea;

  const pieces = Math.floor((hideArea * efficiency) / footprintArea);
  // An unpriced component is not free, it is unpriced. It scores 0 here and
  // is reported separately downstream.
  const estimatedValue = pieces * (component.valuePerPiece ?? 0);

  return { pieces, estimatedValue };
}

// Mirrors RANKING_STRATEGIES so the shortlist is scored by the same question
// the final ranking asks. Shortlisting by value while ranking by utilization
// would discard the utilization winner before it was ever nested.
export const ESTIMATE_SCORERS = {
  value: (estimate) => estimate.estimatedValue,
  utilization: (estimate, component) =>
    estimate.pieces * polygonArea(component.polygon),
  demand: (estimate, component) => Math.min(estimate.pieces, component.demand ?? 0),
};
