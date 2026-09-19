# Find Best Use — C3 spike: findings

**Status:** experiment complete. Recommendation: do not build C3 as proposed;
raise one constant instead, and scope any mixed search to the demand question
**Date:** 2026-09-18
**Proposal:** `2026-09-18-find-best-use-c3-spike.md`
**Harness:** `scripts/c3-spike.mjs` (throwaway; `node scripts/c3-spike.mjs`)

The proposal set its own bar: *"If B cannot beat `singles` by a clear margin,
C3 should not ship at all — that is a valid and useful outcome for this
spike."* That is the outcome.

## Method

Two tiers, because the honest reference and the realistic workload cannot be
the same fixture. A first attempt used one tier and clamped the brute-force
ranges to make it finish; the heuristics then scored **over 100% of
"optimal"**, which is how the flaw announced itself. The clamp had put the
true optimum outside the searched range.

- **Tier 1** — four small outlines (rectangle, L, strip, deep notch) and three
  components sized so exhaustive enumeration reaches the true optimum. The
  harness flags any case whose winner sits on a range boundary; those are
  lower bounds and are excluded from the summary. 9 of 12 cases were clean.
- **Tier 2** — four realistic outlines, five components. No reference is
  computable; the only question is whether a mix beats the incumbent.

Three searches ran against each: today's `singles` mode, greedy-by-density
(strategy A), and knapsack-over-estimated-area verified by nesting (B).

## Result 1 — mixing is real, so the premise was sound

The true optimum was a mix of more than one component type in **6 of 9**
trustworthy tier-1 cases. C3 was not chasing a phantom.

## Result 2 — but the proposed search barely captures it

| Search | Mean % of true optimum | Nests |
|---|---|---|
| `singles` (incumbent) | 88.1% | 5 |
| greedy (A) | 88.8% | 1 |
| **knapsack (B)** | **92.0%** | 5 |

Knapsack matched the optimum exactly in 5 of 9. But **greedy buys 0.7 points
over the incumbent for a fifth of the work**, and knapsack buys 3.9 points for
the same nest budget `singles` already spends. That is not the clear margin
the proposal demanded.

## Result 3 — the apparent tier-2 win is mostly not mixing

Tier 2 looks emphatic: knapsack averages **114.3%** of `singles` and wins 10
of 12. Reading the actual proposals dissolves most of it. Every tier-2 `value`
winner is effectively single-type:

| Hide | `singles` asks | knapsack proposes | Gain |
|---|---|---|---|
| Rectangle | 95x keeper | 104x keeper + 1x tab | +8.4% |
| L-shape | 83x keeper | 101x keeper + 1x tab | +10.8% |
| Narrow strip | 77x keeper | 86x keeper | +9.1% |
| Deep notch | 98x keeper | 107x keeper + 1x tab | +8.2% |

The knapsack is not finding a better *mix*. It is **asking for more pieces of
the same component**, because it runs the area model at efficiencies up to
0.95 while `singles` sizes its candidate at `PACKING_EFFICIENCY = 0.75`. The
nester then places what fits. Roughly nine to eleven points of the fourteen
are an over-ask, not a search result.

That is worth far more than C3, because it is a constant, not a sub-project.

The exception is the **demand** question, where the gain is genuinely mixed
(`30x keeper + 10x tab + 3x pocket`, +40%) — unsurprising, since filling
orders for several products is inherently multi-component.

## Result 4 — the 0.75 hypothesis was wrong, and backwards

The proposal predicted mixes might pack *better* than 0.75, leaving the
knapsack solving against too low a ceiling. Measured achieved utilization:

| Hide | Best single | Best mix |
|---|---|---|
| Rectangle (convex) | 69.1% | **71.6%** |
| Narrow strip (convex) | 71.1% | **73.0%** |
| L-shape (concave) | 66.0% | **54.6%** |
| Deep notch (concave) | 66.3% | **57.2%** |

Mixes pack better on convex outlines and **markedly worse on concave ones**.
The mechanism is visible in the tier-1 detail: on the small L-shape under
`value`, knapsack scores 62.0% of optimum while `singles` scores 69.8% — the
area model happily spends the arm of the L on a 150mm strap that cannot reach
into it. Area is blind to reachability, and concavity is exactly where that
blindness costs.

