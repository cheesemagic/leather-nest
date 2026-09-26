# Handoff

**Last updated: 2026-09-25** — keep this file current rather than adding dated copies.

Paste the block below into a new session, or just say "read `docs/handoff.md`".
It assumes `CLAUDE.md` is already loaded, so it carries only what that file
does not: the state of play and what is open.

---

Picking up leather-nest (`~/leather-nest`) where the last session left off.
490 tests passing. Don't redo any of the below.

## What is already built

**Hide capture and matching**
- A hide can be photographed, outlined, colour-sampled, and measured for
  matching — either when first added (a toggle plus its own "drag a patch of
  scales" region) or afterwards via `POST /skins/:id/signature`, which changes
  nothing else about the hide.
- Re-digitize after cutting (`POST /skins/:id/redigitize`) replaces the outline
  and colour with what is actually left. Distinct from the above on purpose: a
  part-cut hide measured for matching must stay part-cut.
- Correct a hide's operator-set fields afterwards (`POST /skins/:id`, Edit
  button on each card).

**Matching correctness**
- `cut` is a hard gate: matching never pairs across cuts, because a caiman
  tail and a caiman belly are not the same material. Vocabulary is
  whole/belly/full quill/hornback/leg/tail (`src/skins/cuts.js`). Required
  wherever a signature is produced. Spec:
  `docs/superpowers/specs/2026-09-25-hide-cut-design.md`.
- Colour difference is **CIEDE2000 (ΔE00)**, verified against the Sharma
  reference dataset, not a straight-line a*/b* distance. The old number had no
  unit and meant nothing; ΔE00 arrives with published tolerance bands. Spec:
  `docs/superpowers/specs/2026-09-25-colour-difference-ciede2000-design.md`.
- One shared species list (`src/skins/species.js`), 19 species, used by every
  place that asks for one. This fixed a real bug: the app said "cayman" while
  every supplier chart says "caiman", and matching groups on the exact string.

**Library and products**
- Delete behind a confirmation that names what is lost; six sort orders
  including colour, and the choice persists across reloads.
- Products carry a `demand`; `demandSatisfied` is computed.
- `docs/reference/leather-swatches.json` — the supplier catalogue transcribed:
  39 charts, 413 swatches, 152 colour names, 19 species.

## Read this before proposing nesting work

**The "concave NFP gap" does not exist.** clipper's `MinkowskiSum` is exact for
concave parts — measured twice, most recently 12.1% tighter than the convex
hull's NFP on a deep L. A stale comment claiming otherwise has already cost two
separate sessions: one built and then deleted a whole convex decomposition on
the strength of it (commit `9ff78a9`), and one proposed it again as priority
work. `test/nfp.test.js` guards the real behaviour now.

The real limitation is the greedy first-fit search — a concave L places exactly
as many pieces as its convex hull despite the hull being 32% larger. That is
"stage two" in `docs/superpowers/specs/2026-09-21-packing-density-design.md`,
deliberately deferred until exotics are actually being cut.

## Open, in rough priority order

1. **Nothing has ever been cut on a laser.** Machine still undecided (80W Red
   Sail vs 150W Boss, both at a makerspace, neither used). Every clearance
   number is an assumption; kerf is not modelled at all. Largest gap against
   priority 1, and unchanged for weeks.
2. **The colour threshold is still unset.** CIEDE2000 deliberately did not
   settle it — its spec says so outright: colour still ranks, it does not gate.
   What changed is the starting point. Instead of inventing a number from
   nothing, the question is now "are the published CIE bands (<1 imperceptible,
   2–3.5 practical tolerance, >5 clearly different) the right line for
   leather?" Still needs Andrew to add real hide pairs and give a human verdict
   on which he would accept, including one genuine close call.
3. **Multi-hide colour pooling for products** — Andrew confirmed he wants it:
   non-sneaker products should draw from all hides of the same colour. Blocked
   on #2 for the threshold, and needs multi-bin nesting in `place.js`, which
   today nests onto one sheet only.
4. **Questions for Magna are written but unsent** — seven questions and five
   material asks: whether a pair needs two hides or a full set, where "close
   enough" stops, whether Magna shoots their own photos.
5. **The taxonomy is only half modelled.** `cut` landed. Still unmodelled:
   treatment (suede / hand-painted / nappa), grade (gnarly), origin
   (Argentine / American / Australian), grain (pebble). And `semi-gloss` is
   still offered in the finish dropdown despite appearing in **no** supplier
   chart — likely invented on our side, worth confirming and removing.
6. **Swatch images are still not on disk.** `docs/reference/swatches/` exists
   with a README explaining what goes there and why, but it is empty. The
   photos arrived as chat attachments and cannot be written from there. With
   them on disk, 413 colour *names* become 413 measured colour *standards*.

## Smaller open items

- The charts carry **no scale reference**, so they are colour names only. One
  number from the supplier unlocks them: the physical size of a swatch patch.
- **Finish is sometimes inside the colour name** ("Brown" and "Brown Suede" on
  one chart; "Matte Black"; "Silver Metallic"). A vocabulary built on these
  strings alone treats those as unrelated colours.
- **"Natural" is not a colour** — it is undyed, and a Natural cobra looks
  nothing like a Natural viper. Any name-to-colour lookup must key on
  species + name.
- **Archive vs delete for hides**: decided to add archive when the first hide
  is actually used up, not before. Nothing is near spent.

## Environment note

Prismor (runtime security for coding agents) is installed **observe-only, scoped
to this workspace**, with no data leaving the device — no `--judge`, not
enrolled, no transcript backfill. Two caveats:

- **Secret cloaking is NOT active.** Its install step failed with `jq not
  found`. Fix: `brew install jq`, then re-run the same `prismor setup` command.
- It appended a "Security (Prismor)" section to `CLAUDE.md` and installed a
  654-line skill at `.claude/skills/immunity-agent/` (gitignored, local only).

---

Start by telling me what you think the highest-value next move is, and why.
Don't build anything until I agree.
