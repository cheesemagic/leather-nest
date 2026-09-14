// The brief's governing constraint: maximum material utilization is NOT
// maximum value. A hide packed 89% full of cheap keepers can be worth less
// than one packed 68% with belt straps. So ranking is a map of interchangeable
// comparators, and the caller must name which question it is asking.

export const RANKING_STRATEGIES = {
  value: (a, b) => b.value - a.value,
  utilization: (a, b) => b.utilization - a.utilization,
  // Orders filled first, then worth — two candidates that fill the same
  // orders are separated by what else they yield.
  demand: (a, b) => b.demandSatisfied - a.demandSatisfied || b.value - a.value,
};

// No default strategy, deliberately. A default would let "highest
// utilization wins" become the answer by omission; here omission is an error.
export function rankCandidates(results, strategy) {
  const comparator = RANKING_STRATEGIES[strategy];
  if (!comparator) {
    throw new Error(
      `Unknown ranking strategy ${JSON.stringify(strategy)}. ` +
        `Expected one of: ${Object.keys(RANKING_STRATEGIES).join(', ')}.`
    );
  }
  return [...results].sort(comparator);
}
