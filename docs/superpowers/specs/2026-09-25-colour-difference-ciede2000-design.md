# Colour difference: CIEDE2000 instead of straight-line distance

Status: designed 2026-09-25, not built.

Replaces `colourDifference()` in `src/skins/similarity.js` with the CIE's
standard colour-difference formula, keeping the same name, signature and
single caller.

## The gap

`colourDifference()` is the straight-line distance between two hides in the
a\*/b\* plane:

```js
return Math.hypot(a.colourA - b.colourA, a.colourB - b.colourB);
```

That is defensible, and it is what got the feature working. It has two
problems, and the second is the expensive one.

**It is not perceptually uniform.** A distance of 5 in one part of LAB is not
as visible as a distance of 5 in another. The correction is largest exactly
where leather lives: browns, tans and cognacs are low-chroma oranges, and
straight-line distance overstates differences at low chroma relative to how
they actually look. Two hides the eye would call the same brown can rank
further apart than two the eye would separate.

**The number means nothing.** The Matching page prints `colour difference
0.0`. In what unit? There is no published band for straight-line a\*/b\*
distance, so there is no answer to "is 4.2 close enough" — only "4.2 is closer
than 6.1". That is why the open colour-threshold question
(`docs/handoff-2026-09-24.md`, item 2) has nowhere to start: it is waiting on
labelled hide pairs to invent a number the industry already publishes.

CIEDE2000 fixes both. It is the CIE standard, it weights chroma and hue
non-uniformly to track perception (including a specific correction in the blue
region), and it arrives with tolerance bands people already use.

## What this does not fix

**A phone photo is not a spectrophotometer.** Every colour in the library is
sampled from an uncontrolled photograph. CIEDE2000 makes the comparison
principled, not accurate — precise arithmetic on a shaky input.

The cheap fix is the same shape as the kerf test square: put a grey card or a
colour reference target in frame when photographing a hide, and correct
against it. That is a ~£30 purchase and a change to `digitize.py`. Until it
exists, every ΔE00 figure carries the photograph's white balance inside it —
worth saying out loud to anyone the numbers get shown to.

## Design

### Lightness stays out, and the formula has a knob for it

The repo's existing rule is that matching compares on a\*/b\* only, because
lightness tracks exposure and glare far more than dye: measured on two photos
of one offcut, lightness swung by ~20 while hue held within 1-2
(`docs/superpowers/specs/2026-09-22-products-design.md`). That finding does not
go away because the formula gets better.

CIEDE2000 carries parametric factors `k_L`, `k_C`, `k_H` for exactly this
situation, and textile practice has long de-weighted lightness the same way
(CMC 2:1). Here the lightness term is zeroed outright rather than halved: a
measurement dominated by exposure is not worth half a vote.

**Zeroing the ΔL′ term removes lightness from the result completely**, which
is worth stating because it is not obvious. Of the four terms, lightness
enters only through `S_L`, and `S_L` multiplies only the ΔL′ term — `S_C`,
`S_H` and `R_T` are functions of chroma and hue alone. So with ΔL′ zeroed, no
residue of `colourL` survives into the answer.

This gets a named constant with the reason attached, in the shape
`DEFAULT_KERF_MM` already uses: a value that is zero because nobody can measure
the input honestly yet, and a comment saying exactly what would change it. When
a colour reference lands in the frame, this is the one line to move.

Concretely, `COLOUR_LIGHTNESS_WEIGHT = 0`, applied as a **multiplier on the
lightness term** — `weight * (ΔL′ / S_L)` — not as `k_L = Infinity`. The two
are equivalent in arithmetic, but a weight reads as a dial someone is expected
to turn, takes intermediate values when a grey card makes them meaningful, and
keeps `Infinity` out of a numeric path where it could propagate as `NaN`.

### Vendored, not a dependency

The formula is a closed form of roughly 60 lines. The repo's dependencies are
`clipper-lib` and `formidable`; a colour library would be a third, for one
function.

Vendoring is normally the riskier call. Here it is not, because the
implementation is **verifiable against published data**. Sharma, Wu & Dalal
(2005) publish a 34-pair test set built specifically to exercise the formula's
discontinuities — the hue-angle wraparound and the blue-region rotation, which
are where naive implementations are wrong. The data is at
<https://www.ece.rochester.edu/~gsharma/ciede2000/> in plain text.

