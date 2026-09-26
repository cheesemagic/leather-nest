# Finish: the supplier's word for it, and a gate on matching

Status: designed 2026-09-26, not built.

Fixes the `finish` vocabulary and makes it gate matching, the same way
`docs/superpowers/specs/2026-09-25-hide-cut-design.md` did for `cut`. That
spec carries the reasoning for the pattern; this one records only what is
different.

## The gap

Two problems, one small and one that matters.

**`semi-gloss` is invented.** The app offers glossy / matte / semi-gloss.
`semi-gloss` appears in none of the supplier's 39 charts, and the operator
confirmed (2026-09-26) it came from our side, not theirs. A hide labelled with
a word the supplier has no equivalent for cannot be ordered, described, or
matched against their catalogue.

**Finish does not gate matching.** A suede hide and a glossy hide of the same
species, cut, colour and scale size are currently eligible to pair, and will
rank as an excellent match, because every number the ranking looks at agrees.
They are not a match — asked directly, 2026-09-26: they would never pair.
Suede is the flesh side of the hide; it does not look like a glazed surface
and never will.

That is the same failure `cut` had, for the same reason: a real, visible
distinction the data model could not express, so the program was confidently
wrong rather than silent.

## Design

### One field, not three

The obvious move is to split `finish` into gloss (glossy, matte), treatment
(suede, hand-painted, nappa) and grain (pebble). They are genuinely different
kinds of thing, and a note in `leather-swatches.json` already says so.

**Rejected, because the charts argue against it.** Every chart carries exactly
one value in that slot: "Ostrich Leg Suede" is `suede`, "Ostrich Leg Glossy"
is `glossy`, and no chart states both. The supplier treats surface as a single
axis in practice, whatever the words mean taxonomically. Splitting it would
invent structure the source does not have, and produce three dropdowns and
three gates for a distinction nobody has yet needed.

What is wrong today is not the field count. It is that the vocabulary is made
up.

### The vocabulary is the charts', exactly

`src/skins/finishes.js`, mirroring `cuts.js` and `species.js`:

```
matte, glossy, suede, hand-painted, pebble grain, hand-painted two-tone, nappa
```

Seven values, ordered by how many charts use each, commonest first — unlike
`CUTS`, where `whole` leads because it is the default rather than the most
frequent. Nineteen of the 39 charts state no finish at all, and that stays
`null`: unknown, not a value.

`hand-painted` and `hand-painted two-tone` are two values rather than one, per
the catalogue's existing rule that names are recorded as printed and
normalising them is the supplier's call, not ours.

Not enforced server-side, for the reason `species.js` gives: the `<select>`
steers, and the API does not refuse a finish that arrived before this list was
updated.

### The gate, and one predicate for both fields

Identical rule to `cut`: two known and different finishes produce no pair;
unknown on either side produces a pair carrying `unverified`; equal values
pair cleanly.

`cutsCanPair()` becomes a single predicate over both fields, because "two
known different values never pair" is now the rule twice, and will be the rule
again if grade or origin ever lands. Two instances is where that abstraction
earns itself; one was not.

The `unverified` array already carries field names, so a pair missing both
reports `['cut', 'finish']` with no change to how it is consumed. The
partition sorting flagged pairs last already keys on `unverified.length === 0`
and needs no change at all.

### Required wherever a signature is produced

Same three routes, same rule, same error shape as `cut`. Both fields now
affect matching, so both are required exactly where matching is created, and
an outline-only hide still needs neither.

### No migration

Both records in `data/skins/` are SEED test data carrying `finish: null`. No
hide anywhere is labelled `semi-gloss`, so deleting the value strands nothing.

## Order of work

1. `src/skins/finishes.js` and its test, including one asserting `semi-gloss`
   is absent and that every finish the charts use is offered.
2. Generalise the pair gate; `finish` joins `cut` in it.
3. Route validation on the three signature paths.
4. UI: the Hides form, the Matching form, the edit dialog, the hide card.

## Non-goals

- **Splitting finish into three axes.** Argued above. A chart stating both a
  gloss and a treatment is the evidence that would reopen it.
- **Grade and origin.** The charts carry `gnarly` as a grade and Argentine /
  American / Australian / Italian as origins, and the trade grades exotic
  skins 1-4 (alligator 1-5) on defect count and sizes them by belly width in
  centimetres. None of it is modelled, none is needed for matching, and grade
  in particular is about defects — which belongs with the unbuilt defect map,
  not here.
- **Finish hidden inside colour names.** "Brown Suede" on the shark chart,
  "Matte Black" on Lizard 2, "Silver Metallic" on Python Glossy. Splitting
  those needs the supplier's confirmation rather than a regex — already
  recorded in the catalogue's caveats.

## What would change this

- **A chart stating both a gloss and a treatment** breaks the one-axis
  argument and reopens the split.
- **Evidence that two finishes do pair** — a matte and a glossy of one dye
  being acceptable in a product, say — would make this gate too strict. The
  failure mode is invisible, because a pair that is never produced cannot be
  seen, so it is worth revisiting once real hides are being matched rather
  than assumed.
