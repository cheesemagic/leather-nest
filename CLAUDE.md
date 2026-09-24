# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local web app that nests laser-cut leather pattern pieces onto irregular
exotic-leather scrap offcuts. Single operator, desktop laser — not an
industrial hide-cutting system.

**The target machine is not settled.** Earlier drafts of this file named a
Thunder Laser Nova 51 (100W CO2) driven by LightBurn as if it were a fact; it
was an aspiration. The machines actually reachable are at a makerspace — an
80W Red Sail and a 150W Boss LS-3655 — and neither has been used yet. Assume
only: large-bed CO2, SVG in. Do not design against a specific controller,
bed size, or LightBurn feature until someone has stood at the machine.

**Every physical constant in this repo is an assumption, not a measurement.**
`DEFAULT_LASER_CLEARANCE_MM` (1.0), `DEFAULT_DIE_CLEARANCE_MM` (2.5) and
`PACKING_EFFICIENCY` (0.75) were chosen in conversation. Kerf is not modelled
at all. Nothing here has been checked against cut leather. Say so when one of
these numbers carries an argument, and prefer a cheap real-world test over
another simulation once the laser is reachable.

## Commands

```
npm install                              # Node deps (clipper-lib, formidable)
npm start                                # runs server.js, http://localhost:8080
npm test                                 # node --test (all test/*.test.js)
node --test test/nesting.test.js         # run a single test file
python3 -m venv venv && venv/bin/pip install -r requirements.txt   # one-time, for photo digitization
```

There is no build step and no test runner dependency — `node --test` is
Node's built-in runner. The server calls `venv/bin/python3` directly; the
venv never needs activating.

## Architecture

**Single-language core, one Python escape hatch.** Nesting, matching, and UI
logic are plain ES modules (`type: "module"` in package.json) run both in
Node (server, tests) and the browser (loaded as `<script type="module">`
directly from `src/`, no bundler). `server.js` is a stdlib-only
`node:http` server — no Express. Photo-based digitization (turning a photo
into a traced outline, or computing a scale signature) is the one place that
shells out to Python/OpenCV, via `child_process.execFile` in `server.js`
calling scripts in `scripts/`.

**Data model:** three independent flat-file JSON stores, all built on the
same pattern (see `src/skins/store.js`, `src/parts/store.js`,
`src/sessions/store.js`): one `.json` record per entity in a data directory
(default `data/{skins,parts,sessions}/`, overridable via `createServer()`
options — tests always override to a temp dir), `crypto.randomUUID()` ids,
an associated photo file stored alongside the record when relevant. No
database.

- **Skins/Hides** (`src/skins/`) — despite the internal name "skins", the
  user-facing feature is "Hides" (`public/hides.html`). One record can carry
  a scale signature (`dominantWavelengthMm`/`radialSpectrum`, from
  `skin_signature.py`, used by `src/skins/similarity.js`'s `rankMatches()`
  for cross-skin scale matching), an outline polygon (from `digitize.py`,
  the cuttable shape), or both — `POST /skins`'s `captureType` field
  (`"signature"` default, or `"outline"`) selects which pipeline runs. Also
  carries colour (`colourL`/`colourA`/`colourB`, sampled from inside the
  outline by `digitize.py` — compare on `colourA`/`colourB` only, `colourL`
  tracks exposure/glare more than dye, see
  `docs/superpowers/specs/2026-09-22-products-design.md`) and `finish`, an
  operator-set label (gloss can't be measured from a photo — it's lighting-
  dependent). Deliberately not renamed to "hides" internally — see
  `docs/superpowers/specs/2026-09-01-hide-library-design.md` for why routes
  and the data directory keep the old name.
- **Parts** (`src/parts/`, renamed from "Dies" 2026-09-22 — a laser job
  involves no die at all, see the products spec) — reusable pattern-piece
  shapes, created either by uploading an SVG directly (`src/svg/parse.js`)
  or by photo + calibration + region-select, digitized the same way hide
  outlines are. The UI still says "Components" (`public/parts.html`), the
  user-facing name chosen when this module was still called "Dies" and left
  as-is by the rename. `dieClearanceMm` on a part record is a genuinely
  different, unrenamed concept: the clearance a physical steel-rule die
  needs if this piece is *die-cut* rather than lasered — see
  `src/nesting/clearance.js`'s `'laser'`/`'die'` cutting-method split.
- **Sessions** (`src/sessions/`) — a working session against one photographed
  scrap: calibration + search region + a list of part placements. Each
  placement search shells out to `scripts/blotch_match.py` (visual
  scrap-texture matching, not the NFP geometric nester) to find where on the
  scrap a part's reference placement best matches by appearance.

