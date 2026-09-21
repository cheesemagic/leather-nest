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

## Import classification — solved, 2026-09-20

A real downloaded card-wallet pattern settled this. Three pieces, each one
`<path>` element holding one outline plus 47-57 identical 1mm rings: the
stitch holes. **Every line in the file is the same colour**, so any rule based
on layers or colour would have failed outright.

The rule is containment, not colour and not size: a ring inside nothing is a
piece, a ring inside a piece is that piece's interior. Size alone would have
worked for a single-piece file and broken on this one, where the second
piece's outline is smaller than the first's.

Element boundaries are deliberately not trusted. One `<path>` per piece is a
convention, not a guarantee, and containment gives the right answer either
way.

What the file still cannot say is whether an interior ring should be **cut**
or only **marked** — a stitch guide that must never be cut is geometrically
identical to a hole that must. That stays the caller's to set.

### Units are the other half, and are not inferable

The same pattern states no physical size at all, only a coordinate box. Read
as millimetres — which is what every component already in the library assumes
— its back panel is 217x278mm, about a sheet of A4. It is actually 76x98mm:
the file is in points. The giveaway was the stitch holes measuring exactly
1.00mm in points, which is a standard size; nobody drills a 2.84mm stitch
hole.

`unitOptions()` reports what the drawing measures under each candidate unit
so the operator can be shown the choice. Guessing was rejected: the same
guess that is right for one file is three times wrong for another, and the
failure is a pattern cut at triple size.

## Not built

**Rebuilding holes from a dashed stroke.** Some patterns draw a row of stitch
holes as ONE line with a dash pattern applied, rather than as real holes.
Every importer — this one and LightBurn's alike — keeps the line and drops
the dashes, and cutting that gives a continuous slit down the piece. Such
files are now refused with an explanation.

They are reconstructible: dash length, gap and stroke width are all in the
file, so the real holes could be generated along the path. That would beat
the manual workaround people currently use (expanding the stroke in a vector
editor), which distorts the circles at each end. Deliberately deferred — no
file we hold needs it, and it should be built against one that does.

**A way to create interior paths by hand.** No UI. Components can carry them;
nothing yet puts them there except code.

**Filled artwork.** Raster engraving — shading, textures, photographs — is
driven by an image, not by lines. Everything here is corners and edges. Line
art fits; filled artwork is a separate build.
