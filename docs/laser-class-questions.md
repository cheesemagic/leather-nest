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

## 5. Bed size

The program has no idea how big the machines are.

- Usable bed dimensions on each machine?
- Is there a pass-through for material longer than the bed?

## 6. Getting the material in the right place

The program assumes the leather sits where the drawing says it does.

- Is there a camera, registration pins, or do you eyeball it?
- How do people normally align an irregular offcut?
- Is there a way to jog the head to a corner to check alignment before
  running?

## 7. Settings, roughly

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
- Kerf: **not modelled at all**

Anything measured at the class beats anything simulated here.
