# SAM in the browser — spike findings

**Status:** experiment reported. Nothing built, no dependency added.
**Date:** 2026-11-23
**Harness:** throwaway, lives in the session scratchpad, not in this repo —
`sam-spike/{index.html,grid.html,compare.py,compare2.py,serve.mjs}`.
**Predecessor:** none. First spike run against `scripts/digitize.py`.

## The question

Should the outline tracer be replaced by SAM (Segment Anything) running in the
browser? Two sub-questions, kept apart because they have different answers:

1. **Quality** — does SAM trace a real leather photograph better than
   `digitize.py` does?
2. **Feasibility** — does it run in a browser, at what download size and what
   speed?

## What was measured, against what

**The photographs.** Twelve of the seventy in `~/Desktop/leather_photos` — the
ones showing hides, skins and dies on a bench rather than swatch charts. They
were shot for a supplier catalogue, **not for the digitizer**: skins lie side
by side, tape measures are in frame, bench is visible throughout, and in one
case (35) the hide fills the frame with no edge showing at all. Harsher than
the app's own photography instructions ask for, and a fair picture of what a
casually-taken operator photograph looks like.

**The score.** `roughness` = traced perimeter / convex-hull perimeter, taken
straight from `digitize.py`, where real offcuts measured 1.00-1.31 and the one
genuine glare failure scored 4.76.

Roughness turned out not to be the interesting number, which is finding 1.
Correctness was adjudicated by looking at every rendered overlay, because no
ground-truth outlines exist for these photographs. Say that plainly rather
than letting the number stand in for the judgement.

---

## Finding 1 — the roughness gate cannot see the failure that matters

`MAX_ROUGHNESS = 3.0` rejects an outline that is *shredded*. It does not
reject an outline that is *clean and around the wrong object*.

Run blind over the twelve photographs, the current tracer returned success on
**12 of 12** — and on inspection was tracing bench, tray, shadow edge, or a
strip across the top of the frame on essentially all of them. Scores on those
wrong outlines ran **1.06 to 2.65**, nearly all under the 3.0 limit.

The sharpest case is photograph 34, two crocodile skins side by side on a grey
bench:

| | outline | roughness |
|---|---|---|
| current tracer | a narrow strip of bench down the left edge | **1.20** |
| SAM, one click | the entire right-hand skin, head to tail | **1.20** |

**Identical scores. One is the hide; one is useless.** Roughness measures
whether an outline is tidy, never whether it is the right thing, and these two
are equally tidy.

The comment on that constant already concedes it is "calibrated on one
failure". It has now seen twelve, and the gate is confirmed blind to the
wrong-object failure mode — which is the most dangerous output this program
can produce, because nothing downstream questions it. It nests, it exports, it
cuts.

**This finding is about the incumbent and stands whatever is decided about
SAM.**

---

## Finding 2 — the pixel frames disagree by 90 degrees (EXIF)

Found while building the harness, reproduced on the original untouched phone
photographs, and **deliberately not fixed** — it touches working code.

- `region-select-ui.js` and `calibration-ui.js` compute coordinates from
  `img.naturalWidth/naturalHeight`. A browser applies the EXIF orientation tag
  to an `<img>`, so those are *upright* coordinates.
- `server.js` passes `roiX/roiY/roiWidth/roiHeight` straight through to the
  script untouched.
- `digitize.py` reads with `cv2.IMREAD_IGNORE_ORIENTATION`, which **ignores**
  the EXIF tag and returns raw sensor pixels.

On a portrait phone photograph those two frames are transposed. Measured on
the originals:

| photo | browser frame | `digitize.py` frame |
|---|---|---|
| IMG_7428 | 4032 x 3024 | 3024 x 4032 |
| IMG_7432 | 5712 x 4284 | 4284 x 5712 |
| IMG_7430 | 3024 x 4032 | 3024 x 4032 (no tag — agrees) |

The comment above that flag says it "applies the file's EXIF orientation tag
… instead of the default of returning raw sensor pixels". That is backwards.
OpenCV documents `IMREAD_IGNORE_ORIENTATION` as *"do not rotate the image
according to EXIF's orientation flag"*, and the table above confirms the
documented behaviour.

Two explanations fit and this spike cannot separate them:

1. The verification behind that comment was done on photographs carrying no
   orientation tag. Two of the twelve here are exactly that, and they agree.
2. The behaviour changed underneath the project. `requirements.txt` pins
   `opencv-python-headless==5.0.0.93`; the flag may have behaved differently
   on the OpenCV 4 line this was written against.

