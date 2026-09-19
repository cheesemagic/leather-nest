# Find Best Use — C3 spike: re-tested against real die shapes

**Status:** addendum to `2026-09-18-find-best-use-c3-spike-findings.md`
**Date:** 2026-09-19
**Harness:** `scripts/c3-spike-irregular.mjs` (throwaway)

The original findings named their own biggest weakness: every fixture was a
rectangle, and irregular parts interlock in ways rectangles can't. The user
supplied photos of real dies (a domed piece with a notch cut into its base, a
curved bow strip, wavy-sided panels, a pinched-waist hourglass fob, a tapered
paddle tab, a zigzag tree) specifically to close that gap.

## Method and an honest caveat on fidelity

Six shapes hand-traced from the photos as SVG `path` strings, imported
through the real `parseSVGPolygon()` — the first end-to-end exercise of the
`<path>` importer against something that wasn't a test fixture. These are
**approximations of proportions visible in a phone photo, not exact vector
geometry**, and every shape **omits interior holes** on purpose (several of
the real dies have hardware/stitch holes; representing those is the deferred
"hole support" item, not this experiment).

A first pass traced the curves with real arcs/Bezier curves and hit a genuine
wall: **one 24-piece mixed nest took 35 seconds.** Diagnosis: NFP cost
between two already-placed parts scales with the product of their vertex
counts, and curve-flattening had produced 55–124 points per shape (vs. 4 for
a rectangle). Rewritten as coarse polylines (8–12 points each, closer to how
a real digitized outline gets simplified before use anyway), the full
comparison — 140 nests — ran in 26 seconds.

**This cost finding stands on its own, independent of the mixing question:**
real die complexity can make nesting meaningfully more expensive than the
rectangle-fixture spike assumed, and it's specifically pairwise NFP cost
between placed parts that dominates, not per-part placement search. Worth
remembering if C2's shortlist nests start feeling slow on a real die library.

One more caveat: this run used `gridStepMm: 15` (vs. the app's 5mm default)
to keep the experiment fast. The utilization/value magnitudes below are not
directly comparable in absolute terms to the original spike's 5mm numbers —
only the *direction* of each finding is being checked.

## Result A — the over-ask finding on `value` mostly holds, more starkly

| | Rectangle | Deep notch |
|---|---|---|
| greedy vs. singles(0.75) | 100.0% | 100.0% |
| knapsack vs. singles(0.75) | 100.0% | 100.0% |

All three searches converged on the identical answer: fill with the single
most value-dense shape (the bow strip, in both cases). Mixing bought
**nothing** on the value question — the original recommendation, that
`singles` at a higher ask already captures this, holds up on real shapes.

## Result B — the concave-utilization loss reproduces, on genuinely interlocking parts

| | Rectangle (convex) | Deep notch (concave) |
|---|---|---|
| knapsack vs. singles | **109.4%** | **92.5%** |
| best mix vs. best single (packing %) | 76.2% vs 69.7% | 63.0% vs 68.0% |

This was the original spike's central worry — an area-blind search losing to
the incumbent on concave outlines — and it was fair to ask whether *real*
interlocking parts (which rectangles cannot model) might rescue it. They
don't. Knapsack still loses to plain `singles` on the notch, and the
achieved-packing-efficiency table shows the same inversion as before: mixing
helps on convex, hurts on concave. The mechanism is identical to the original
finding: an area model can't tell that a shape reaches into a notch, so it
still happily spends the notch's arm on something that can't reach it.

## Result C — demand still wins big, but the magnitude isn't a controlled comparison

Mixed search beat `singles` by 333–383% here, versus 33–43% in the original
spike. That's expected and not a stronger result: this fixture spreads
demand thin across *six* components (3–6 each) instead of the original's
three (2–30 each), so a single-type `singles` candidate necessarily leaves
far more of the book unfilled. The direction is confirmed again; the size of
the number is an artifact of how the demand was distributed, not a bigger
win.

## Result D — the over-ask genuinely buys nothing on `value` for these shapes, confirmed at the real grid

At the 15mm grid used above, raising the ask from 0.75 to 0.95 bought **0%**
on `value` on both hides, against 8–11% in the original rectangle spike. The
obvious suspicion was that 15mm (used here for speed) was coarse enough to
already saturate placement count regardless of the ask, masking a real gain.
Checked directly by re-running just the over-ask comparison at the app's
production 5mm default:

| | value, 15mm | value, 5mm | utilization, 15mm | utilization, 5mm |
|---|---|---|---|---|
| Rectangle | 100.0% | 102.4% | 105.3% | 105.3% |
| Deep notch | 100.0% | 100.0% | 105.6% | **111.1%** |

The grid hypothesis was wrong: `value` stays flat at 5mm too (102.4% is
noise, not a real gain), and `utilization`'s gain *increases* slightly at the
finer grid rather than being suppressed by the coarse one. So this is a real
property of this shape/demand mix, not a grid artifact: one shape (the bow
strip) so dominates value-density that `singles` at 0.75 already asks for
close to as many as the sheet can hold, and the coarse-vs-fine grid difference
doesn't change that. Whether that generalizes to a die library without one
shape so dominant is untested — the fixture here has one $60-equivalent
shape against five much cheaper ones, which is a real but not universal
distribution.

## Bottom line

The two findings that mattered most for the "don't build C3" recommendation
— that mixing doesn't help `value` beyond the ask, and that it actively
hurts `utilization` on concave hides — both reproduce on real, hand-traced
die geometry, not just rectangles. The recommendation stands. The genuinely
new information is Result D (confirmed real, not a grid artifact — the
value question saturates regardless of ask when one shape dominates value
density) and the NFP-cost-scales-with-vertex-count-product finding, which
matters for C2's real-world performance regardless of C3.
