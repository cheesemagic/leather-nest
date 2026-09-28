# Magna visit — brief, questions, and what to bring back

For T. Written 2026-09-27.

---

## If you only do one thing

**Photograph two skins they say ARE a match, and two they say are NOT — with a
tape measure and a grey card in the frame, all four shot in the same spot under
the same light.**

That one act unblocks the biggest stuck piece of this project. Everything else
here is worth having; that is worth the trip.

---

## The brief

### What this is

We are building a program that helps get the most out of exotic leather. It
does two jobs:

1. **Nesting** — given a hide and a set of pattern pieces, work out how to lay
   the pieces out so the least leather is wasted, and produce a file a laser
   can cut.
2. **Matching** — given a library of hides, work out which two could be used as
   a matched pair, so a finished pair of sneakers doesn't have one shoe
   visibly different from the other.

The matching half is what this visit is about.

### Why we need Magna

**Because the people at Magna already do this, by hand, every day — and we have
been guessing at how.**

The program currently decides two hides match by measuring two things from a
photograph: how big the scales are, and what colour the leather is. Both of
those were our idea of what matters. Nobody has checked them against someone
who does this for a living.

There are specific guesses baked in that could be wrong:

- We assume **scale size** is worth measuring precisely. We searched the
  industry and the academic literature and found nobody else doing it — the
  trade matches on shade, on cut, and on pattern by eye. That might mean we
  have found something genuinely new. It might mean it is irrelevant. We cannot
  tell from here.
- We assume that **if two hides match, every piece cut from one matches every
  piece cut from the other.** That may be nonsense — a hide varies across its
  own surface.
- We have **no idea where "close enough" stops.** The program can rank two
  hides as closer or further apart, but it cannot say "these two are a match
  and those two are not," because nobody has ever shown it an example of each.

### How you can help

Three kinds of thing, in order of value:

1. **Photographs** of skins they have judged — matched and rejected. This is
   data we cannot generate ourselves at any price.
2. **Answers** to the questions below, in their own words.
3. **Files** they may already have and be willing to share.

**A note on tone:** we are not auditing them, and we are not asking them to
change or adopt anything. We are asking how they work, because they know
something we do not. If a question feels like prying into how they run their
business, skip it — the photographs matter far more than the answers.

---

## Kit to bring

