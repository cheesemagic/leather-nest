# Keeping a product's visible pieces on one hide

Status: designed 2026-09-26, not built.

Stage two of multi-hide nesting. `nestAcrossHides()` (stage one, merged
2026-09-26) spills a flat list of parts across a library, smallest hide
first. This adds the rule that stops it producing a visibly mismatched
product.

## The gap

Asked directly, 2026-09-26: may one product's set be split across hides — a
wallet's back from hide A, its pockets from hide B? The answer was **yes, for
some products**. A hidden interior pocket can come from anywhere. A visible
pair of shoe vamps cannot, and a program that cut them from two different
caiman hides would have produced exactly the mismatch this whole project
exists to prevent.

Nothing in the data model can express that distinction today, and there is a
more basic problem underneath it.

### Set membership does not exist

`buildSetParts()` in `src/bestuse/products.js` builds a set count's worth of
pieces with a flat counter:

```js
for (let n = 0; n < p.quantity * sets; n++) {
  parts.push({ id: `${component.id}#${n}`, ... });
}
```

Five sets of a two-pocket wallet produce `pocket#0` through `pocket#9` and
`back#0` through `back#4`. **Nothing records that `pocket#6` and `pocket#7`
belong with `back#3`.** It never mattered, because every piece landed on one
hide, so any grouping would have been the same grouping.

The moment pieces can land on different hides, that is the blocker: "keep this
set together" cannot be expressed against pieces that do not know which set
they belong to. Recording it is the foundational change, and it comes first —
though not, as it turns out, in the id.

## Design

### One flag, on the component

`mustMatch`, a boolean on a component record, beside `allowedSpecies` and
`dieClearanceMm`.

On the component rather than on the product's part entry, because visibility
is a property of the piece: a vamp is visible in whatever it is part of, a
pocket lining is hidden in whatever it is part of. A component that is visible
in one product and hidden in another is possible, and is the evidence that
would move this onto the product-part relationship — but nothing suggests one
exists, and a field on the relationship costs an extra editing surface for a
case nobody has.

Named for the constraint rather than the reason. "Visible" is why the operator
ticks it, but visibility is not the only reason pieces might need to come off
one hide — stretch direction and grain are others — and a field named for one
reason invites arguments about whether the others count.

### It defaults to true, and that is the whole safety story

An existing component has no `mustMatch`, and absent reads as **true**.

This matters more than it looks. Default false would mean every component in
the library silently became spannable the moment this shipped, and the first
sign would be a finished product with mismatched panels. Default true means
behaviour is identical to today until someone deliberately marks a piece as
spannable.

So the feature is opt-in to a yield gain, and never opt-in to a quality risk.
The consequence is worth stating plainly: **until components are marked, this
changes nothing**, and a library nobody has annotated behaves exactly as it
does now.

Unlike `cut`, there is no third "unknown" state. A gate needs to know when it
could not check, because the answer changes what it reports; here, unknown and
true produce identical behaviour, so a separate state would be a distinction
with no consequence.

### Set membership is a field, not a new id format

The obvious move is to put the set into the id — `back#set0#0` instead of
`back#0`. **It would break `componentIdOf()`**, which recovers a component id
with

```js
partId.slice(0, partId.lastIndexOf('#'))
```

On `back#set0#0` that returns `back#set0`, not `back`, and since
`componentIdOf` is what `counts`, `noDie` and `unverified` are keyed by
throughout `evaluate.js` and `products.js`, every one of those would silently
miskey. Widening the id format also means anything that ever parses an id has
to learn the new shape.

So ids do not change at all. `buildSetParts()` keeps emitting
`${component.id}#${n}` with its flat counter — which is already unique across
sets — and attaches the set index as a plain field on the part object:

