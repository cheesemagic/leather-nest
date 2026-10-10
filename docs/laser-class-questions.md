# Questions for the laser badge class

Things this project has assumed and nobody has checked. Machines at the
makerspace: an 80W Red Sail and a 150W Boss LS-3655, both driven by
**LightBurn**. Bring this, fill it in.

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

LightBurn imports SVG directly and sorts shapes into layers by colour: the
red cuts land on its red layer, the blue outline on its blue layer. In the
Cuts/Layers panel each layer has an **Output** toggle — switch it off for
blue and the outline is on screen for alignment but never cut.

- Does that Output setting stick when the next file is opened, or does it
  have to be set every time?
- Do they use the tool layers (T1/T2, which never cut) for reference shapes?
  If that is the house convention, I can look at exporting the outline so
  it lands there.
- On the first import, compare the width LightBurn shows against what the
  app says. The file states its size in millimetres, so the DPI setting for
  unitless SVGs should not apply — but one glance confirms it.

## 3. Kerf — how much does the beam eat?

The beam has width. Every piece comes out slightly smaller than drawn, by
roughly half the beam width all the way round. The program can compensate
for this, **but the kerf is set to zero on purpose until someone measures
it** — a guessed number would silently resize every piece. So right now a
50mm strap will cut at something like 49.8mm, and nothing accounts for it.

- What's the typical kerf on leather, at the settings used for it?
- Does it change much between the 80W and the 150W?
- Is it worth cutting a test square and measuring it?

That measurement is the cheapest way to replace a guess with a fact here.

**One decision:** LightBurn has its own per-layer kerf offset (Advanced tab
of the cut settings). If LightBurn compensates and this program also
compensates, every piece comes out a full kerf too big. Recommendation:
measure it, put the number in this program, leave LightBurn's kerf offset at
zero. The program needs the number anyway for nesting gaps and fringe strand
widths, and one place holding it is one place to get it wrong.

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
was just beside. LightBurn's optimiser (Optimization Settings, next to the
Start button — "reduce travel moves" and friends) throws that order away.
Ask whether it is on by default on their machines, and whether anyone
bothers with heat ordering at all. If the optimiser stays on, the file's
ordering means nothing, which is fine as long as we know.

## 7. Bed size

The program has no idea how big the machines are.

- Usable bed dimensions on each machine?
- Is there a pass-through for material longer than the bed?

## 8. Getting the material in the right place

The program assumes the leather sits where the drawing says it does.

- Does either machine have a LightBurn camera calibrated? If so you see the
  offcut on screen and drag the layout onto it — a much better answer than
  the one the program assumes, and worth knowing before building anything
  more around the photographed outline.
- The house workflow (makerspace wiki, below) is **User Origin**: jog the
  head to a point on the material, press ORIGIN on the machine, and the
  job runs from there. Boss's default job origin is the top-right corner.
  So the thing to line up is one corner of the layout's bounding box, not
  the whole outline — which corner does LightBurn have set on their
  machine, and does anyone change it?
- The Frame button traces the layout's bounding box with the red pointer
  before cutting. The wiki tells people to use it. Is that the only check?

## 9. Settings, roughly

- Typical power/speed for leather at 2mm-ish thickness?
- Does it need multiple passes, or one?
- Air assist — always on for leather?
- How badly does it smell, and does that limit how long a job can run?

---

## Answers so far (2026-10-10, class day)

Recorded as they came in. Measured beats quoted beats assumed; each line
says which it is.

**Machines.** Both run LightBurn. Neither has a camera, so alignment is by
eye against the blue outline, with Absolute Coords and the Frame button.
The Boss is an LS-3655 with a 36" x 55" bed, **914 x 1397mm** — confirmed
at the machine. The
generic LS-series manual
(https://makesantafe.org/wp-content/uploads/2018/12/ls-series-user-manual.pdf,
rev 006, 2024) gives no bed size, no spot size and no kerf. It recommends the
2" lens for cutting and engraving.

**House workflow for the Boss** (wiki.makesantafe.org/tools/boss-ls3655-150w-laser):
key on, air compressor on in the metal shop and 40-60 psi at the machine,
chiller on, open LightBurn, place material, jog the head over it,
**autofocus** (Z/U > Autofocus > Enter: the table rises to the nozzle),
jog to the origin point and press ORIGIN, set layer settings from the Boss
cut chart (bookmarked in Chrome), **Frame** to check extents, lid closed,
exhaust on, start. Max cut thickness 1/2". "DO NOT OVER POWER. If settings
are more than 20% out of spec, alert staff" — going cooler than the chart
for thin skins is not over-powering. Files are deleted off the computer at
shutdown, so bring exports on a stick each visit.

