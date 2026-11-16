# First job from this program on the Boss

A checklist for taking an export from leather-nest to the makerspace's Boss
LS-3655 and cutting it. Written before it has been done; correct it after.
Machine facts and the reasoning behind each step are in
`docs/laser-class-questions.md`.

## Before leaving

- [ ] **Pick the scrap and photograph it** on the Hides page with the
      reference object in frame. Check the traced outline against the real
      piece before trusting it.
- [ ] **Nest and export.** Find Best Use → Download cut file. The file is
      in millimetres, cuts in red, hide outline in blue.
- [ ] **Open the SVG in a browser** and look at it. Pieces inside the
      outline, nothing overlapping, holes and slots present.
- [ ] **Copy it to a USB stick.** The makerspace wipes files off the laser
      PC at shutdown, so the stick is the only copy that gets there.
- [ ] **Take the scrap, the stick, a sheet of paper or thin card bigger than
      the scrap, and calipers** if there are any to take.

## At the machine

Follow the house sequence on the wiki (key, air at 40-60 psi, chiller,
LightBurn, exhaust) and then:

1. **Import the SVG.** Check the width LightBurn shows against the width the
   app showed. They must agree; if not, stop.
2. **Layers.** Red → the cut layer. Blue → turn **Output off** for now.
   Set the red layer from the Boss chart, then cooler for thin leather
   (start around 45-50% at 15 mm/s on ~1mm skins; go up only if it does not
   cut through). Going cooler than the chart is within house rules; hotter
   needs staff.
3. **Paper template.** Lay the paper on the bed. Jog the head to where the
   top-right of the layout should land, press ORIGIN, Frame to check the
   extent fits on the paper. Turn blue **Output on** at engrave settings
   (around 15% at 350 mm/s), red **off**, run. The hide's outline is now
   drawn on the paper.
4. **Place the leather** inside the drawn outline, grain side up as it was
   photographed. **Do not touch ORIGIN.**
5. **Autofocus** with the head over the leather (Z/U → Autofocus → Enter).
6. **Blue off, red on.** Frame once more. Lid closed, exhaust on, start.
7. **Watch the first piece.** If it does not cut through, stop and raise
   power one step; if the edge chars heavily or the leather curls, drop it.

## Afterwards

- [ ] Note the settings that worked, on this leather, at this thickness.
- [ ] Measure one piece against its drawn size with calipers, in both
      directions, and write both numbers down with the settings.
- [ ] Say whether the pieces landed where the drawing put them. That is the
      test of the paper template, and decides whether the nester needs an
      edge margin.
- [ ] Put all of it in `docs/laser-class-questions.md` under "Answers so
      far", then fix anything above that turned out wrong.

## What the program does not do

It does not know the machine's settings, bed, or origin; those live in
LightBurn and at the machine. It does not know whether the leather may be
lasered; that is the operator's call. It does not compensate for kerf yet
(set to zero until measured) and does not keep pieces back from the hide's
edge beyond the 1mm laser clearance.