- [ ] A tape measure or steel rule — essential, see the photo rules
- [ ] A **grey card**. This is the one piece of kit worth buying.
      **Get this one** — DGK Color Tools 18% Gray Card, **8x10 inch**, ~$10:
      <https://www.amazon.com/DGK-Color-Tools-inch-Digital/dp/B00HP8JSU8>
      **Size is the point: 8x10, not the credit-card size.** In a frame wide
      enough to hold a whole skin, a small card is too few pixels to average a
      colour from once edge blur has eaten most of it.
      *Optional, and not needed for this trip:* the DGK DKC-Pro adds 18 colour
      patches for ~$17 (<https://www.amazon.com/DGK-Color-Tools-DKC-Pro-Calibration/dp/B00DMA06AY>).
      Useful later for photographing the supplier's swatch charts, where we
      need absolute colour rather than a comparison — but it is only 5x7, so it
      does not replace the 8x10.
      **In El Paso today:** try Jerry Reed's Photo & Video, 921 Myrtle Ave,
      (915) 532-2462 — call first, they may not stock cards. Otherwise Amazon
      next-day. If neither works, see "If you could not get a grey card" below.
- [ ] Your phone, with plenty of storage free
- [ ] This document
- [ ] Calipers, if you can lay hands on a pair
- [ ] Something to write on

---

## Part 1 — Questions for the workers and cobblers

Ask whoever actually picks the hides. If you can, ask more than one person: two
people disagreeing about what matters would itself be a valuable finding.

### The core seven

1. **When you pick two hides as a match, what exactly are you looking for?**
   Open it up and let them talk before narrowing it down. What they mention
   *first* and *unprompted* is the most useful part of the answer.

*Answer:*
```





```

2. **Are you measuring the scales — ruler, compass, calipers — or judging by
   eye?**
   *Why this matters most:* the program's entire scale-measuring pipeline
   exists on the assumption this is a real, precise judgement. If it is pure
   eye, that does not automatically make the measurement useless, but it
   changes what we can claim for it.

*Answer:*
```





```

3. **If two hides match, is it safe to assume every piece cut from one will
   match every piece cut from the other?**
   Or does it depend where on the hide a piece comes from? *Why:* we are about
   to build a feature that assumes some pieces must come off the same hide and
   others need not. This question decides whether that idea is real.

*Answer:*
```





```

4. **What is the first thing you look at that rules a skin OUT?**
   *Why:* the program can currently rule a pair out on species, cut and finish
   only. If their first disqualifier is a scar, a grade, or something we have
   never modelled, we are missing the most important check.

*Answer:*
```





```

5. **How big an area needs to match?**
   A patch? A whole panel? The area a particular piece gets cut from? *Why:* we
   measure one small patch that the operator drags a box around. If a match has
   to hold across a whole panel, that is the wrong shape of measurement.

*Answer:*
```





```

6. **If two skins match, can you make several pairs of sneakers from them, or
   just one?**
   *Why:* it changes what a match is worth, and what the program should report.

*Answer:*
```





```

7. **Anything else about how you pick — including the parts that are hard to
   put into words.**

*Answer:*
```





```

### Worth asking if the conversation allows

8. **How do you describe a colour to each other?** By the supplier's name off
   the chart ("Cognac"), by eye, or by holding it against something?

*Answer:*
```




```

9. **Do you use grades?** The trade grades exotic skins 1–4 (alligator 1–5) on
   defect count. Does grade come into matching, or only into buying?

*Answer:*
```




```

10. **Have you heard the term "shade sorting"?** It is the garment industry's
    name for grouping dyed material so panels cut from different lots do not
    show a difference. If they use it, they have vocabulary we should adopt.

*Answer:*
```




```

11. **Is it true that a pair of alligator skins makes two pairs of boots — one
    from the matching tails, one from the matching bellies?** We read this and
    built a rule on it. Worth hearing it confirmed or corrected by someone who
    actually does it.

*Answer:*
```




```

12. **Under what light do you judge colour?** Daylight, a particular lamp, a
    light box? *Why:* it tells us how far our photographs can be trusted.

*Answer:*
```




```

13. **How long does picking a match usually take?** *Why:* if it is quick and
    easy for them, the program may be solving a problem they do not have, and
    we should learn that early rather than late.

*Answer:*
```




```

---

## Part 2 — Things to do while you are there

Doing beats asking. People are far better at showing their process than
describing it.

- [ ] **Watch someone pick a match, start to finish, without interrupting.**
      Note what they pick up first, what they hold against what, whether they
      move to a window or a lamp, and how long it takes. Ask your questions
      afterwards.

*Notes:*
```




```

- [ ] **Ask what they just rejected, and why.** Rejections tell us more than
      acceptances — a threshold needs both sides of the line.

*Notes:*
```




```

- [ ] **Measure a swatch patch on the supplier's sample card.** Just the
      physical size of one printed colour square, in millimetres. *Why:* we
      have transcribed 413 colour names off those charts, and that single
      number would let us measure a real colour value for every one of them.
      One measurement, enormous payoff.

*Notes:*
```




```

- [ ] **Measure some actual scales with calipers**, on a skin they have called
      a good match. Note the species, the cut, and roughly where on the skin.
      This is how we find out whether our photo measurement agrees with
      reality.

*Notes:*
```




```

- [ ] **Note the lighting** wherever they judge colour, and photograph it if
      that is not awkward.

*Notes:*
```




```

- [ ] **Find out who decides.** One person? A consensus? Do disagreements
      happen?

*Notes:*
```




```

- [ ] **Ask whether they would look at results later.** If we could send ten
      ranked pairs and ask "would you have picked these?", that is a validation
      we cannot get any other way.

*Notes:*
```




```

---

## Part 3 — Digital files to ask for

Ask for what is easy. Anything that looks like it touches their intellectual
property, do not push — note that it exists and we will ask properly later.

- [ ] **The supplier's swatch chart images**, as high-resolution files rather
      than photographs of a screen. *Why:* we have the colour names transcribed
      but not the images, so we cannot measure a single actual colour. With
      them, 413 colour names become 413 measured standards.

*Got it? / who to chase:*
```


```

- [ ] **Any grading or quality standard they work to** — a chart, a spec sheet,
      a supplier document. *Why:* grade is the thing most likely to be missing
      from our matching rules.

*Got it? / who to chase:*
```


```

- [ ] **Any existing photographs of hides** they already keep.

*Got it? / who to chase:*
```


```

- [ ] **Colour references** — Pantone numbers, LAB values, a spectrophotometer
      readout, anything numeric. *Why:* it would let us check our colour
      measurement against a real instrument rather than trusting a phone
      camera.

*Got it? / who to chase:*
```


```

- [ ] **Pattern files for a sneaker** (DXF, SVG, AI or similar) — *ask
      carefully, and only if it comes up naturally.* This is their IP. If it is
      awkward at all, drop it; we can test with our own shapes.

*Got it? / who to chase:*
```


```

- [ ] **Do they shoot their own photographs of skins?** If so, how, and could
      we see an example? *Why:* if they already have a photo process, ours
      should match it rather than compete with it.

*Got it? / who to chase:*
```


```

---

## Part 4 — The photo checklist

The most valuable thing you can bring back. Read the rules first — they matter
more than the quantity.

### The rules — every photo, no exceptions

1. **A tape measure or rule flat in the frame, beside the skin.** Without it a
   photograph has no scale and we cannot convert anything to millimetres. This
   is the one rule that makes a photo useless if broken.
2. **A grey card in the frame**, ideally in a corner, flat, in the same light
   as the skin. This is what lets us correct the colour. Without it, every
   colour we measure has that room's lighting baked into it.
3. **Straight down, flat.** Phone directly above, skin flat on a surface. Shot
   at an angle, the scale changes across the frame and the measurement is
   wrong.
4. **Even light, and no glare.** Glossy skins are the problem — a bright
   highlight loses all colour information where it lands. If you see a hot
   white patch in the preview, move the light or the skin.
5. **Both skins of a pair shot in the same place, same light, same session.**
   Shot under different conditions, we cannot tell a real colour difference
   from a lighting difference — which is exactly the mistake we are trying to
   stop the program making.
6. **Grain side up** — the outside, the scales — unless it is suede.

### If you could not get a grey card

Matching compares two hides **against each other**, not against an absolute
standard. So a reference that is imperfect but **identical in every photo**
still does most of the job: it removes the lighting difference between one
shot and the next, which is the error we are actually fighting.

**A consistent imperfect reference beats a perfect one used only sometimes.**

In order of preference:

1. **Grey mat board or foam board** from an art or craft shop. Reasonably
   neutral, large, rigid, and available today.
2. **A neutral grey paint chip** from a hardware store. Free, small,
   imperfect, usable.
3. **Plain white printer paper — last resort.** Most office paper carries
   optical brighteners that fluoresce blue under daylight and many LEDs, so it
   reads bluer than neutral and pushes every correction the same wrong way.

The rule for any substitute: **one object, in every photo, never swapped
mid-session.** Photograph it once on its own as well, so we know exactly what
we are correcting against.

### What to shoot

For each skin, three shots:

- [ ] **The whole skin**, flat, everything in frame, with rule and grey card
- [ ] **A close-up of a clean patch of scales** — sharp, in focus, scales
      filling most of the frame, rule still in shot. The scale measurement is
      made from this, so focus matters more here than anywhere else.
- [ ] **A close-up of the area they would actually cut the visible pieces
      from** — whichever part of the skin the important panels come off

### The sets that matter

In order of value:

- [ ] **A confirmed MATCH.** Two skins they say go together, both shot
      properly. Note what product they would be used for.

*Which skins, and what they said:*
```




```

- [ ] **A confirmed REJECTION.** Two skins they say do NOT go together — and
      ask *why*, and write down the answer.

*Which skins, and what they said:*
```




```

- [ ] **A genuine close call.** Two skins where they had to think about it, or
      where two people might disagree. The single most informative thing
      possible: it is the actual borderline we are trying to find.

*Which skins, and what they said:*
```




```

- [ ] **More of the above.** Three or four matched pairs and three or four
      rejected pairs would be a strong data set. Ten of each would be
      exceptional.

*Which skins, and what they said:*
```




```

### Variations worth covering, if the skins are there

Not essential, but each tests something different:

- [ ] **Different species** — caiman, alligator, python, ostrich, stingray
- [ ] **Different cuts** — belly, tail, hornback, leg, full quill. *Why:* the
      program refuses to pair a tail with a belly. If that is wrong, we want to
      know.
- [ ] **Different finishes** — glossy, matte, suede. *Why:* same reason. The
      program refuses to pair a suede with a glossy.
- [ ] **A glossy skin specifically**, shot carefully to avoid glare. Glossy is
      where our colour measurement is weakest, and a good example would help.
- [ ] **A skin with a visible scar or defect**, if they will allow it. *Why:*
      defects are not modelled at all yet, and may matter more in matching than
      anything we currently measure.

---

## What happens with all this

So you know it is not going into a drawer:

| What you bring back | What it unlocks |
|---|---|
| Matched and rejected pairs, photographed | Sets the line between "same colour" and "different colour" — the biggest blocked item in the project |
| The close call | Tells us where the boundary actually sits, which the clear cases cannot |
| Swatch patch size (one number) | Turns 413 transcribed colour names into 413 measured colour standards |
| Caliper measurements of real scales | Tells us whether our photo measurement matches physical reality |
| Answer to "ruler or eye?" | Tells us whether the most novel part of the program solves a real problem |
| Answer to "does every piece match?" | Decides the design of a feature we are about to build |
| Answer to "what rules a skin out?" | Likely adds a check the program is currently missing |
| Grey-card photos of any kind | Makes every colour number we produce trustworthy rather than merely precise |

---

## One last thing

If the visit is short and you have to choose: **photographs of a match and a
rejection, shot to the rules above, beat every answer in this document.**

Words about a process can be re-asked over a phone. Two skins side by side
under one light, with a rule and a grey card in the frame, cannot.