So `PACKING_EFFICIENCY = 0.75` is not too low for mixes. For concave hides it
is too **high**, and an area-driven mixed search is least trustworthy on
precisely the outlines this app exists to handle — scrap offcuts.

## Result 5 — cost was never the constraint

Worst case across all of tier 2: **5 nests, 1.17 s**. The proposal's revised
budget of 20–50 nests was correct and nothing came close to using it. Search
quality, not search cost, is what limits C3.

## Result 6 — the over-ask was tested, and it splits by question

Recommendation 1 below was originally a guess. It was cheap to settle, so it
was: `estimateCapacity` already accepts `options.packingEfficiency`, and
`generateCandidates` passes options straight through, so raising what `singles`
asks for needs no code change at all — only a different number.

Mean across all twelve tier-2 cases, against the shipped 0.75 baseline:

| What `singles` assumes | Mean score | Time |
|---|---|---|
| 0.75 (shipped) | 100.0% | ~220 ms |
| **0.95** | **105.7%** | ~340 ms |
| 1.20 | 105.7% | ~350 ms |
| 1.60 | 105.7% | ~350 ms |

It **saturates at 0.95**. Asking for more past that buys nothing and costs
time linearly, because the nester simply discards the surplus. So the tuning
target is a single number and it is already identifiable.

The mean hides the real finding. Split by question, against knapsack:

| Question | Over-ask at 0.95 | Knapsack (C3) | Winner |
|---|---|---|---|
| `value` | +10.5 / +10.8 / +9.1 / +8.2% | +8.4 / +10.8 / +9.1 / +8.2% | **over-ask ties or beats** |
| `utilization` | +16.7 / +5.8 / +1.6 / +5.6% | +3.6 / −17.2 / +2.7 / −13.7% | **over-ask wins clearly** |
| `demand` | 0% on all four | +43.3 / +40.0 / +33.3 / +43.3% | **knapsack only** |

(Four figures per cell, one per hide: rectangle / L-shape / strip / notch.)

For **value**, the over-ask captures the entire knapsack gain — confirming
that result 3's suspicion was right, and that C3 adds nothing to the question
the operator most often asks. For **utilization** the knapsack is actively
*worse* than the incumbent on both concave hides, while the over-ask helps
everywhere. For **demand**, the over-ask does nothing at all — demand is
capped by orders, so asking for more of one component cannot fill an order for
another — and mixed search is the only thing that moves it.

## Recommendation

**Do not build C3 as a general mixed-component search.** In order:

1. **Raise what `singles` asks to ~0.95 and stop there.** No new code, one
   constant, and it delivers the whole value-question gain plus most of the
   utilization gain. Two cautions: `PACKING_EFFICIENCY` also drives the
   *shortlist*, not just quantities, so changing it can change which
   components get nested at all — the shortlist behaviour needs its own test.
   And the constant's docstring currently justifies 0.75 as an upper bound for
   a shortlist; that reasoning has to be rewritten, not just the number.
2. **If mixed search is built, scope it to the `demand` question alone.**
   That is the only place it earns anything, it is the case where a *bounded*
   knapsack is natural because demand supplies the bounds, and restricting it
   there sidesteps the concavity problem in result 4 — demand candidates are
   dominated by small parts, which are the ones an area model estimates well.
3. **Never let an area-only model choose mixes for concave hides.** It lost to
   the incumbent by 13–17 points on exactly the irregular offcuts this app
   exists to handle. A reachability-aware estimate — eroding the outline by
   the part's bounding radius is the cheap first approximation — or a
   convexity gate would be prerequisites, not refinements.

## What would change this answer

The fixtures are rectangles. Real components are irregular, and irregular
parts interlock in ways rectangles cannot, which is the case where mixing
should pay most. Re-running the harness against real digitised dies from
`data/dies` is the obvious next probe, and it is cheap now that the harness
exists. If mixing wins clearly on real shapes, result 2 is the one to revisit.

The tier-1 component set is also only three items. The knapsack's advantage
should grow with the number of eligible components, and five is the realistic
lower end of a working library.