Fetch that table and commit it as a fixture. **Do not transcribe the values
from memory or from a blog post** — the whole point is that the numbers are the
published ones.

### Consequence: implement the standard formula first, then zero ΔL

The test table exercises lightness differences, so it can only validate the
standard `k_L = 1` formula. If the implementation bakes the zeroing in, the
published data cannot check it at all.

So `ciede2000(labA, labB, { kL, kC, kH })` implements the standard formula and
is tested against the 34 pairs at `k_L = k_C = k_H = 1`. `colourDifference()`
then calls it with the lightness weight the app has chosen. Two things, tested
separately: the formula is right, and the app's use of it is deliberate.

### The public shape does not change

`colourDifference(a, b)` keeps its name, its `(hideA, hideB)` signature and its
single caller in `rankMatches()`. The ranking logic, the `colourDifference:
null` fallback for a pair missing colour on either side, and the nested
partitioning introduced by the cut spec all stay exactly as they are.

One existing test changes, and should: `similarity.test.js` asserts that a
3-4-5 triangle returns exactly `5`, which is a statement about straight-line
distance specifically. Replace it with assertions about CIEDE2000's behaviour —
identical colours return 0, the result is symmetric, and a pair the eye
separates scores above a pair it does not.

### The displayed number gains a unit

`src/match-skins-app.js` prints `colour difference 0.0`. It becomes `ΔE00 0.0`.

That small edit carries most of the outward-facing value of this spec. A
supplier, a customer or a manufacturer reading `ΔE00 2.4` knows what it means
and can check it against their own quality control. Nobody can do anything with
`colour difference 2.4`.

### Tolerance bands are recorded, not enforced

The published bands, for reference rather than for code:

| ΔE00 | Reads as |
|---|---|
| < 1 | imperceptible |
| 1-2 | perceptible on close inspection |
| 2-3.5 | noticeable; around where practical tolerances get set |
| > 5 | clearly different colours |

**No hard threshold is added by this spec.** Colour continues to rank rather
than to gate. The open colour-threshold test still wants real hide pairs and a
human verdict — but it now starts from a published band and asks "is our line
near 3?" instead of inventing a number from nothing. That is the difference
between calibrating and guessing.

## Order of work

1. `src/skins/ciede2000.js` and `test/ciede2000.test.js`, driven by the fetched
   Sharma fixture. Independently correct before anything else moves.
2. Swap `colourDifference()`'s body to call it with the lightness weight; fix
   the one existing test that asserts straight-line behaviour.
3. The `ΔE00` display string.
4. The bands into `CLAUDE.md`, beside the existing note on why matching ignores
   lightness.

Step 1 is the whole risk and is separately verifiable. Steps 2-4 are small.

## Non-goals

- **Shade codes.** The textile industry's 555 shade-sorting system assigns each
  piece a three-digit code for its deviation from a nominal standard, and the
  supplier's 413 transcribed swatches in `docs/reference/leather-swatches.json`
  are a ready-made set of standards. That would give pooling a grouping rule and
  give a manufacturer something readable. It needs measured LAB per swatch,
  which needs the chart images saved to disk first, and it is its own spec.
- **`src/skins/colour-order.js`.** Ordering a shelf is a different job from
  matching, and that file already documents why it uses lightness where matching
  must not. ΔE00 does not belong in it — a sort needs a total order along one
  axis, not a pairwise distance.
- **A hard colour gate**, and **multi-hide colour pooling**, which depends on
  one.
- **Colour calibration from a reference card.** Named above as the real fix for
  accuracy. It is a change to the capture pipeline, not to the comparison, and
  should not be smuggled in here.

## What would change this

- **A grey card in the frame** turns the lightness weight from a principled zero
  into a number worth tuning, and is the single change that would most improve
  every figure this produces.
- **Real labelled hide pairs** set the threshold, at which point colour can gate
  as well as rank, and multi-hide pooling unblocks.
- **Evidence that ΔE00 ranks worse than straight-line distance on actual
  leather.** Unlikely, but worth naming: the library holds two hides, neither
  measured, so this change is currently unfalsifiable here. Judge it on the
  first real set of hides, not on a fixture.
