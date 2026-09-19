import { polygonArea, polygonPerimeter } from '../nesting/geometry.js';
import { clearanceFor } from '../nesting/clearance.js';

// Deliberately generous rather than accurate. A shortlist's only job is to
// avoid discarding a winner: over-estimating costs one wasted exact nest,
// while under-estimating silently loses the best answer. Measured packing on
// an irregular outline runs 60-70%, so 0.75 keeps this an upper bound.
export const PACKING_EFFICIENCY = 0.75;

// What a candidate ASKS FOR, which is a different question from what the
// shortlist ranks by, and deliberately higher.
//
// The shortlist needs an upper bound it can trust not to discard a winner.
// A candidate's quantity has no such constraint: nest() places what fits and
// reports the rest as noFit, so over-asking costs a little search time and
// nothing else, while under-asking silently leaves leather uncut.
//
// Measured (scripts/c3-spike.mjs, 4 outlines x 3 strategies): moving the ASK
// from 0.75 to 0.95 raised value 8-11% and utilization 2-17% on every
// fixture, and captured the entire gain of a full mixed-component search on
// the value question. It SATURATES at 0.95 — 1.20 and 1.60 scored identically
// and only cost time, because the surplus is discarded. Hence 0.95 rather
// than "as high as possible".
export const ASK_EFFICIENCY = 0.95;

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
