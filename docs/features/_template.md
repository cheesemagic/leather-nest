# <Feature name>

**Date:** YYYY-MM-DD
**Serves priority:** <1 cut real pieces / 2 Andrew understands it / 3 showable /
4 Magna matching> — if none, stop and say so rather than filling this in.

## Objective

One paragraph. What the operator can do afterwards that they cannot do now.
Not the implementation.

## User-visible behaviour

What they see and do, in order. Name the page and the control.

## Acceptance criteria

Checkable statements, not intentions. Each one is something the verifier can
independently establish.

- [ ] …
- [ ] …

## Failure behaviour

What happens when it goes wrong, and what the operator is told. Every failure
mode gets a sentence they could act on — never a stack trace, never jargon.

- If <X> fails: <what they see>, <what is left behind>.

## Data affected

Which records and which fields are created, changed, or deleted. Name anything
that overwrites a measurement, and anything a failure could half-write.

## Units

Every geometry value this touches, and its unit. Where the unit is resolved.
If a value crosses a boundary without an `Mm` suffix, say why.

## Edge cases

The ones actually considered — including any deliberately not handled, and why.

## Required tests

Which invariant each one protects, and how it was shown to fail before the fix.

## Non-goals

What this deliberately does not do, so the next reader does not mistake it for
an oversight.

## Machine output

Does this change a cut file, kerf, clearance, cut order, or export colour?
**If yes, it needs human approval before implementation** — see AGENTS.md.
