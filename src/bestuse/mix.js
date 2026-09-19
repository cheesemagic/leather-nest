import { footprintArea, PACKING_EFFICIENCY, ASK_EFFICIENCY } from './estimate.js';
import { polygonArea } from '../nesting/geometry.js';

// Mixed-component candidates, for the demand question ONLY.
//
// The C3 spike measured a general mixed search and it did not earn its place:
// on `value` it gained nothing the higher ask does not already give, and on
// `utilization` it LOST to single-type candidates by 13-17 points on concave
// outlines, because an area model is blind to reachability and happily spends
// the arm of an L on a part that cannot reach into it. See
// docs/superpowers/specs/2026-09-18-find-best-use-c3-spike-findings.md.
//
// `demand` was the exception, gaining 33-43%, and the reason is structural
// rather than lucky: it is the only question that supplies its own bounds.
// An order book caps each component, so the search is finite without an
// invented limit, and its candidates are dominated by small parts — which are
// the ones an area model estimates well.

// Several area assumptions rather than one, so a single wrong constant cannot
// decide the answer. Each becomes a candidate; the nester and the ranking
// settle which was right, on exact numbers.
export const MIX_EFFICIENCIES = [0.6, PACKING_EFFICIENCY, ASK_EFFICIENCY];

export function mixCandidates(eligible, options = {}) {
  const { hide, strategy } = options;

  // Refused rather than quietly reinterpreted, the way rankCandidates refuses
  // an unknown strategy. Offering mixed search for a question where it
  // measured WORSE than the incumbent would be the more expensive kindness.
  if (strategy !== 'demand') {
    throw new Error(
      `Mode "mix" supports only the "demand" strategy, not ${JSON.stringify(strategy)}. ` +
        'Mixed search measured no better than "singles" on value and worse on ' +
        'utilization; see the C3 spike findings.'
    );
  }

  const seen = new Set();
  const candidates = [];

  for (const efficiency of MIX_EFFICIENCIES) {
    const items = proposeMix(hide, eligible, efficiency, options);
    if (!items.length) continue;

    const key = items
      .map((item) => `${item.component.id}:${item.quantity}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      candidateId: `mix:${efficiency.toFixed(2)}`,
      mode: 'mix',
      items,
    });
  }

  return candidates;
}

// Fill the hide with the smallest footprints first, each capped by its demand.
//
// This is a sort, not a knapsack, and that is a property of the objective
// rather than a shortcut. Under `demand` every placed piece is worth exactly
// one filled order (`demandSatisfied` sums `min(placedCount, demand)`), so the
// problem is "fit the most items into an area" — maximum cardinality, where
// taking the smallest first is provably optimal. Equal values are what
// collapse the dynamic program; a value-weighted objective would need one,
// which is a second reason this mode is scoped to demand.
function proposeMix(hide, eligible, efficiency, options) {
  const hideArea = polygonArea(hide.outlinePolygon);
  if (!(hideArea > 0)) return [];
  let remaining = hideArea * efficiency;

  const ordered = eligible
    .map((entry) => ({ entry, footprint: footprintArea(entry.component, options) }))
    .filter(({ footprint }) => footprint > 0)
    .sort(
      (a, b) =>
        a.footprint - b.footprint ||
        // RANKING_STRATEGIES.demand breaks ties on value, so prefer the
        // worthwhile one when two components occupy the same room. Ties are
        // broken again on id so the output never depends on input order.
        (b.entry.component.valuePerPiece ?? 0) - (a.entry.component.valuePerPiece ?? 0) ||
        a.entry.component.id.localeCompare(b.entry.component.id)
    );

  const items = [];
  for (const { entry, footprint } of ordered) {
    const affordable = Math.floor(remaining / footprint);
    // A component nobody ordered gets 0 here and is skipped below, so an
    // explicit demand > 0 filter above would be dead weight.
    const quantity = Math.min(affordable, entry.component.demand ?? 0);
    if (quantity <= 0) continue;
    items.push({
      component: entry.component,
      quantity,
      unverified: entry.unverified,
    });
    remaining -= quantity * footprint;
  }

  // Deliberately no surplus fill once every order is met. Extra pieces beyond
  // demand cannot raise demandSatisfied, and chasing the value tie-break with
  // them is the `value` question's job, asked with the `value` strategy.
  return items;
}
