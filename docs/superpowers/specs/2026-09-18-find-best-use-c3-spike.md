# Find Best Use — C3: spike proposal for mixed-component search

**Status:** proposal, not approved
**Date:** 2026-09-18
**Predecessors:**
- `2026-09-14-find-best-use-c1-design.md` — the scoring pipeline, its measured
  nesting costs, and the generator seam C3 is meant to slot into.
- `2026-09-18-find-best-use-c2-design.md` — the page. C3 adds a mode to it and
  changes nothing else about it.

C1 deferred C3 "behind a spike" without saying what the spike must answer.
This proposes that. It is a plan for an experiment, not a design — nothing
here should be built until the experiment reports.

## What "mixed component types" actually means

C1's three modes are one pipeline with three candidate *generators*:

| Mode | A candidate is |
|---|---|
| `explicit` | the quantities the operator typed |
| `singles` | one component type, repeated to capacity |
| `full` (C3) | **a quantity per component, chosen by the machine** |

So a C3 candidate is the same shape every other candidate already is —
`{ candidateId, mode, items: [{ component, quantity, unverified }] }`. C3
invents no new data. The entire problem is *choosing the quantity vector*.

Two things it explicitly does not mean:

- **Not rotations.** `allowedRotations` is already per-component and already
  searched inside `place()`. Nothing to add.
- **Not multiple hides.** One candidate is still one hide. Spreading an order
  across several offcuts is a different feature and is not in this pipeline.

## Why exhaustive search is not on the table

The space is the product of each component's feasible quantity range. On the
five-component fixture currently in `data/`, a `singles` run reports the
per-component capacities:

| Component | Fits alone | Exact nest | Utilization |
|---|---|---|---|
| keeper 35x12 | 140 | 0.8 s | 60.5% |
| unpriced tab 50x25 | 51 | 0.1 s | 65.6% |
| card pocket 90x70 | 10 | <0.1 s | 64.8% |
| belt strap 200x38 | 9 | <0.1 s | 70.4% |
| untooled flap 120x80 | 7 | <0.1 s | 69.1% |

That is 141 × 52 × 11 × 10 × 8 ≈ **6.5 million** quantity vectors, and mixes
can exceed any component's solo count, so this is a floor. Exhaustive is not
"slow", it is six orders of magnitude outside any budget. The interesting
question is not whether to prune but *what to prune with*.

## The budget

**The budget is larger than C1's numbers suggest, and this matters.** C1
measured 1–6 s per nest at the nester's 1 mm grid. C2 searches at
`DEFAULT_SEARCH_GRID_MM = 5`, and the measured column above — taken on the
real pipeline, not a synthetic fixture — runs **under a second even for a
140-piece candidate**.

- Cost still grows quadratically in piece count, so the keeper row is the
  shape of the ceiling, not the tab row.
- `singles` currently spends up to `SHORTLIST_SIZE = 5` nests and returns in
  about a second.

Holding a run to the few seconds an operator already tolerates therefore
allows on the order of **20–50 exact nests**, not the five or ten C1's figures
would imply. Every strategy below is a proposal for how to spend those well,
and the wider budget is what keeps option C alive.

## Candidate strategies

**A. Greedy by value density.** Sort by `valuePerPiece / partArea`, fill with
the densest, then the next, and so on. One nest. Fast and it is the classic
first-fit-decreasing shape. It is also known to be wrong in exactly this
domain: greedy locks in the densest part before knowing whether a slightly
worse part tiles the leftover region far better.

**B. Knapsack on estimated area, then verify.** Treat it as an unbounded
knapsack over `hideArea × PACKING_EFFICIENCY` using `estimateCapacity`'s area
maths, solve for the top handful of mixes, and exact-nest only those. Reuses
the exact mechanism `singles` already uses to shortlist, and preserves C1's
invariant that **only exact nests are ever shown as layouts**. Cost: one cheap
DP plus 5–10 nests.

**C. Beam search over partial mixes.** Keep the best `k` partial quantity
vectors, extend each, re-score, prune. Scoring a partial mix honestly means
nesting it, so the nest count is beam width × depth. At C1's assumed 1–6 s
this was hopeless; at the measured sub-second cost a narrow beam (k=3, a
handful of levels) fits. It is now a genuine contender rather than a
dismissal, and the spike should treat it as one.

**D. Metaheuristic (GA / annealing).** What Deepnest and SVGnest do. Good
answers, but they assume a nesting budget in minutes, and they make run-to-run
results non-reproducible — which C1 rejected once already when it refused a
wall-clock budget for the shortlist.

## Recommendation

**Pursue B, with A as the baseline it must beat and C as the stretch.**

B is the only option that fits the budget without abandoning reproducibility,
and it slots into the existing seam exactly: `generateCandidates('full', ...)`
returns candidates like any other generator, `evaluateCandidate` nests them
unchanged, `rankCandidates` orders them unchanged. No other module moves.

Two details B must get right:

- **The knapsack must be solved for the named strategy, not for value.** C1
  refuses to let "highest utilization wins" become a default by omission, and
  a C3 generator that always optimises dollars would smuggle that same
  assumption back in through a side door. `ESTIMATE_SCORERS` already keys the
  three questions by strategy name; the knapsack's objective must come from
  the same map.
- **Demand must cap the item counts** under the `demand` strategy, or the
  solver will happily propose 140 keepers to fill an order for 20.

## What the spike must measure

The spike is not "does B run". It is one number: **how much value does B leave
on the table versus the best mix we can find with unlimited time?**

1. Build 3–5 hide fixtures, including at least one strongly concave outline —
   the notch is where area-based estimates are most likely to lie.
2. For each, compute a **reference answer** by brute force with the piece
   ranges clamped small enough to finish overnight. This is the ground truth.
3. Run A and B against it. Report, per fixture: value found as a percentage of
   the reference, and wall-clock time.
4. Report the same for today's `singles` mode, because that is the real
   incumbent. **If B cannot beat `singles` by a clear margin, C3 should not
   ship at all** — that is a valid and useful outcome for this spike.

## The risk that would invalidate the recommendation

`PACKING_EFFICIENCY = 0.75` is documented as a deliberately generous *upper*
bound, chosen so the shortlist never discards a winner. Mixed candidates may
break that assumption in the opposite direction: small parts fill the gaps
left by large ones, so a good mix can pack *better* than any of its components
do alone. If real mixes routinely exceed 0.75, the knapsack is solving against
a ceiling that is too low and will systematically under-propose.

The measured column above gives the contrast to test against: single-type
candidates achieve **60.5–70.4%** on this hide, comfortably under the 0.75
ceiling, which is why the shortlist has never been bitten by it. Mixes are
where that could invert.

The spike should measure achieved packing efficiency on mixed candidates
directly. If it lands well above 0.75, B is solving against a ceiling that is
too low and will systematically under-propose — worth knowing before writing
the generator rather than after.

## Non-goals for the spike

- Any UI. The C2 mode toggle is one line once the generator exists.
- Changing `place()`, the grid step, or the placement heuristic.
- Cross-hide search, kerf compensation, defect regions. Still parked.
- Any new dependency. If B needs a solver, it is a DP in a few dozen lines.
