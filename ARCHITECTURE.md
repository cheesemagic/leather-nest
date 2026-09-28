# Architecture

What is actually here, as of 2026-09-27. Intended boundaries are marked as
such; everything else describes code you can go and read.

## Shape of the thing

A local web app. One operator, one machine, no accounts.

```
browser                     node                        python
-------                     ----                        ------
public/*.html    ──┐
src/*-app.js       ├──HTTP──> server.js ──execFile──> scripts/*.py  (OpenCV)
src/nesting/*    ──┘           │
(same modules, no bundler)     └──> data/{skins,parts,products,sessions,calibrations}/*.json
```

- **No framework, no bundler, no build step.** `server.js` is a stdlib
  `node:http` server. Pages load `src/*.js` directly as ES modules.
- **Single-language core.** The geometry and matching modules run unchanged in
  Node (server, tests) and in the browser. Keep them that way: the only files
  under `src/` that may import `node:*` are the five `*/store.js` files, which
  are server-only by definition because they read and write the filesystem.
  Everything else — all of `src/nesting/`, `src/svg/`, `src/bestuse/`,
  `src/interior.js`, `src/cut-order.js`, and the matching logic in
  `src/skins/` bar its store — must stay free of them. That property is what a
  mobile client would later reuse, and it is worth a one-line grep to keep:

  ```bash
  grep -rln "from 'node:" src/ | grep -v '/store.js$'   # must print nothing
  ```
- **One Python escape hatch.** Photo work — tracing an outline, measuring scale,
  sampling colour, matching texture — shells out to `scripts/*.py` via
  `execPython` in `server.js`. Nothing else does.
- **Flat-file storage.** One JSON file per record, `crypto.randomUUID()` for
  ids, a photo alongside the record where relevant. No database, no migrations.
  Records are not versioned, so **a field added later is simply absent from
  older records** — read defensively.

## Modules

The boundaries below are partly real and partly intended. Where a module does
not exist yet, that is stated rather than implied.

| Module | Where | State |
|---|---|---|
| **Catalog / inventory** | `src/skins/store.js`, `src/parts/store.js`, `src/products/store.js`, `src/sessions/store.js`, `src/calibrations/store.js` | Real, thin. Metadata is label/species/cut/finish/thickness. No SKU, no grade, no lot, no custom fields |
| **Geometry** | `src/nesting/geometry.js`, `src/svg/parse.js`, `src/svg/export.js`, `src/interior.js`, `src/fringe.js` | Real and the most developed part of the codebase |
| **Defect zones** | — | **Does not exist.** No defect, grade or zone concept anywhere. Nesting sees an outline and a remaining-area percentage |
| **Die library** | `src/parts/` | Real, but called **components/parts**. See DECISIONS.md — a laser job involves no die |
| **Nesting** | `src/nesting/`, `src/bestuse/` | Real. Two distinct things; see below |
| **Pattern digitizing** | `scripts/digitize.py`, `src/calibration-ui.js`, `src/region-select-ui.js` | Real for single pieces from a photo |
| **Export** | `src/svg/export.js`, `src/cut-order.js` | Real, **SVG only. There is no DXF support** — not read, not written |
| **Matching** | `src/skins/similarity.js`, `ciede2000.js`, `colour-order.js`, `scripts/blotch_match.py` | Real, and not in the module list above because it was not anticipated. It is half the product |

### Two different nesters, easily confused

**`src/nesting/`** — geometric bin packing. `nfp.js` computes no-fit-polygons
via clipper's `Clipper.MinkowskiSum`, which is **exact for concave parts too**.
This file claimed "convex only" for months; a convex decomposition was built on
that claim, measured, found to change nothing, and deleted. Do not rebuild it —
`test/nfp.test.js` guards the real behaviour.

The real concave limitation is in `place.js`, not the geometry: it takes the
**first** position where a part fits, scanning from the bottom left, which is
almost never an interlocked one. Measured — a deeply concave L places exactly as
many pieces as its convex hull, despite the hull being 32% larger. Deferred on
purpose; see `docs/superpowers/specs/2026-09-21-packing-density-design.md`.

**`scripts/blotch_match.py`**, driven from `src/sessions/` — visual
scrap-texture matching. Finds where on a photographed scrap a part's reference
placement best matches *by appearance*. Unrelated to the geometry above.

### Data model, in the detail that bites

