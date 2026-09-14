import { estimateCapacity, ESTIMATE_SCORERS } from './estimate.js';

// At roughly 1-6s per exact nest, five keeps a run in the seconds range.
export const SHORTLIST_SIZE = 5;

export function generateCandidates(mode, eligible, options = {}) {
  if (mode === 'explicit') return explicitCandidates(eligible, options);
  if (mode === 'singles') return singlesCandidates(eligible, options);
  throw new Error(`Unknown candidate mode "${mode}". Expected "explicit" or "singles".`);
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

// One candidate per component, each that type alone, sized by the estimate
// and shortlisted so a run stays in the seconds range.
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
    .map(({ entry, estimate }) => ({
      candidateId: `single:${entry.component.id}`,
      mode: 'singles',
      items: [
        {
          component: entry.component,
          quantity: estimate.pieces,
          unverified: entry.unverified,
        },
      ],
    }));
}