```js
parts.push({ id: `${component.id}#${n}`, setIndex, componentId, polygon, ... });
```

`groupOf(part)` receives the part object, so it can read that field directly.
Rollback works on placements, which carry only an id, so the nester builds its
own `id -> group` map from the parts it was handed. The caller needs the same
map to report which sets came out complete, and it has it for free: it built
the parts.

Nothing is persisted either way — these parts exist for one nesting run — so
there is no migration under either design. The field is simply the one that
cannot break anything.

### Group-aware nesting, by rollback

`nestAcrossHides()` gains an optional `groupOf(part)` returning a group key, or
`null` for a part that may land anywhere. Parts sharing a key must land on the
same hide.

The implementation is the lazy one: nest the hide as now, then check each
group, and **roll back any group that came out only partly placed** — its
placements are discarded and its parts return to the remaining list for the
next hide.

Rolling back leaves space on that hide that something else could have used, so
this loses yield rather than correctness. The alternative — re-nesting the hide
without the failed group, repeatedly until it settles — costs a full NFP scan
per attempt for a gain nobody has measured. Ship the rollback, measure the
waste on a real library, and only then decide whether the re-nest is worth it.

`groupOf` is a caller-supplied function for the same reason `eligibleFor` is:
`multi.js` has no business knowing what a product or a set is.

### What products do with it

`evaluateProductCandidate()` keeps its binary search over set count. What
changes is what counts as success at a given N: every set's must-match group
lands wholly on one hide, and every free piece lands somewhere.

The binary search already assumes monotonicity — succeeding at N sets implies
succeeding at fewer — and documents why in `products.js`: `place()` is a
strictly sequential greedy scan, so removing items can only leave more room.
This inherits that assumption rather than establishing a new one.

What is worth checking is whether rollback weakens it. It should not: rollback
only ever removes placements, and removing a group at N leaves at least as much
space as the same run at N-1 would have had. But this is an argument, not a
proof, and greedy packing is where arguments of this shape have been wrong
before in this repo. **A test should assert it directly** — that a product
whose components span hides reports no more complete sets at N than at N-1 —
rather than trusting the reasoning.

A product whose components are all `mustMatch` (the default) behaves exactly as
it does today, except that the one hide it lands on may now be any hide in the
library rather than the one being examined.

### UI

A checkbox on the Components page, on both the create and edit forms:

> **Must be cut from the same hide as the rest of the set**
> Tick for pieces that are visible together on the finished product — a pair
> of vamps, a wallet's front and back. Leave unticked only for pieces nobody
> sees side by side, such as an interior lining.

Ticked by default, matching the stored default. Shown on the component card so
the annotation is visible without opening the form, because a library where
nobody can see which pieces are marked is a library nobody will trust.

## Order of work

1. `setIndex` as a field through `buildSetParts()`; ids untouched, with a test
   asserting `componentIdOf()` still recovers the component id unchanged.
2. `mustMatch` through the parts store and its update validator, defaulting to
   true.
3. `groupOf` and the rollback in `nestAcrossHides()`, with a test that a
   partly-placed group is returned whole to the next hide rather than cut in
   half.
4. `evaluateProductCandidate()` across hides.
5. UI: the Components create and edit forms, and the card.

Steps 1 and 3 are independent and separately testable. Step 4 is where they
meet and is the one to review hardest.

## Non-goals

- **Choosing which hides a product may draw from.** This spec spans whatever
  library it is handed. Restricting that to hides of one colour is multi-hide
  colour pooling, which is still blocked on the colour threshold, and which
  this is a prerequisite for rather than a part of.
- **Matching the hides a set spans.** Two hides holding one product's pieces
  are not checked against each other for scale or colour. That is what
  `mustMatch` exists to avoid needing: a spanned piece is one nobody sees
  beside another. If spanned pieces ever do need to match, that is a different
  feature, and a much larger one.
- **Per-product overrides.** Argued above.
- **Re-nesting after a rollback.** Argued above; measure first.

## What would change this

- **A component visible in one product and hidden in another** moves the flag
  onto the product-part relationship.
- **Measured rollback waste** on a real library decides whether the re-nest
  pass is worth building. Until hides are actually being cut there is nothing
  to measure, so this stays the lazy version.
- **Anyone ticking nothing.** If the library is never annotated this feature is
  inert by design — the safe failure, but it also means the yield gain depends
  entirely on the annotation being done. Worth checking that it actually gets
  done before building more on top of it.