**What an operator would see.** Selecting a region on a portrait photograph can
fail with *"Selected region falls outside the photo bounds"* — that is the
exact error this harness hit nine times out of twelve before the frames were
reconciled. When it does not fail outright, the region crops the wrong part of
the picture and the outline comes out rotated a quarter turn.

**What survives.** The millimetre scale. The distance between two calibration
points does not change when the frame is rotated, so `scale_mm_per_px` is
unaffected, and the outline is normalized to its own bounding box so its
position is unaffected. This mislocates and misorients; it does not silently
resize anything.

**Confidence.** Reproduced at the script level and by reading the full code
path. **Not** yet driven through the app's own upload form.

---

## Finding 3 — Intel Macs cannot run the Node path at all

`onnxruntime-node@1.30.0`, which `@huggingface/transformers@4.3.2` pins
exactly, ships `darwin/arm64` binaries and **no `darwin/x64`**. This Mac is
Intel, so a server-side SAM is simply unavailable here without pinning an
older runtime and fighting that exact-version pin.

This does not touch the browser route, which runs on WebAssembly and is
indifferent to the host architecture. If anything it argues *for* the browser
and against a Python/Node service.

---

## Finding 4 — feasibility: yes, with a real caveat about speed

Model `Xenova/slimsam-77-uniform`, WASM backend, Chrome, Intel Mac.

| | |
|---|---|
| download, fp32 — what was run | **39.9 MB** (23.3 encoder + 16.6 decoder) |
| download, fp16 | 20.8 MB |
| download, int8 quantized | **13.8 MB** — **not tested here** |
| model ready, warm cache | **2.4 - 3.3 s** |
| one click, one mask | **6.0 - 7.8 s** |
| nine grid points, one pass | **8.6 - 21.6 s** |

The nine-point figure is the cheap one and worth understanding, because it
shapes any design built on this. SAM splits into a heavy image encoder and a
light mask decoder. Nine prompts sent as nine *point batches* in one call run
the encoder **once**, so nine answers cost roughly twice one answer, not nine
times.

**Six seconds per click is too slow to feel like a tool**, on this machine,
on this backend. Three things would each move it and none were tested: the
int8 model, WebGPU instead of WASM, and a machine with Apple Silicon.

The "zero new server dependency" claim holds. The page loaded the model and
ran entirely in the tab; nothing was installed into this repo, and
`package.json` still has its two packages.

---

## Round 1 — blind: centre-point prompt, no region

Neither tool got the hint it is designed for. This measures the bad case.

- Current tracer: **0 of 12** correct, **12 of 12** reported success.
- SAM: **3 of 12** correct (34, 36, 37) — and on those three, excellent,
  following ragged leg edges a human would struggle to trace by hand.

SAM's nine failures share one cause: the centre of the frame landed on bench,
tray, or a tape measure, and SAM faithfully segmented the bench, tray, or tape
measure. On 41 it returned a long thin mask that is, correctly, the tape
measure. **SAM's wrongness is obedience.** The current tracer's wrongness is
a thresholding accident, which is far harder to steer.

One photograph (35) is unusable by any method: the hide fills the frame, so no
edge exists to trace. That is a photography problem, not an algorithm problem,
and it belongs in the capture instructions.

---

## Round 2 — assisted: each tool given the hint it was designed for

Round 1 is not a fair test of the incumbent, because `digitize.py` is built to
be given a region and was given none. Round 2 fixes that, generously:

- **SAM** gets a 3x3 grid of prompt points over the inner 80% of the frame and
  keeps the best-scoring mask whose size is plausible for a hide (4% - 72% of
  the frame). No human input at all.
- **The current tracer** gets a region: the bounding box of SAM's chosen mask,
  expanded 14% on each side so bench is visible inside it. **This hands the
  tracer the right part of the photograph for free** — a better region than an
  operator would reliably draw.

With a region, the tracer stops refusing and returns success on 12 of 12. It
does not start being right.

| photo | subject | tracer + region | SAM grid | usable outline |
|---|---|---|---|---|
| 34 | brown croc skin | 2.10, ragged, cuts across the body | **1.19, whole skin** | SAM |
| 36 | black croc tail | 1.52, a narrow sliver | **1.21, clean** | SAM |
| 37 | brown croc skin | 2.17, ragged mess through the middle | **1.23, clean** | SAM |
| 38 | python skin | 1.55, wanders on and off the skin | **1.04, clean scalloped edge** | SAM |
| 41 | dark caiman piece | 2.19, ragged | **1.11, clean** | SAM |
| 30, 31 | dies in a white tray | traced the bin and one die | traced the **tray** | neither |
| 35 | hide fills the frame | ragged | fragmented, 60 blobs | neither — no edge in shot |
| 39 | python skin | 1.46 | 1.83, fragmented | neither |

