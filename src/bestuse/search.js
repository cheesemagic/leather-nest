import { filterEligible } from './eligibility.js';
import { generateCandidates } from './candidates.js';
import { evaluateCandidate } from './evaluate.js';
import { rankCandidates } from './ranking.js';
import { evaluateProductCandidate } from './products.js';

// The whole search, from a hide and a library to ranked results.
//
// This used to live inside the Find Best Use page, where nothing could reach
// it. That mattered: the page shipped with its "You Choose" mode handing the
// MODE name to rankCandidates in place of a strategy, which the ranker
// refuses, so that mode errored every time it ran and nothing noticed for as
// long as it took someone to read the code. Browser files carry no tests by
// convention in this repo, so anything decided inside one is unguarded. The
// page now owns only what it draws; every decision it used to make is here.
//
// Returns { results, excluded, error } rather than throwing, because the
// caller's job is to show the operator what happened either way.
export function runSearch({
  hide,
  components,
  mode,
  strategy = null,
  quantities = undefined,
  shortlistSize = undefined,
  products = undefined,
  method,
  laserClearanceMm,
  kerfMm,
  gridStepMm,
}) {
  if (!hide) return { results: [], excluded: [], error: 'No hide selected.' };

  const { eligible, excluded, hideRejection } = filterEligible(hide, components);
  if (hideRejection) {
    return { results: [], excluded, error: `Hide cannot be used: ${hideRejection}` };
  }

  let candidates;
  try {
    candidates = generateCandidates(mode, eligible, {
      hide,
      // Only "You Choose" names quantities; the other modes work them out.
      quantities: mode === 'explicit' ? quantities : undefined,
      // ...and only "You Choose" names no strategy. Passing the mode here
      // instead is the exact bug this module exists to keep out.
      strategy: mode === 'explicit' ? undefined : strategy,
      shortlistSize,
      products: mode === 'products' ? products : undefined,
    });
  } catch (err) {
    return { results: [], excluded, error: err.message };
  }

  if (candidates.length === 0) {
    return { results: [], excluded, error: 'No valid candidates for these selections.' };
  }

  // Products nest differently, not just score differently: evaluateCandidate
  // does one nest of whatever quantities it's handed, but a product needs
  // the largest number of WHOLE sets that fit together, found by search
  // (see evaluateProductCandidate) -- there's no single quantity to hand it.
  const evaluateOne = mode === 'products' ? evaluateProductCandidate : evaluateCandidate;
  const evaluated = candidates.map((candidate) =>
    evaluateOne(hide, candidate, { method, laserClearanceMm, kerfMm, gridStepMm })
  );

  // Rank only when a strategy was actually named. "You Choose" produces one
  // candidate, so there is nothing to order, and rankCandidates deliberately
  // has no default — a default would let "highest utilization" win by
  // omission, which the scoring design rules out on purpose.
  try {
    const results = strategy ? rankCandidates(evaluated, strategy) : evaluated;
    return { results, excluded, error: null };
  } catch (err) {
    return { results: [], excluded, error: err.message };
  }
}

// What the Run button should be able to do, given what the operator has
// picked so far. Lives here rather than in the page so the rule that
// "Fill Orders needs no strategy" is checkable.
export function canRun({ hideId, mode, strategy, quantities }) {
  if (!hideId) return false;
  if (mode === 'explicit') return Object.keys(quantities ?? {}).length > 0;
  // Fill Orders and Products each answer one fixed question, so there is
  // nothing to choose.
  if (mode === 'mix' || mode === 'products') return true;
  return strategy !== null && strategy !== undefined && strategy !== '';
}

// Picking a mode can settle the question it answers. Returns the strategy the
// page should hold after a mode change, so the page never has to know that
// Fill Orders means demand, or that Products is always ranked by value.
export function strategyForMode(mode) {
  if (mode === 'mix') return 'demand';
  if (mode === 'products') return 'value';
  return null;
}