**Nesting engine** (`src/nesting/`) is the original, separate v0 feature —
geometric bin-packing, unrelated to the blotch-matching session flow above.
`nfp.js` computes no-fit-polygons via `clipper-lib`'s `Clipper.MinkowskiSum`,
which is **exact for concave parts too** — this file claimed "convex only"
for months, a convex decomposition was built on that claim, measured, found
to change nothing, and deleted. Do not rebuild it; `test/nfp.test.js` guards
the real behaviour. (See the licensing note in
`docs/superpowers/specs/2026-08-24-leather-nesting-design.md` for the separate
reason this project does *not* use SVGnest's orbiting-NFP code.) `place.js` is
a first-fit placement scan; `index.js` just orchestrates the two.

The real concave limitation is in `place.js`, not the geometry: it takes the
first position where a part fits, scanning from the bottom left, which is
almost never an interlocked one. Measured — a deeply concave L places exactly
as many pieces as its convex hull, despite the hull being 32% larger. That is
"stage two" in `docs/superpowers/specs/2026-09-21-packing-density-design.md`,
deliberately deferred until exotics are actually being cut.

**Photo pipeline shared across features:** `src/calibration-ui.js` (click
two points of known real-world distance to get a px→mm scale) and
`src/region-select-ui.js` (drag a ROI before digitizing) are reused as-is
across the parts photo-add flow, the hides outline-add flow, and standalone
`public/digitize.html`/`public/match-*.html` pages. Don't reimplement this
chain per feature — wire into the existing pair the way `src/parts-app.js`
and `src/hides-app.js` do.

**Frontend:** no framework, no bundler. Each `public/*.html` page pairs with
one `src/*-app.js` module loaded directly as an ES module. `public/index.html`
is the public landing page, linking to `public/hides.html` as the real
starting point of the actual workflow (photograph a hide → add components on
`public/parts.html` → optionally group them into a product on
`public/products.html` → run the search on `public/find-best-use.html`).
`public/app.html` is NOT that tool — it's the original v0 nesting-engine
demo (one hardcoded rectangle, two hardcoded parts), predating the hide/part
library entirely, disconnected from any real data. Kept only as a minimal
sanity check of `src/nesting/index.js` in isolation; nothing links to it
anymore. `server.js`'s `serveStatic` serves any file under the repo root by path
(with a path-traversal guard), so `public/`, `src/`, and their assets are all
directly browser-reachable — no separate static/build directory.

**Route pattern:** `server.js` is a single flat `http.createServer` callback
matching on method + `req.url` (regex for `:id` segments), no router
library. Each feature's route handlers are grouped by a `createXRoutes(dataDir)`
factory closing over that feature's store — follow this pattern for new
routes rather than introducing a router dependency.

## Testing conventions

- `node:test` + `assert` only, no test framework/library.
- Route tests spin up a real server on an ephemeral port via
  `test/helpers/with-server.js`'s `withServer(fn, { withDataDir, ... })`,
  which gives each test an isolated temp data directory and tears it down
  after.
- Fixture images under `test/fixtures/` are generated by the
  `test/fixtures/generate-*.py` scripts (not committed as opaque binaries
  without a source) — regenerate rather than hand-editing if a fixture needs
  to change.
- Browser-only UI (page wiring in `src/*-app.js`) has no automated test
  coverage by established convention in this repo; don't add one unless
  asked.

## Design/planning docs

Feature work in this repo goes through a spec → plan pair under
`docs/superpowers/{specs,plans}/`, dated and named per sub-project (e.g.
`2026-09-01-hide-library-design.md` / `2026-09-01-hide-library-v1.md`).
These documents record *why*, including reordering decisions and explicit
non-goals — check them before assuming a missing feature is an oversight
rather than a deferred, documented decision.

## Working with Andrew

Full profile and reasoning: `docs/working-with-me.md`. The rules that matter
every session:

**Talking**
- Plain English, half the length, especially about code. Bullets over prose.
  Tables are fine on desktop, bad on a phone.
- Say what you think. No confidence percentages, no hedging. If it's a guess,
  say "this is a guess" and move on.
- Describe what the program does, not what the code says. Name a constant by
  its effect, not its identifier.
- Never offer passing tests as evidence that something is right.

**Asking**
- Read the code and `docs/superpowers/{specs,plans}/` before asking anything.
  Never ask how the code works.
- Don't ask a question he lacks the background to answer — that includes
  choosing between implementations and judging how you should explain things.
  A question he can't answer is a rubber stamp with extra steps.
- Do ask about the physical world and about what the product is for. That's
  where his judgment leads and you have none.
- A "yes" to a dense technical message means *keep going*, not *I agree*.
  Never cite it later as a choice he made.

**Deciding**
- Decide alone: structure, naming, file layout, test design, anything
  reversible that doesn't change behaviour.
- Stop and tell him before changing how the app behaves, touching code that
  already works, or when the literal request would break something else.
- When you stop: state the conflict plainly, give **one recommendation**, ask
  for a go-ahead. Never a menu of options.
- Good goal, weak implementation → keep the goal, propose better, say you did.
- Once he settles a direction, stop reopening it without new evidence.

**Ideas**
- Half-formed idea → two or three short directions, not one deep one.
- Weak idea → say so immediately, why, and what to do instead.
- Never kill an idea without saying what survives.
- Push back on premises harder than on code. Always with a way forward.

**Finishing**
- End every session with a plain-English list of what changed — what it does
  now that it didn't before. Not a commit log, not test output.
- When a change is visual, produce something he can look at.

**Priorities** — name which one a proposed piece of work serves; if none, say
so and don't propose it:

1. Cut real pieces from real scrap, and they come out right.
2. Andrew understands the thing well enough to direct it (≈60% domain
   knowledge, ≈40% software).
3. Polished enough to show people.
4. Magna using the matching tool — droppable.

The cutting side serves us; the matching side serves Magna. Magna owns no
laser cutter and does not want one — they care about matching pieces, not
utilization. Do not reintroduce "efficiency saves Magna money" framing.

**Teaching** — at the moment a concept has a physical consequence, in the
summary, never mid-task.