- **Skins/Hides** (`src/skins/`) — internally "skins", user-facing "Hides".
  Deliberately not renamed; see `docs/superpowers/specs/2026-09-01-hide-library-design.md`.
  One record can carry a scale signature (`dominantWavelengthMm` /
  `radialSpectrum`), an outline polygon, or both — `POST /skins`'s
  `captureType` selects the pipeline.
  - `colourL`/`colourA`/`colourB` sampled from inside the outline, compared with
    CIEDE2000 at `COLOUR_LIGHTNESS_WEIGHT = 0`, so **`colourL` never reaches the
    result**: it tracks exposure and glare more than dye. Colour **ranks** pairs,
    it does not gate them — the threshold is still open and needs real labelled
    hide pairs. ΔE00 bands, for reference and **not enforced anywhere**: <1
    imperceptible, 1–2 perceptible on close inspection, 2–3.5 around practical
    tolerance, >5 clearly different colours. See
    `docs/superpowers/specs/2026-09-25-colour-difference-ciede2000-design.md` and
    `docs/superpowers/specs/2026-09-22-products-design.md`.
  - `finish` (matte / glossy / suede / hand-painted / pebble grain /
    hand-painted two-tone / nappa) is a **hard gate** on matching and is
    operator-set, because gloss cannot be measured from a photo. One field on
    purpose though the values span gloss, treatment and grain — every supplier
    chart states exactly one of them. `semi-gloss` was invented on our side and
    is gone; a test keeps it gone. See
    `docs/superpowers/specs/2026-09-26-hide-finish-design.md`.
  - `cut` (whole / belly / full quill / hornback / leg / tail) is also a **hard
    gate**: a caiman tail and a caiman belly are different scale geometry, and
    the supplier sells both as species "caiman". Unknown on either side still
    pairs, but is flagged `unverified: ['cut']` and sorts last. `multispine` is
    in the supplier charts but is **not** a cut — do not add it. **Required on
    every request that produces a scale signature and nowhere else**: an
    outline-only hide can be added without one, because nesting does not care.
    See `docs/superpowers/specs/2026-09-25-hide-cut-design.md`.
- **Parts** (`src/parts/`) — reusable pattern-piece shapes, from an uploaded SVG
  or from photo + calibration + region-select. UI says "Components".
  `dieClearanceMm` is a genuinely different concept that survived the rename:
  the clearance a physical steel-rule die needs if a piece is die-cut rather
  than lasered. See `src/nesting/clearance.js`'s `'laser'`/`'die'` split.
- **Sessions** (`src/sessions/`) — a working session against one photographed
  scrap: calibration + search region + placements.

### Shared photo pipeline

`src/calibration-ui.js` (click two points of known real distance to get a
px→mm scale) and `src/region-select-ui.js` (drag a region before digitizing)
are reused as-is by the parts flow, the hides flow, and the standalone
`digitize.html` / `match-*.html` pages. **Wire into this pair rather than
reimplementing the chain per feature** — `src/parts-app.js` and
`src/hides-app.js` show how.

### Routes

`server.js` is a single flat `http.createServer` callback matching on method +
`req.url`, regex for `:id` segments, no router library. Each feature's handlers
come from a `createXRoutes(dataDir)` factory closing over that feature's store.
Follow that rather than adding a router.

Two guards run before anything else, and both are load-bearing:

- **`isCrossOriginWrite`** rejects any non-GET request whose `Origin` is not
  this server. A browser sends a cross-origin multipart POST with no preflight,
  so without it any page the operator visited could write to these routes.
- **`SERVABLE_ROOTS`** in `serveStatic` limits static file serving to `public/`,
  `src/` and `node_modules/`. It is an allowlist so a directory added later is
  private by default. Before it existed, `.git/`, `.claude/` and every record in
  `data/` answered 200.

## The machine boundary

**leather-nest never talks to a machine.** It proposes placements, writes a cut
file (SVG), validates it, and shows it to a human for approval. A human loads
that file into the laser, CNC or clicker press and runs it. There is no serial
port, no G-code streaming, no job control, and there will not be.

This is a product boundary, not a missing feature. Optimization code that can
also fire a laser is a category of accident this project declines to have.

Two consequences for anyone working here:

- Export produces a file a human inspects. `src/svg/export.js` puts the hide
  outline in its own colour (`#0000FF`) specifically so the operator can align
  the offcut, with a comment in the file warning that it must be set to
  no-output or the laser will trace the edge of the leather. Do not merge that
  colour with the cut colour.
- **Which machine is not settled.** Earlier drafts named a Thunder Laser Nova 51
  driven by LightBurn as fact; it was an aspiration. The machines actually
  reachable are at a makerspace — an 80W Red Sail and a 150W Boss LS-3655 —
  and neither has been used. Assume only: large-bed CO2, SVG in. Treat LightBurn
  as one possible import target, not the target.

## Future service operations

Documented so the shape is agreed, **not built**. There is no API layer, no MCP
server, and no plan to add either in this pass. If one is ever built, these are
the operations it would expose — deliberately named as business operations
rather than CRUD, because each one has a rule attached:

| Operation | The rule that makes it non-trivial |
|---|---|
| `createHide` / `getHide` / `searchHides` | Metadata plus a photo; the photo pipeline may fail and must leave nothing behind |
| `importDie` (SVG) | The unit is often not stated in the file, and guessing it wrong is a 10x–100x error. Must be asked, not inferred |
| `fitCheck(part, scrap)` | Deterministic, and authoritative. Answers "does this physically fit inside this outline" |
| `runNesting(hide, parts)` | Same inputs must always give the same layout |
| `calculateUtilization` | Real quantities, not clamped — over-commitment must stay visible |
| `exportCutFile` | Produces a file for a human to approve. Never sends anything to a machine |
| `rankMatches(hides)` | Cut and finish are hard gates; colour only ranks |

## Deliberate non-goals

Hardware and robotics. Autonomous machine control. Multi-tenancy and accounts
(see DECISIONS.md, 2026-09-27). Any AI component deciding whether a shape fits,
what something measures, or what is in inventory.
