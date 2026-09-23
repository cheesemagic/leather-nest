import { footprintArea, ASK_EFFICIENCY } from './estimate.js';
import { polygonArea } from '../nesting/geometry.js';
import { resolveClearances } from '../nesting/clearance.js';
import { nestBestOrientation } from '../nesting/orient.js';
import { DEFAULT_SEARCH_GRID_MM, componentIdOf } from './evaluate.js';

// Product candidates, single-hide only (see the products spec's "Order of
// work" -- cross-hide is deferred pending evidence it's needed). One
// candidate per product definition, carrying enough to nest it (below) --
// not yet sized to a quantity, because the right quantity is a question a
// single estimate can't answer (see evaluateProductCandidate).
export function productCandidates(eligible, options = {}) {
  const { hide, products } = options;
  if (!products?.length) return [];

  const hideArea = polygonArea(hide.outlinePolygon);
  if (!(hideArea > 0)) return [];

  const byId = new Map(eligible.map((entry) => [entry.component.id, entry]));
  const candidates = [];

  for (const product of products) {
    if (!product.parts?.length) continue;

    // Every part the product needs must be eligible for this hide (species,
    // thickness) or the product can never be completed here at all -- no
    // point nesting a partial bundle just to report it incomplete.
    const entries = product.parts.map((p) => byId.get(p.partId));
    if (entries.some((entry) => !entry)) continue;

    const setFootprint = product.parts.reduce(
      (sum, p, i) => sum + footprintArea(entries[i].component, options) * p.quantity,
      0
    );
    if (!(setFootprint > 0)) continue;

    // Generous upper bound on whole SETS, not pieces -- the search below
    // finds the true ceiling by placement failure, this only has to not
    // undershoot it.
    const maxSets = Math.max(1, Math.floor((hideArea * ASK_EFFICIENCY) / setFootprint));

    candidates.push({ candidateId: `product:${product.id}`, mode: 'products', product, entries, maxSets });
  }

  return candidates;
}

function buildSetParts(product, entries, sets) {
  const parts = [];
  product.parts.forEach((p, i) => {
    const component = entries[i].component;
    // p.quantity is how many of this part ONE set needs -- a wallet with 2
    // pockets per back needs 2*sets pockets, not sets.
    for (let n = 0; n < p.quantity * sets; n++) {
      parts.push({
        id: `${component.id}#${n}`,
        componentId: component.id,
        polygon: component.polygon,
        allowedRotations: component.allowedRotations,
        dieClearanceMm: component.dieClearanceMm,
      });
    }
  });
  return parts;
}

// The real change the products spec calls for: a candidate placing 3 backs
// and 5 pockets has made 2 wallets and wasted a back, and reporting that
// value correctly is not enough on its own -- the wasted back still gets
// cut. This nests only whole sets, together, so nothing wasted is ever
// placed in the first place.
//
// Found by binary search over how many copies of the WHOLE set (one of
// every part, in the product's ratio) can be nested at once, rather than
// asking for each part type's max independently -- which is what let one
// large part type consume the sheet before a smaller, rarer part type got
// its turn (place() sorts every part it's given by size, biggest first,
// across all types at once; see place.js). Monotonic, so the search is
// valid: place() is a strictly sequential greedy scan, so removing items
// from an arrangement that already succeeded can only leave more room for
// what remains, never less -- succeeding at N sets guarantees succeeding at
// any smaller count.
export function evaluateProductCandidate(hide, candidate, options = {}) {
  const { product, entries, maxSets } = candidate;
  const gridStepMm = options.gridStepMm ?? DEFAULT_SEARCH_GRID_MM;

  function tryNest(sets) {
    if (sets === 0) return { placements: [], noFit: [], noDie: [] };
    const { parts: cuttable, noDie } = resolveClearances(buildSetParts(product, entries, sets), options);
    const { placements, noFit } = nestBestOrientation(hide.outlinePolygon, cuttable, {
      ...options,
      gridStepMm,
    });
    return { placements, noFit, noDie };
  }

  // A part with no recorded die clearance under method:'die' is excluded
  // from `cuttable` entirely, at every set count -- so it would otherwise
  // silently read as "0 sets fit" with no explanation. Checked once, since
  // it depends only on the parts involved, not how many of them.
  const { noDie: missingDie } = resolveClearances(buildSetParts(product, entries, 1), options);
  if (missingDie.length > 0) {
    return {
      candidateId: candidate.candidateId,
      mode: 'products',
      productId: product.id,
      productName: product.name,
      completeCount: 0,
      placements: [],
      counts: {},
      value: 0,
      utilization: 0,
      demandSatisfied: 0,
      noFit: [],
      noDie: [...new Set(missingDie.map(componentIdOf))],
      unverified: [...new Set(entries.flatMap((e) => e.unverified ?? []))],
      unpriced: [],
    };
  }

  let lo = 1;
  let hi = maxSets;
  let best = { sets: 0, placements: [] };
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const attempt = tryNest(mid);
    if (attempt.noFit.length === 0) {
      best = { sets: mid, placements: attempt.placements };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const componentsById = new Map(entries.map((e) => [e.component.id, e.component]));
  const counts = {};
  for (const placement of best.placements) {
    const id = componentIdOf(placement.id);
    counts[id] = (counts[id] ?? 0) + 1;
  }

  const unpriced = [];
  let unitValue = 0;
  for (const p of product.parts) {
    const component = componentsById.get(p.partId);
    if (component.valuePerPiece == null) unpriced.push(p.partId);
    else unitValue += component.valuePerPiece * p.quantity;
  }

  const hideArea = polygonArea(hide.outlinePolygon);
  const placedArea = best.placements.reduce((sum, placement) => {
    const component = componentsById.get(componentIdOf(placement.id));
    return sum + (component ? polygonArea(component.polygon) : 0);
  }, 0);

  return {
    candidateId: candidate.candidateId,
    mode: 'products',
    productId: product.id,
    productName: product.name,
    completeCount: best.sets,
    placements: best.placements,
    counts,
    value: best.sets * unitValue,
    utilization: hideArea > 0 ? placedArea / hideArea : 0,
    demandSatisfied: 0,
    noFit: [],
    noDie: [],
    unverified: [...new Set(entries.flatMap((e) => e.unverified ?? []))],
    unpriced,
  };
}
