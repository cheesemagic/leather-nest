# Supplier swatch chart photos

**Empty on purpose.** Put the photographed sample cards here — the physical
printed charts with colour patches and names on them. Thirty-nine of them are
already transcribed into `../leather-swatches.json`, names only; the images
themselves have never been in the repo, because they arrived as chat
attachments and could not be written to disk from there.

## What this unlocks

With the images on disk, a LAB value can be sampled per swatch patch. That
turns 413 colour *names* into 413 measured colour *standards*, which is what
the textile trade's 555 shade-sorting system needs: each hide then gets a
readable three-digit code for its deviation from the nearest standard
("Cognac 343"), and hides sharing a code are a shade group. That is the
grouping rule multi-hide colour pooling wants, and it is legible to anyone in
the trade in a way a similarity ranking is not.

## Naming

Name each file after the `chartName` it shows, lowercased and hyphenated, so
it can be matched back to the catalogue automatically:

```
alligator-glazed-1.jpg
argentine-caiman-belly-matte.jpg
ostrich-leg-suede.jpg
```

`chartName` values are in `../leather-swatches.json`.

## Known problems with sampling these, already recorded

- **No scale reference.** The charts carry nothing of known size, so pixels
  cannot be converted to millimetres. These are useful for colour only, never
  for scale matching — unless the supplier states the physical size of one
  swatch patch, which is one of the open questions for them.
- **Glossy charts have specular blowout** on the saturated colours (Royal
  Blue, Orange, Yellow, Turquoise). Blown pixels have lost chroma, so anything
  sampled from them reads desaturated. Matte and suede charts are much
  cleaner. Sample the glossy ones with suspicion, or reshoot them at an angle
  that kills the highlight.
- **No colour calibration.** Same problem the hide photos have: without a grey
  card or reference target in frame, a sampled LAB carries the photograph's
  white balance inside it. Shooting these WITH a grey card would make them
  substantially more valuable than the originals.

See `docs/superpowers/specs/2026-09-25-colour-difference-ciede2000-design.md`
for how colour is compared, and the `caveats` array in the catalogue JSON for
the full list of transcription problems.
