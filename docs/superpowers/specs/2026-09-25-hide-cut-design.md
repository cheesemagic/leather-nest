# Cut: which part of the animal a hide came from

Status: designed 2026-09-25, not built.

Adds one field, `cut`, to a hide, and makes matching refuse to pair two
hides that came from different parts of the animal.

## The gap

`rankMatches()` groups hides by species and nothing else
(`src/skins/similarity.js`). Every pair inside a species group is then
ranked on scale and colour. So a caiman tail and a caiman belly are
eligible to pair with each other, and if their scale measurements happen
to be close, the program will rank them as a good match.

They are not a match and never will be. A tail's scales and a belly's
scales are different geometry from different parts of the animal. This is
not a subtle ranking error — it is a confidently wrong answer, which is
worse than no answer, because a ranking carries no warning.

The pairing is not hypothetical. The supplier's own catalogue
(`docs/reference/leather-swatches.json`) carries an "Argentine Caiman
Belly Matte" chart alongside "Caiman Tail Matte 1" and "Caiman Tail Matte
2" — five colours on the belly chart, twelve on each tail chart, all
recorded as species `caiman`. Any two of those hides group together
today.

The trade already solved this, and the solution is the constraint this
spec adds. A pair of alligator skins is expected to yield two pairs of
boots: one pair cut from the matching *tails*, the other from the
matching *bellies*. Tails with tails, bellies with bellies. The program
should not be capable of proposing otherwise.

## What the charts say a cut is

Ten of the supplier's 39 charts name a cut. Six distinct values:

| Cut | Charts | Note |
|---|---|---|
| `hornback` | alligator, saltwater crocodile | the back ridge, with raised scutes |
| `belly` | caiman | the flat underside; what crocodilian sizing is measured across |
| `tail` | caiman (x2) | |
| `leg` | ostrich (x3) | ostrich leg is scaled like a reptile |
| `full quill` | ostrich | the bumpy follicle body — nothing like ostrich leg |
| `multispine` | stingray | |

The other 29 charts name no cut at all. That absence is itself a value:
a whole skin. It gets the name `whole`.

Ostrich is the clearest case for why this matters. "Ostrich leg" and
"ostrich full quill" are the same animal and the same species string, and
they look nothing like each other — one is scaled, the other is a field
of raised follicles. Matching them on a scale wavelength is meaningless.

## Design

### The vocabulary is a closed list, in its own file

`src/skins/cuts.js`, mirroring `src/skins/species.js`: a `CUTS` array,
`cutLabel()`, and `populateCutSelect()`.

```
whole, belly, full quill, hornback, leg, multispine, tail
```

`whole` leads because it is overwhelmingly the common case; the rest are
alphabetical.

Closed rather than free text, and this is the load-bearing reason:
`species.js` exists *because* free text let "cayman" and "caiman" coexist
in a field that matching groups on, so those two hides could never pair.
Two spellings of one cut is the identical failure in the identical place.
A `<select>` cannot produce a typo.

Its own file rather than an addition to `species.js`, which opens by
calling itself the one list of species. Two vocabularies in a file named
for one of them is a worse home than a second file.

Not enforced server-side, for the reason `species.js` gives for the same
choice: the catalogue is the supplier's and will grow. The `<select>`
steers; the API should not refuse a hide because a cut arrived before
this list was updated.

### A missing cut means unknown, and unknown is not a value

`cut` is `null` when unknown, exactly as `finish` is. There is no
`'unknown'` entry in `CUTS` — `null` already represents that state, and
two representations of one state is how they drift apart.

No migration and no backfill. The two records in `data/skins/` are both
SEED test data and will read as absent, which the code handles the way it
already handles `remainingAreaPct ?? 100` and `interiorPaths ?? []`.

### The gate is pairwise, not a wider grouping key

Inside the existing double loop in `rankMatches()`:

- both cuts known and **different** → the pair is not produced at all
- **either** cut unknown → pair produced, carrying `unverified: ['cut']`
- both known and equal → pair produced, `unverified: []`

Grouping stays keyed on species alone.

The alternative was keying groups on `species|cut`, which is tempting
because the Matching page's group heading would then read "Caiman — Tail"
for free. It was rejected because unknowns have nowhere honest to live in
it: a `cut: null` group would have to contain hides of known cuts in
order to pair them, which breaks the one invariant a keyed group is for.

Pairwise also reuses what the function already does. `rankMatches()` has
a precedent for a dimension it cannot judge — a pair missing colour on
either side falls back to scale alone and sorts after every fully-judged
pair. Cut is the same shape of problem and gets the same shape of answer.
`unverified` is `eligibility.js`'s existing word for "this constraint
could not be checked", not a new concept invented here.

### Flagged pairs sort after judged ones

Partition pairs on `unverified.length === 0`, and apply the existing
scale/colour rank-sum ordering unchanged *within* each partition. Fully
judged pairs first.

