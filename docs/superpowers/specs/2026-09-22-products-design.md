# Products, and matching leather within one

**Status:** proposal, not approved
**Date:** 2026-09-22

## The gap

A wallet is three pieces. The program does not know that. It imported the
real card-wallet pattern as three unrelated shapes, and it will happily place
the back on one hide and the pockets on another — or on a differently-coloured
patch of the same skin — and report success.

Two consequences:

- **You cannot ask for three wallets.** You ask for 3 backs and 6 pockets and
  do the arithmetic yourself. Nothing catches a wrong ratio, so you end up
  with pockets you cannot use.
- **Nothing enforces that the pieces look alike.** Which is the whole point of
  a matched product, and the problem this project started on — one level down.
  "Find two hides that match" became "cut these three pieces so they match."

## What matching means here

Settled with the operator rather than assumed, because it is a physical
judgement:

- Pieces of one product **may come from different offcuts**, provided those
  offcuts look alike.
- **Which pieces must match depends on the product.** A visible exterior must;
  an inside pocket nobody sees need not.
- Looking alike means **species and colour first, with finish mattering too**.
  Scale size — the thing the existing matching tool ranks on — was not
  volunteered, which is worth noting: the matching machinery already built
  ranks on the attribute the operator did not name first.

## The data gap

A hide record holds `species`, `thicknessMm`, `outlinePolygon`,
`remainingAreaPct`, and a scale signature (`dominantWavelengthMm`,
`radialSpectrum`).

**It records no colour and no finish.** Those are the two the operator named,
and neither exists. Nothing can be enforced without them.

Colour is recoverable from the photograph already being taken — a dominant
colour sampled from inside the traced outline, which is cheap and needs no new
capture step. Finish is not: gloss against matte is about specular reflection,
so it depends on lighting the photo does not control. **Finish should be an
operator-set label, not something measured.**

## Design

### A product is a named set of parts with quantities

```js
{
  id, name: 'card wallet',
  parts: [
    { partId, quantity: 1, mustMatch: true },   // the back
    { partId, quantity: 2, mustMatch: true },   // the pockets
    { partId, quantity: 1, mustMatch: false },  // an inner liner
  ],
}
```

`mustMatch` per part, because the operator said it depends on the product.
Parts marked `false` are placed with no constraint at all.

"Make 3 wallets" then expands to the right pieces, and the ratio cannot go
wrong because the program does the arithmetic.

### Matching is a predicate over hides, not a score

`hidesMatch(a, b)` returns true or false:

- **Species must be equal.** Already how the existing matcher treats it — an
  absolute rule, not a weighting.
- **Colour must be within a tolerance.** Compared in a perceptual colour space
  (LAB) rather than RGB, because RGB distance does not correspond to what the
  eye judges as "the same brown".
- **Finish must be equal when both are recorded.** An unrecorded finish does
  not block, on the same principle the eligibility rules already use: missing
  data is reported as unverified rather than treated as a failure.

Deliberately a predicate, not a ranking. Ranking answers "which two hides go
best together", which the existing tool already does for shoes. This answers
"may these two hides be used in one wallet", which is a yes/no the nester has
to act on.

### The search places a whole product or none of it

This is the real change, and it is where the work is.

`evaluateCandidate` currently nests a flat list of parts onto one hide. A
product changes that in two ways:

1. **All-or-nothing.** Two thirds of a wallet is worth nothing. A candidate
   that places 3 backs and 5 pockets has made 2 wallets and wasted a back.
   Value must count completed products, not placed pieces.
2. **Across hides.** A product may span offcuts that match, so the search is
   no longer "one hide at a time".

The second is a significant departure. Today every mode answers "what is worth
making from THIS hide". Products introduce "which hides together can make
these products", which is a different question with a much larger search
space.

**Recommendation: build 1 and defer 2.** Start with a product satisfied from a
single hide, which needs no cross-hide search and captures the all-or-nothing
rule — the part that stops the program reporting success on 5 pockets and 3
backs. Cross-hide comes after, with evidence from real use about how often one
offcut cannot hold a whole product.

### Naming

`data/dies/` is wrong: a laser job involves no die at all, and the UI already
says "Components". The operator asked for `patterns/`, but that collides —
a *pattern file* is the thing imported, and it holds several of these.

Proposed, once, rather than renaming twice:

| now | proposed | meaning |
|---|---|---|
| `data/dies/` | `data/parts/` | one cuttable shape |
| — | `data/products/` | a named set of parts |
| (file you import) | pattern file | unchanged, holds several parts |

97 references across routes, stores, tests and pages. Worth doing once,
alongside products, and not before — renaming now and again later is the same
migration twice.

## Order of work

1. **Colour on a hide.** Sampled from the photo already taken. Nothing else
   can be enforced without it, and it is the smallest piece.
2. **Finish as an operator label.** A short list, set by hand, not measured.
3. **Products, single-hide.** The record, the expansion, the all-or-nothing
   scoring. The rename lands here.
4. **`hidesMatch`.** Only meaningful once colour exists.
5. **Cross-hide products.** Deferred, pending evidence it is needed.

## Non-goals

- Replacing the existing shoe-matching tool. It answers a different question
  and keeps answering it.
- Measuring finish from a photograph. Lighting-dependent; an operator label is
  more honest and more reliable.
- Nesting a product across more than two hides. No evidence anyone needs it.

## What would change this

The colour claim is untested. Whether a dominant colour sampled from a phone
photograph is stable enough to judge "same dye lot" is an open question —
white balance shifts between photographs, and two shots of the same hide may
not agree. **That should be measured on real photographs of the same offcut
before anything is built on it**, which is a morning's work and would sink
step 1 if it fails.

Given two estimates in the packing spec were withdrawn after measurement,
that check comes before the build, not after.
