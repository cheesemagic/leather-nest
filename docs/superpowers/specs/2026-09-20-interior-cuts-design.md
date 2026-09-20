# Interior cuts

**Status:** built
**Date:** 2026-09-20

A component was one closed outline and nothing else. Real dies are not: the
operator's photos show hardware holes, decorative perforation, stitch guides,
and — once fringe came up — slits. The SVG importer refuses any file with more
than one path precisely because there was nowhere to put the second one.

## What a component can carry now

`component.interiorPaths` — a list of `{ kind, points, closed }`. Absent on
every component made before this existed, so it defaults to empty and nothing
old changes.

Three kinds, because a laser can do three things to a line and the only way a
file can say which is by colour. The operator maps colour to power and speed
at the machine.

| kind | what the machine does | examples |
|---|---|---|
| `cut` | all the way through | hardware holes, fringe slits |
| `score` | part depth | fold lines, grooves |
| `mark` | surface only | stitch guides, etched line art |

`cut` shares the outline's colour: both go through, and the distinction
between "the edge" and "a hole" is not the machine's problem.

## Decisions

### Interior paths are shape, not metadata

The dies store already refuses to let the outline be edited after creation —
"a changed shape would invalidate any layout already computed against it". A
hole is shape by the same argument: moving it changes the piece as surely as
moving its edge does. So `interiorPaths` is settable at creation and absent
from `METADATA_FIELDS`.

### Nesting is deliberately unaffected

A piece with a hole still **occupies** its whole outline on the hide — the
hole is waste trapped inside the piece, not hide the nester can reuse. So
area, utilization and placement are all unchanged, and `holeAreaMm2()` exists
only to tell the operator how much leather they are actually getting. This is
why the change is much smaller than it first appears.

### Kerf runs backwards inside a hole

The beam destroys the edge of whatever line it follows. Compensating the
outline means cutting **outside** it, so the piece survives at full size.
Compensating a hole means cutting **inside** it, for the same reason.

Getting that backwards makes every hole a full kerf oversize — and on a
4mm hardware hole with a 0.3mm kerf that is nearly 8%, which is the
difference between a snap fitting and not. `deflatePolygon()` was added for
this; `inflatePolygon()` deliberately ignores a negative distance, because
its callers pass clearances and a negative clearance is a mistake.

A hole too small to survive the beam is **dropped**, not cut at full size. A
0.4mm hole with a 0.6mm kerf is not a hole.

Open paths are never compensated — a slit or a score line just comes out kerf
wide, and there is nothing to preserve the size of.

### One placement transform, not two

`placedPolygon()` carried a comment calling itself "the one place the
placement transform is implemented... so all four stay in lockstep". Interior
paths needed the same transform, so rather than write a second copy it was
generalised to `placedPoints(part, placement, points)` and `placedPolygon`
became a one-line caller.

The subtle part: interior paths must be offset by the **rotated outline's**
bounds, not their own. A hole normalised to its own bounding box lands at the
piece's corner — still inside the piece, which is why a containment-only test
passes against it. That mutation survived the first test written for it.

## Not built

**Import classification.** Given a supplier's file with five paths, deciding
which is the outline, which is a hole and which is a stitch guide. The file
usually does not say, and guessing wrong cuts a stitch line straight through
a piece. The importer still refuses multi-path files. This is a question
about real files and real conventions, not about code, and it is the only
thing standing between this representation and real dies going in.

**A way to create interior paths by hand.** No UI. Components can carry them;
nothing yet puts them there except code.

**Filled artwork.** Raster engraving — shading, textures, photographs — is
driven by an image, not by lines. Everything here is corners and edges. Line
art fits; filled artwork is a separate build.
