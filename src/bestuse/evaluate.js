import { nestBestOrientation } from '../nesting/orient.js';
import { polygonArea } from '../nesting/geometry.js';
import { resolveClearances } from '../nesting/clearance.js';

// The search grid, coarser than the nester's own 1mm default. See the note
// at the nest() call below for why the two differ.
export const DEFAULT_SEARCH_GRID_MM = 5;

// Parts are named `${componentId}#${n}` because one component becomes many
// parts. Exported so a caller rendering placements can get back to the
// component without re-deriving the scheme and drifting from it.
export const componentIdOf = (partId) => partId.slice(0, partId.lastIndexOf('#'));

// Turns one candidate into an exactly-nested, scored result. Every number
// here comes from the nester — no estimate reaches this module.
export function evaluateCandidate(hide, candidate, options = {}) {
  const componentsById = new Map();
  const parts = [];

  for (const item of candidate.items) {
    componentsById.set(item.component.id, item.component);
    for (let i = 0; i < item.quantity; i++) {
      parts.push({
        id: `${item.component.id}#${i}`,
        // Lets place() skip the rest of a component once one fails, instead
        // of burning a full grid scan on each provably-doomed repeat.
        componentId: item.component.id,
        polygon: item.component.polygon,
        allowedRotations: item.component.allowedRotations,
        dieClearanceMm: item.component.dieClearanceMm,
      });
    }
  }

  const { parts: cuttable, noDie: noDiePartIds } = resolveClearances(parts, options);
  // The SEARCH defaults coarser than the nester does, and the difference is
  // deliberate. place() stays at 1mm so the existing nest workspace is
  // untouched; this pipeline packs dozens of candidates, and a 1mm scan of a
  // 277-piece candidate measured 172 seconds against 5.5 at 5mm. Every
  // placement is still exact — the coarse layout is genuinely cuttable, it
  // just leaves more waste. Callers that want maximum yield pass 1.
  const gridStepMm = options.gridStepMm ?? DEFAULT_SEARCH_GRID_MM;
  // Nested at several hide orientations, best kept. Placement takes the
  // first position a part fits, scanning bottom-left, so which way the hide
  // faces decides the whole layout — measured at 47 pieces one way and 58
  // another on the same real offcut. Costs one nest per orientation.
  const { placements, noFit: noFitPartIds } = nestBestOrientation(hide.outlinePolygon, cuttable, {
    ...options,
    gridStepMm,
  });

  // resolveClearances and nest() both speak in PART ids ("strap#3"), because
  // one component becomes many parts. The operator thinks in components, so
  // fold both lists back and deduplicate.
  const toComponentIds = (partIds) => {
    const seen = [];
    for (const partId of partIds) {
      const componentId = componentIdOf(partId);
      if (!seen.includes(componentId)) seen.push(componentId);
    }
    return seen;
  };

  const counts = {};
  for (const placement of placements) {
    const componentId = componentIdOf(placement.id);
    counts[componentId] = (counts[componentId] ?? 0) + 1;
  }

  let value = 0;
  let placedArea = 0;
  let demandSatisfied = 0;
  const unpriced = [];

  for (const [componentId, count] of Object.entries(counts)) {
    const component = componentsById.get(componentId);
    // An unpriced component is not free to make, it is unpriced. It adds 0
    // and is named, so a UI can say so rather than showing a confident $0.
    if (component.valuePerPiece == null) unpriced.push(componentId);
    else value += component.valuePerPiece * count;

    placedArea += polygonArea(component.polygon) * count;
    demandSatisfied += Math.min(count, component.demand ?? 0);
  }

  const hideArea = polygonArea(hide.outlinePolygon);
  const unverified = [];
  for (const item of candidate.items) {
    for (const key of item.unverified ?? []) {
      if (!unverified.includes(key)) unverified.push(key);
    }
  }

  return {
    candidateId: candidate.candidateId,
    mode: candidate.mode,
    placements,
    counts,
    value,
    utilization: hideArea > 0 ? placedArea / hideArea : 0,
    demandSatisfied,
    noFit: toComponentIds(noFitPartIds),
    noDie: toComponentIds(noDiePartIds),
    unverified,
    unpriced,
  };
}