**The region was not the missing piece.** Given the correct part of the
photograph, the current tracer still produces outlines that wander on and off
the subject, because Otsu thresholding has no notion of *object* — only of
light and dark, and a scaled hide in raking light is both.

Automatic grid prompting works **without any operator input** on 5 of 12, and
its failures are honest ones: on 30 and 31 it segments the tray, which is
genuinely the largest coherent object in the picture; on 35 there is no edge
to find. A single correct click fixes the tray cases, which is the UX the app
already has for region-select.

---

## The gap in this spike's evidence — read this before acting on it

**Not one of the twelve photographs was taken the way the app asks for.**

`digitize.py` already tells an operator what it needs: *"Photograph the rough
side up, on coloured card, in even indirect light."* Every photograph here
breaks that — two skins to a frame, bare bench, tape measures laid across the
subject, raking light, and in one case no visible edge at all. They were shot
for a supplier catalogue months before this spike existed.

So this spike proves the tracer fails on **casual** photographs. It does not
prove the tracer fails on **its own instructions**, because that case was
never tested. The cheapest possible experiment — one hide, on contrasting
card, in flat light, through the existing page — has not been run, and it
could make the entire question moot.

`AGENTS.md` says to prefer a cheap physical test over another simulation.
That applies here and was not honoured on the first pass.

## Recommendation

**Run that photograph first.** If the current tracer handles a properly-shot
hide, the right answer is better capture guidance, not a segmentation model,
and this whole document becomes a note about why the quality gate needs
tightening (finding 1, which stands either way).

**If it still fails — or if "on contrasting card in flat light" turns out to
be unrealistic for a five-foot crocodile skin on a makerspace bench — then:**

**Adopt SAM for outline capture, in the browser, behind an operator click.
Keep `digitize.py`.**

Reasoning, in the order that decided it:

1. **The incumbent fails on real photographs and says it succeeded.** That is
   worse than failing loudly, and it is not a tuning problem — see finding 1.
2. **SAM is better where it matters.** On the five unambiguous hide and skin
   photographs it produced outlines a person would accept, including ragged
   leg and scallop edges that would be tedious to trace by hand.
3. **The browser route costs this repo nothing at runtime.** No new npm
   dependency, no Python service, no change to `package.json`. The model is
   fetched by the page and cached by the browser. This matters because
   `AGENTS.md` says *"no new dependency for what a few lines can do — the
   whole runtime is two packages, keep it that way."* The rule is about the
   runtime, and the runtime stays at two packages.
4. **It must be a click, not a guess.** Grid prompting is a fallback, not the
   interaction. SAM is obedient; point it at the hide and it traces the hide.

Against, and stated plainly:

- **Six seconds a click is not good enough.** Measure the int8 model and
  WebGPU before building anything on this. If it stays at six seconds on the
  machines this runs on, the feature is a chore rather than a help.
- **~40 MB on first use** (13.8 MB if int8 holds up), once per browser.
- **This is a 500x increase in the size of the thing doing the tracing.** The
  honest framing is that it is a model file, not code to maintain — but it is
  still a large opaque artifact in a repo that has deliberately stayed small.

**Keep `digitize.py`.** It still samples colour from inside the outline, which
feeds matching, and it is the fallback when the model will not load. The
sensible shape is: SAM produces the mask, and the existing pipeline —
`approxPolyDP`, the millimetre scale, the colour sample — consumes it
unchanged. That is a seam, not a rewrite.

## What must happen before any of this is built

1. **Fix the EXIF frame mismatch first (finding 2).** A browser-side mask is
   in the browser's frame. Shipping SAM on top of a pipeline that disagrees
   with the browser by 90 degrees would bury the bug deeper, not fix it.
2. **Measure int8 and WebGPU.** One afternoon. It decides whether this is a
   tool or a chore.
3. **Then, and only then, spec the integration.**

## Non-goals of this spike

- Defect detection. Different problem, different model, not touched here.
- Replacing the colour sample or the matching signature.
- Anything about dies specifically — the two die photographs here (30, 31)
  defeated both methods, and a die is a thin metal rim rather than a filled
  shape, which is a genuinely harder target. Unstudied.
