import { nest } from '../nesting/index.js';
import { polygonArea } from '../nesting/geometry.js';
import { resolveClearances } from '../nesting/clearance.js';

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
  const { placements, noFit: noFitPartIds } = nest(hide.outlinePolygon, cuttable);

  // resolveClearances and nest() both speak in PART ids ("strap#3"), because
  // one component becomes many parts. The operator thinks in components, so
  // fold both lists back and deduplicate.
  const componentIdOf = (partId) => partId.slice(0, partId.lastIndexOf('#'));
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
