import { estimateCapacity, ESTIMATE_SCORERS, ASK_EFFICIENCY } from './estimate.js';
import { mixCandidates } from './mix.js';

// At roughly 1-6s per exact nest, five keeps a run in the seconds range.
export const SHORTLIST_SIZE = 5;

export function generateCandidates(mode, eligible, options = {}) {
  if (mode === 'explicit') return explicitCandidates(eligible, options);
  if (mode === 'singles') return singlesCandidates(eligible, options);
  if (mode === 'mix') return mixCandidates(eligible, options);
  throw new Error(
    `Unknown candidate mode "${mode}". Expected "explicit", "singles" or "mix".`
  );
}

// The operator has already named the quantities, so no estimate is involved.
function explicitCandidates(eligible, options) {
  const quantities = options.quantities ?? {};
  const items = eligible
    .filter((entry) => (quantities[entry.component.id] ?? 0) > 0)
    .map((entry) => ({
      component: entry.component,
      quantity: quantities[entry.component.id],
      unverified: entry.unverified,
    }));

  return items.length ? [{ candidateId: 'explicit', mode: 'explicit', items }] : [];
}

// One candidate per component, each that type alone. The shortlist is RANKED
// at PACKING_EFFICIENCY and each survivor is SIZED at the higher
// ASK_EFFICIENCY — see the note on both constants in estimate.js.
function singlesCandidates(eligible, options) {
  const { hide, strategy } = options;
  const shortlistSize = options.shortlistSize ?? SHORTLIST_SIZE;
  const score = ESTIMATE_SCORERS[strategy];
  if (!score) {
    throw new Error(
      `Unknown strategy "${strategy}". Expected one of: ${Object.keys(ESTIMATE_SCORERS).join(', ')}.`
    );
  }

  return eligible
    .map((entry) => ({ entry, estimate: estimateCapacity(hide, entry.component, options) }))
    .filter(({ estimate }) => estimate.pieces > 0)
    .sort((a, b) => score(b.estimate, b.entry.component) - score(a.estimate, a.entry.component))
    .slice(0, shortlistSize)
    .map(({ entry }) => ({
      candidateId: `single:${entry.component.id}`,
      mode: 'singles',
      items: [
        {
          component: entry.component,
          // Sized by a SECOND estimate at the higher ask, deliberately not
          // reusing the shortlist's. The two answer different questions, and
          // collapsing them back into one call is what this split undoes.
          quantity: estimateCapacity(hide, entry.component, {
            ...options,
            packingEfficiency: options.askEfficiency ?? ASK_EFFICIENCY,
          }).pieces,
          unverified: entry.unverified,
        },
      ],
    }));
}
