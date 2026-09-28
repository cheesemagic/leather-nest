# AGENTS.md

Rules for any coding agent working in this repository. Vendor-neutral —
`CLAUDE.md` imports this file and adds only Claude-specific notes.

## What this is

leather-nest helps a small leather shop get pattern pieces out of irregular
exotic hides and scrap. It does two jobs. **Nesting**: given a hide outline and
a set of pattern pieces, work out a layout that wastes the least leather and
write a file a laser can cut. **Matching**: given a library of photographed
hides, work out which two could pass as a matched pair, so a finished pair of
shoes doesn't have one visibly different from the other. Inputs are phone
photos and uploaded SVG. It is a local web app for one operator — not an
industrial hide-cutting system, and it never talks to a machine.

Read `ARCHITECTURE.md` next. It describes what is actually built, which is not
the same as what you might assume from the feature names.

## Deterministic code decides; AI may suggest

**Deterministic code is authoritative** for geometry, units and scale, physical
fit, inventory state, and every calculation. That code is the answer, not an
input to one.

An AI component may **suggest, rank, or explain**. It may never:

- decide whether a shape physically fits,
- compute or adjust a dimension,
- hold its own copy of inventory state.

The reason is not purity. The output of this program is a file that cuts a
several-hundred-dollar hide which cannot be uncut, and a model that is usually
right is the wrong tool for an irreversible physical operation.

## Two things that are never optional

**Every geometry value carries explicit units.** In practice that means:
millimetres everywhere, and an `Mm` suffix on the identifier —
`thicknessMm`, `clearanceMm`, `realDistanceMm`, `dominantWavelengthMm`. Units
are resolved exactly once, at the import boundary (`src/svg/parse.js`), and
everything past it is millimetres. A bare number crossing a function boundary
is a bug even when it currently holds the right value, because the next reader
has no way to check it. A file with no stated unit is **asked about, never
guessed** — the realistic error is 10x to 100x, and it is invisible until
leather is cut.

**Geometry from outside is validated before it is stored.** Outlines arrive from
OpenCV and from uploaded SVG; both are untrusted input. Run them through
`validatePolygon` (`src/nesting/geometry.js`) at the boundary. It refuses what
no real photo or drawing produces: fewer than three points, non-finite
coordinates, zero area, self-crossing, or dimensions too large to be real. It
does not repair — a shape that broken means the photo, the region or the file
was wrong, and quietly straightening it hides the thing the operator has to fix.

**There is no multi-tenancy, and that is a decision, not a gap.** Single shop,
local tool, `127.0.0.1`, no accounts. Do not add tenant ids, shop scoping or an
auth layer speculatively. See DECISIONS.md (2026-09-27) and the Production Gate
in SECURITY.md for what would have to be true before real customer data went in.

## Dev rules

- **Inspect before changing.** Read the code, and read
  `docs/superpowers/{specs,plans}/` — a missing feature is often a documented,
  deferred decision rather than an oversight. Comments here carry measured
  results, including things that were tried and did not work; do not undo one
  without new evidence.
- **Extend, don't rewrite.** No new dependency for what a few lines can do. The
  whole runtime is two packages, and `node --test` is Node's own runner. Keep it
  that way.
- **Behavioural change means tests.** Non-trivial logic leaves behind one
  runnable check that fails if the logic breaks.
- **"It compiles" and "it renders" do not mean done.** Neither does "the tests
  pass" — see the loop below.
- **Never present passing tests as evidence that something is right.** Say what
  you ran and what it demonstrated.
- **Every physical constant in this repo is an assumption, not a measurement.**
  `DEFAULT_LASER_CLEARANCE_MM` (1.0), `DEFAULT_DIE_CLEARANCE_MM` (2.5) and
  `PACKING_EFFICIENCY` (0.75) were chosen in conversation. Kerf is barely
  modelled. Nothing has been checked against cut leather. Say so when one of
  these numbers carries an argument, and prefer a cheap real-world test over
  another simulation.

### Testing conventions

- `node:test` + `assert` only. No framework, no fixtures directory beyond
  `test/fixtures/`.
- Route tests spin up a real server on an ephemeral port via
  `test/helpers/with-server.js`'s `withServer(fn, { withDataDir, ... })`, which
  gives each test an isolated temp data directory and tears it down after.