This requires extracting the current sort into a helper and calling it
twice. Nothing about the ranking maths changes.

Colour's existing fallback is left exactly as it is, and is deliberately
**not** folded into `unverified`. A pair that cannot be judged on colour
already has a representation — `colourDifference: null` — which the
Matching page reads; adding `unverified: ['colour']` beside it would be
the second-representation problem this spec warns about two sections up.
So the ordering is two nested partitions: cut-known before cut-unknown on
the outside, and the existing colour-present before colour-missing on the
inside. A pair missing both sorts last, which is correct.

### Cut is required wherever a signature is produced

One rule, because a cut affects exactly one thing — matching — and a hide
is matchable exactly when it carries a scale signature (the same test
`server.js` already uses). Three paths produce a signature, and the rule
has a hole if any of them omits it:

| Path | Rule |
|---|---|
| `POST /skins`, `captureType: 'signature'` | always required |
| `POST /skins`, `captureType: 'outline'` + `captureForMatching` | required when capturing for matching |
| `POST /skins/:id/signature` | required when the record has no cut; not re-asked if it has one |

400 on each, with `cut` named in the message.

`POST /skins` with `captureType: 'outline'` and no matching capture stays
unaffected: photographing an offcut purely to nest on it must not be
blocked by a question that has no bearing on nesting. If you genuinely
cannot tell what an unlabelled scrap is, you can still add it — you just
cannot measure it for matching until you can say.

`store.setSignature()` therefore accepts `cut` alongside the measurement.
It stays consistent with why that function exists: it adds a measurement
and changes nothing else about the hide.

When a cut *is* supplied for a record that already has one, it overwrites.
That is not incidental — it is currently the only way to correct a
mislabelled cut, because no edit-a-hide route exists (a hide can be
re-digitized, re-measured, or deleted, and nothing else). A general
editing route is out of scope here; if mislabelling turns out to be
common, that is the fix, not a special case in this function.

### UI

- `public/hides.html` gains a `<select id="hide-cut">` beside species.
  The validation in `src/hides-app.js` gains one clause, tied to
  `forMatchingInput.checked`.
- The auto-generated name must include cut, or a caiman tail and a caiman
  belly generate identical names. It abbreviates to two characters like
  the other fields, and all seven values differ in their first two
  letters — BE, FU, HO, LE, MU, TA, WH — so the claim that code's comment
  already makes about species holds for cuts.
- The Matching page's own add-a-hide form takes cut, required, since
  everything it creates is a signature capture.
- Pair rows on the Matching page show the flag when `unverified` contains
  `cut`, so a pair that could not be fully judged says so rather than
  sitting silently at the bottom of the list.
- Hide cards show cut beside species. The measure-an-existing-hide action
  prompts for cut when the record has none.

## Order of work

1. `src/skins/cuts.js` and its test.
2. `cut` through `store.create()` and `store.setSignature()`.
3. The gate and the ordering change in `rankMatches()`.
4. Route validation, all three paths.
5. UI: Hides form and auto-name, Matching form, pair flag, hide cards.

Steps 1–3 are the correctness fix and are independently testable. Step 4
closes the hole; step 5 makes it usable.

## Non-goals

- **`allowedCuts` on a component.** A component might one day require a
  specific cut — a vamp that must be hornback for the look. Nothing says
  one does yet, so it is not built. It would go beside the
  `allowedSpecies` check in `src/bestuse/eligibility.js`, as a hard
  exclusion with `reason: 'cut'`, and would need no change to this
  design.
- **Repairing `finish`.** The charts show treatment (suede, hand-painted,
  nappa), grade (gnarly), origin and grain as separate axes, and
  "semi-gloss" appears in no chart at all. Cut is separated out here
  because it is a correctness bug in matching; the rest is a modelling
  problem and gets its own spec.
- **The colour metric.** Swapping `colourDifference()` to CIEDE2000 is
  agreed and specced separately.
- **Cut filter tags and a cut sort order** on the hide library. Two hides
  do not need them.

## What would change this

- **A component that genuinely requires one cut** turns the `allowedCuts`
  non-goal into work.
- **A cut the supplier starts selling that isn't on the list** just
  extends `CUTS`. That is why the API does not enforce it.
- **Evidence that two cuts do pair.** If it turns out a caiman belly and
  a caiman flank are close enough in practice, the hard gate becomes
  wrong and the right answer is a compatibility relation between cuts
  rather than equality. Nothing suggests that yet, and equality is the
  trade's own rule.
- **`whole` proving too coarse.** A whole caiman skin contains belly and
  hornback regions, so two hides labelled `whole` are only comparable if
  their measured patches were dragged from corresponding places. The
  signature cannot know where the patch came from. If whole-skin matches
  turn out unreliable, the fix is in how the patch is chosen, not in this
  field.
