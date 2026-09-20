# Questions for the laser badge class

Things this project has assumed and nobody has checked. Machines at the
makerspace: an 80W Red Sail and a 150W Boss LS-3655. Bring this, fill it in.

Ordered by how much damage a wrong assumption does.

---

## 1. Can you cut the leather you actually have? (safety, answer first)

**Chrome-tanned leather should not be laser cut.** It's tanned with chromium
salts, and cutting it can release chromium compounds and chlorine-bearing
fumes. Most makerspaces ban it outright. Veg-tanned leather is the one that
is normally allowed.

- Does the space allow leather at all, and which kind?
- Is there a materials list or an approval process?
- **What is your own scrap?** If the exotic offcuts are chrome-tanned, the
  entire cutting side of this project needs rethinking — that is worth
  knowing before anything else gets built.

This is the single most load-bearing unknown in the project.

## 2. How does the machine decide what to cut and what to ignore?

The program exports the pieces in red and the hide's outline in blue. The
blue line is there so you can line the offcut up on the bed — **it must not
be cut.** If the software can't be told to ignore it, the laser will trace
around the edge of your leather and off into the bed.

- What software drives each machine?
- Does it take an SVG file directly?
- Can you mark a colour or layer as "don't output"? What's it called there?
- If it can't: I'll change the export so the outline goes in a separate file
  instead. That's a small change — just say the word.

## 3. Kerf — how much does the beam eat?

The beam has width. Every piece comes out slightly smaller than drawn, by
roughly half the beam width all the way round. **This program does not model
that at all.** Right now a 50mm strap will cut at something like 49.8mm, and
nothing accounts for it.

- What's the typical kerf on leather, at the settings used for it?
- Does it change much between the 80W and the 150W?
- Is it worth cutting a test square and measuring it?

That measurement is the cheapest way to replace a guess with a fact here.

## 4. Spacing between pieces

The program currently leaves **1mm** between pieces on a laser job. That
number was chosen in conversation, not measured.

- How close can two cuts be before the leather between them scorches,
  curls, or tears?
- Does thicker leather need more room?

## 5. Fringe — how thin can strands go before they fail?

The program can now generate fringe: a strip with many parallel slits cut in
from one edge, stopping short so the piece stays in one part. Nobody has cut
any, and three things about it are guesses.

- How narrow can a leather strand be before it tears or curls? The program
  defaults to 5mm because that seemed reasonable, not because anyone knows.
- Lots of parallel cuts packed close together puts a lot of heat into a small
  area, and a thin strand has nowhere to dump it. Does it scorch? Curl? Does
  it need slower passes with gaps between, or more spacing than the design
  suggests?
- How wide does the solid band at the top need to be so the strands don't
  tear away from it in use?

A fringed test strip is a good first cut — simple geometry, quick, and it
answers all three at once.

## 6. Multi-pass cutting and heat

Leather chars and curls at the cut edge when too much heat goes in at once.
The usual answer is several faster, lower-power passes instead of one slow
hot one — but that is a machine setting, not something a file can carry, so
it has to be set at the laser.

- Do they cut leather in multiple passes? How many, at what power and speed?
- Does the edge still char? Is there a trick to it — masking tape, air assist
  turned up, a particular focus?
- **Measure kerf at whatever settings you end up using, passes included.**
  More passes at lower power usually cut narrower, so a kerf measured any
  other way will not match what the program is told.

The file now cuts pieces in a spread-out order rather than working across the
sheet neighbour by neighbour, so the beam is rarely returning to leather it
was just beside. Worth asking whether that is a thing people actually bother
with, or whether the machine's own path optimiser overrides file order anyway
— if it does, this needs to be switched off for the ordering to mean
anything.

## 7. Bed size

The program has no idea how big the machines are.

- Usable bed dimensions on each machine?
- Is there a pass-through for material longer than the bed?

## 8. Getting the material in the right place

The program assumes the leather sits where the drawing says it does.

- Is there a camera, registration pins, or do you eyeball it?
- How do people normally align an irregular offcut?
- Is there a way to jog the head to a corner to check alignment before
  running?

## 9. Settings, roughly

- Typical power/speed for leather at 2mm-ish thickness?
- Does it need multiple passes, or one?
- Air assist — always on for leather?
- How badly does it smell, and does that limit how long a job can run?

---

## Assumed numbers this class could replace

Every one of these was chosen in conversation. None has touched leather.

- Space between pieces on a laser job: **1.0mm**
- Space around a die-cut piece: **2.5mm**
- How full the program assumes a hide can get: **75%**
- Kerf: **modelled now, but set to 0 until measured**
- Fringe strand width: **5mm, assumed**

Anything measured at the class beats anything simulated here.
