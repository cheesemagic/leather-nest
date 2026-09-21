# Packing density

**Status:** proposal, not approved
**Date:** 2026-09-21

The first real job — a traced offcut with a real card-wallet pattern — placed
54 pieces and used 59% of the leather, and the operator could see by eye that
there was room for more. This is what is actually limiting it.

## What was measured

All figures from the real 730 sq in offcut, placing the real wallet back.

**A finer search step does not help.** The nester walks candidate positions on
a grid. Making that grid finer is the obvious lever and it is the wrong one:

| grid | pieces placed | hide used | time |
|---|---|---|---|
| 5mm | 54 | 59% | 49s |
| 3mm | 48 | 52% | 49s |
| 2mm | 53 | 57% | 77s |
| 1mm | 53 | 57% | 167s |

Not merely flat — **not monotonic**. A finer grid finds a different first-fit,
sometimes a worse one. Any plan that starts with "search more positions" is
already contradicted.

**Orientation is worth a little.** Turning the hide before nesting, which
changes where bottom-left-fill begins, spans 52% to 62% across seven angles,
with 60° the best against a 59% baseline. Roughly 3 points for trying several
and keeping the best — real, cheap, and small.

**The layout is valid.** Every pair of the 54 placed pieces was checked for
overlap: none, and no piece falls outside the hide. Whatever is wrong here is
not producing bad cuts.

**And the finding that matters:**

| what is nested | pieces placed |
|---|---|
| the real (concave) wallet back | 54 |
| its convex hull | 54 |

**Identical.** The nester places exactly as many pieces whether the shape has
concavities or not, which means the concavities are doing nothing. Pieces are
never settling into one another.

## Why

`computeNFP` in `src/nesting/nfp.js` is a Minkowski sum, which is exact for
convex parts only. For a concave part it yields an NFP at least as large as
the true one, so positions where two pieces would genuinely interlock are
forbidden. The result is conservative — hence no overlaps — and the wasted
space is exactly the concave area.

The wallet pieces fill **90.0%, 92.4% and 92.4%** of their own convex hulls.
That 8-10% is the whole prize from fixing this, and it caps what interlocking
can ever recover. An earlier guess of "59% up to maybe 75%" was not grounded;
the honest figure from this alone is nearer 54 pieces to 58-60.

## Prior art

Searched before designing, per this project's standing practice.

- **Convex decomposition** — split each concave part into convex pieces,
  compute the elementary NFPs, union them back. `clipper-lib` is already a
  dependency and already does polygon union, so the fusing step is free.
- **Orbiting / sliding** (Burke et al. 2006) — walk one part around the other
  maintaining contact. This is what [SVGnest](https://github.com/Jack000/SVGnest)
  uses; it is JavaScript, open source, and explicitly handles concave cases.
- **jagua-rs / Sparrow** — Rust collision-detection and strip-packing, proven
  to run client-side via WebAssembly. Already noted in this project's history
  as a candidate for a nesting-core upgrade.

Independently, [an open issue on another laser-layout project](https://github.com/bdfinst/laser-layout/issues/12)
describes this exact situation — convex-only Minkowski NFP, concave real
parts refusing to settle into each other — and reaches the same two options.
That is worth knowing: it is a known shape of problem with known answers, not
something to invent.

## Recommendation

**Two stages, in this order, and the order is the point.**

### Stage 1 — make the NFP exact for concave parts

Convex decomposition rather than orbiting: the union step is already
available through `clipper-lib`, it is far easier to test (each elementary
NFP is a Minkowski sum, which the code already computes correctly), and it
does not require a second geometry engine.

Expected: 54 pieces to 58-60. Modest, but it is the gate on everything else.

**The risk is time, not correctness.** The NFP is the hot path — nesting cost
already scales with the product of vertex counts, which is why imported
outlines are simplified to 0.25mm. A decomposed NFP computes several Minkowski
sums per pair instead of one. Decomposition results must be cached per
(part, rotation) pair or this will be slower than the gain is worth, and the
first measurement taken should be time, not density.

### Stage 2 — search arrangements, not just positions

Only after stage 1. Searching harder over a model that ignores concavity just
finds better arrangements of convex hulls, which is what the grid experiment
above already demonstrated.

Then the levers are the ones the measurements point at: several hide
orientations (worth ~3 points, nearly free), placement order, and a global
search over both. SVGnest's genetic approach is the reference, and it trades
minutes of runtime for density — acceptable for an expensive exotic skin, not
for browsing a pile of free scrap.

## Whether this is worth doing at all

Stated plainly because it was raised before the operator asked for this:
squeezing 15% more from a hide matters when material is scarce. The bulk scrap
here is free, in shipping containers, and the binding constraint is operator
and laser time. Where it genuinely pays is the **exotic skins** — small,
expensive, irreplaceable, and already photographed.

So the honest framing: stage 1 is worth doing because the current behaviour
silently discards a documented 8-10% and is a real gap in the engine. Stage 2
should wait until exotics are actually being cut, and should be judged then.

## Non-goals

- Replacing `clipper-lib` or adding a second geometry engine.
- Changing how positions are scanned. Measured; it is not the problem.
- Any new dependency. Convex decomposition is a few dozen lines against a
  library already present.