- Fixture images are **generated** by `test/fixtures/generate-*.py`, not
  committed as opaque binaries. Regenerate rather than hand-editing.
- Browser-only UI wiring (`src/*-app.js`) has no automated coverage by
  established convention. Don't add it unless asked.
- A new test should fail before the fix and pass after. If you cannot show that,
  you have not established the test tests anything.

## The loop for substantial work

1. **Write the acceptance criteria** first, as statements that can be checked.
   Use `docs/features/_template.md` for anything meaningful.
2. **Implement.**
3. **Run the tests.** `npm test`.
4. **Run the verifier** (`.claude/agents/verifier.md`) against the change.
5. **Fix every criterion it shows unmet.** Re-run.
6. **Report** concisely: what it does now that it didn't before, in plain
   English, and what you actually ran.

Step 4 is not optional for substantial work, and step 3 passing is its
precondition, not a substitute for it. The verifier assumes you are wrong.

## Ask a human first

Stop and get approval before:

- destructive database or data-directory operations,
- deploying anything,
- changing authentication or authorization,
- rotating, deleting or adding credentials,
- a significant schema or record-format change,
- deleting existing functionality,
- a major rewrite or a framework change,
- **anything that changes machine output** — cut files, kerf, clearance, cut
  order, export colours. A file that cuts differently than before is the one
  category of change that can destroy material.

Also stop — separately from the list above — before changing how the app
behaves, before touching code that already works, and when the literal request
would break something else. State the conflict plainly, give **one**
recommendation, and ask for a go-ahead.

## Working with Andrew

Full profile: `docs/working-with-me.md`. The rules that matter every session:

**Talking**
- Plain English, half the length, especially about code. Bullets over prose.
  Tables are fine on desktop, bad on a phone.
- Say what you think. No confidence percentages, no hedging. If it's a guess,
  say "this is a guess" and move on.
- Describe what the program does, not what the code says. Name a constant by its
  effect, not its identifier.

**Asking**
- Read the code and the specs before asking anything. Never ask how the code
  works.
- Don't ask a question he lacks the background to answer — that includes
  choosing between implementations and judging how you should explain things. A
  question he can't answer is a rubber stamp with extra steps.
- Do ask about the physical world and about what the product is for. That's
  where his judgment leads and you have none.
- A "yes" to a dense technical message means *keep going*, not *I agree*. Never
  cite it later as a choice he made.

**Deciding**
- Decide alone: structure, naming, file layout, test design, anything
  reversible that doesn't change behaviour.
- When you stop: state the conflict plainly, give **one recommendation**, ask for
  a go-ahead. **Never a menu of options.**
- Good goal, weak implementation → keep the goal, propose better, say you did.
- Once he settles a direction, stop reopening it without new evidence.

**Ideas**
- Half-formed idea → two or three short directions, not one deep one.
- Weak idea → say so immediately, why, and what to do instead.
- Never kill an idea without saying what survives.
- Push back on premises harder than on code. Always with a way forward.

**Finishing**
- End every session with a plain-English list of what changed — what it does now
  that it didn't before. Not a commit log, not test output.
- When a change is visual, produce something he can look at.

**Teaching** — at the moment a concept has a physical consequence, in the
summary, never mid-task.

**Priorities** — name which one a piece of work serves; if none, say so and
don't propose it:

1. Cut real pieces from real scrap, and they come out right.
2. Andrew understands the thing well enough to direct it (≈60% domain
   knowledge, ≈40% software).
3. Polished enough to show people.
4. Magna using the matching tool — droppable.

The cutting side serves us; the matching side serves Magna. Magna owns no laser
cutter and does not want one — they care about matched pieces, not utilization.
Do not reintroduce "efficiency saves Magna money" framing.

## Confidential material

Some data here came from a real partner shop that has not formally agreed to
anything. Treat it as confidential: do not move it into public locations, example
files, or anything published.

- `docs/reference/leather-swatches.json` — a supplier's physical sample charts
  transcribed (39 charts, 413 colour names, and their taxonomy).
- `docs/magna-visit.md` — names Magna and describes how they work.
- `data/` — live records and hide photos. Gitignored, and has never been
  committed. Keep it that way.

## Planning docs

Feature work goes through a spec → plan pair under
`docs/superpowers/{specs,plans}/`, dated and named per sub-project. They record
*why*, including reordering decisions and explicit non-goals. Settled decisions
graduate into `DECISIONS.md`.