What that means for alignment: the program's blue outline is still the
drawing of where the leather is, but the machine registers on **one point**
— the corner of the job's bounding box that LightBurn calls the job
origin, placed wherever the head is parked when ORIGIN is pressed. The
operator lays the leather down, jogs the head to the matching corner of
the real hide's extent, presses ORIGIN, frames, and cuts. Andrew was shown
this at the class and reports it is **an estimate, not precise**. That
matters because the nester keeps only the laser clearance (1mm) between a
part and the hide's edge: a hide placed a few millimetres off where the
file says it is puts edge pieces off the leather. Two answers, in order:

1. **Mark the outline on a sacrificial sheet first.** Lay paper or thin
   card on the bed, turn the blue layer's Output on at engrave power, run
   only that layer, then lay the hide into the drawn outline, turn blue
   off and cut red. Same origin for both runs — do not touch ORIGIN in
   between. Registration then depends on placing leather into a drawn
   line, not on eyeballing a corner. Nothing to build; the export already
   carries the outline as its own layer.
2. **An edge margin in the nester**, sized to the measured placement
   error, if the first answer is not enough. Not built — changes machine
   output, and nobody has measured the error yet.

Andrew's read: origin-plus-frame could be dialled in meticulously but it
would be a pain; a camera is still the right answer and the makerspace
does not have one. The paper template is the method for now. The export
works unchanged under either.

**Materials.** The scrap is mixed: some chrome-tanned, some veg-tanned.
The manual lists leather and suede as laser-safe without distinguishing
tannage, and bans only chlorine-bearing plastics (PVC, vinyl) and
polycarbonate. So the manual does not settle the chrome question either
way — it is makerspace policy, and still worth asking. A tannage field on the
hide record, with the laser export refusing chrome, was proposed and
turned down: the app does not know what is in the laser, the operator
does. Settled in `DECISIONS.md` (2026-10-10).

**Kerf.** Quoted at the class as "the laser is 10 microns so the kerf is
20 microns". **Rejected, not recorded.** 10.6 microns is the wavelength of
CO2 laser light, not the spot size; the lens focuses the beam to a spot of
roughly 0.1-0.3mm, and the channel it burns in leather is a little wider
than that. Boss's own engraving table (below) spaces raster lines 0.065mm
apart, and raster lines are spaced to overlap, so the spot is wider than
0.065mm — already three times the quoted kerf. Still needs a square
measured. Until then `DEFAULT_KERF_MM` stays 0.

**First real cut, 2026-10-10:** a square patch, engraved with a logo and
cut out, on the Boss. Drawn at **2.24" = 56.90mm** square in LightBurn
(Andrew confirms both the file and the machine were set to that). Clean
cut edge, crisp engraving down to fine inner loops, dark char band with a
slight brown heat halo strongest along two edges. **Measurement pending
calipers** — a steel rule in a phone photo resolves about half a
millimetre and the two photos disagreed by that much, which is the size of
the number being looked for. Kerf = 56.90 minus the caliper reading, and
it belongs with the settings that cut it, which are not yet recorded.

**Boss's published leather settings** (bosslaser.com settings sheet, CO2
LS series; the makerspace's 150W machine is closest to the 155W row):

| Job | Tube | Power | Speed | Interval | Thickness |
| --- | --- | --- | --- | --- | --- |
| Cut | 70W | 85% | 10 mm/s | — | 1/8" (3.2mm) |
| Cut | 105W | 75% | 12 mm/s | — | 1/8" |
| Cut | 155W | 70% | 15 mm/s | — | 1/8" |
| Engrave | 70W | 25% | 350 mm/s | 0.065mm | any |
| Engrave | 105W | 18% | 350 mm/s | 0.065mm | any |
| Engrave | 155W | 15% | 350 mm/s | 0.065mm | any |

Those are for 1/8" leather, single pass. Exotic skins are thinner —
python around 1mm, stingray around 1.5mm — so expect to drop power or
raise speed well below the table, and expect the kerf to differ from
whatever a 1/8" test square gives. Measure on the leather that will
actually be cut.

---

## Assumed numbers this class could replace

Every one of these was chosen in conversation. None has touched leather.

- Space between pieces on a laser job: **1.0mm**
- Space around a die-cut piece: **2.5mm**
- How full the program assumes a hide can get: **75%**
- Kerf: **modelled now, but set to 0 until measured**
- Fringe strand width: **5mm, assumed**

Anything measured at the class beats anything simulated here.
