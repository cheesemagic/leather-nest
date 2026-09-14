import { polygonArea } from '../nesting/geometry.js';

// Deliberately generous rather than accurate. A shortlist's only job is to
// avoid discarding a winner: over-estimating costs one wasted exact nest,
// while under-estimating silently loses the best answer. Measured packing on
// an irregular outline runs 60-70%, so 0.75 keeps this an upper bound.
export const PACKING_EFFICIENCY = 0.75;

// Cheap, area-only. NEVER returns placements — only nest() produces a layout.
export function estimateCapacity(hide, component, options = {}) {
  const efficiency = options.packingEfficiency ?? PACKING_EFFICIENCY;
  const hideArea = polygonArea(hide.outlinePolygon);
  const partArea = polygonArea(component.polygon);

  if (!(hideArea > 0) || !(partArea > 0)) return { pieces: 0, estimatedValue: 0 };

  const pieces = Math.floor((hideArea * efficiency) / partArea);
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
