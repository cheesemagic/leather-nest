# Test plan

**605 tests across 52 files, all passing, ~27s.** `npm test` — `node --test`,
Node's own runner. No framework, no coverage tool, and no coverage target:
the aim is that the invariants below hold, not that a percentage goes up.

```bash
npm test                              # everything
node --test test/nesting.test.js      # one file
```

## Invariants

What must stay true. Each is listed with the test that would catch it breaking,
or marked as not covered.

### Geometry and units — the highest-consequence category

A unit error is invisible in a passing test and ruins a hide.

| Invariant | Covered by |
|---|---|
| A stated unit converts correctly on import (mm, in, pt, pc, px, cm) | `svg-units.test.js` |
| A file with no stated unit is not silently scaled | `svg-units.test.js` |
| A viewBox larger than the declared size scales down — the 10x hazard | `svg-units.test.js` |
| `preserveAspectRatio="none"` is refused rather than silently distorting | `svg-units.test.js` |
| A malformed or zero viewBox falls back rather than producing NaN | `svg-units.test.js` |
| mm↔in round-trips: an inch drawing and its mm equivalent import identically | `svg-units.test.js` |
| A shape exported for the laser and re-imported is the same size | `svg-units.test.js` |
| Calibration from a reference object gives the right scale on known fixtures | `digitize.test.js` — real grid fixtures at 10/20/80px |
| Calibration refuses degenerate or non-numeric reference points | `digitize.test.js`, `skin-signature.test.js` |
| Invalid geometry is refused: <3 points, non-finite, zero area, self-crossing, absurd size | `validate-polygon.test.js` — 16 cases |
| Refusal happens at every boundary a shape can enter through | `geometry-boundary.test.js` |
| Concave outlines are *accepted* — concave is normal, not an error | `validate-polygon.test.js` |

### Nesting and fit — what decides whether material is wasted

| Invariant | Covered by |
|---|---|
| A placed part is inside the hide's **real outline**, not just its bounding box | `nesting.test.js` — asserts `polygonContains` per placement |
| A part that fits the bounding box but not the outline is reported `noFit` | `nesting.test.js` |
| Placed parts never overlap, checked pairwise by real intersection area | `nesting.test.js` |
| A part straddling a notch is refused even with exactly collinear edges | `nesting.test.js` — named regression |
| Clearance is **not shared**: 8mm beside 2mm leaves 10mm | `nesting.test.js` |
| Clearance holds a part off the sheet edge | `nesting.test.js` |
| Infinity or absurd clearance degrades cleanly instead of crashing clipper | `nesting.test.js` |
| A non-positive or non-finite grid step falls back instead of hanging | `nesting.test.js` |
| NFP is exact for concave parts — no convex-only assumption creeps back | `nfp.test.js` |
| **The same hide and parts nest identically every time** | `nesting.test.js` |
| Nesting does not depend on the caller reusing the same part objects | `nesting.test.js` |
| A product's must-match components stay on one hide | `bestuse-product-across.test.js`, `multi-bin.test.js` |
| Interior cuts run before the outline that frees the piece | `cut-order.test.js` |
| A hole's kerf runs inward; an outline's runs outward | `kerf.test.js` |

### Matching

| Invariant | Covered by |
|---|---|
| Different known cuts never pair | `cuts.test.js`, `similarity.test.js` |
| Different finishes never pair | `finishes.test.js`, `similarity.test.js` |
| `semi-gloss` stays gone from the vocabulary | `finishes.test.js` |
| An unknown cut still pairs but is flagged and sorts last | `similarity.test.js` |
| CIEDE2000 matches the Sharma reference data | `ciede2000.test.js` — published test vectors |
| `colourL` never influences the result at weight 0 | `ciede2000.test.js`, `similarity.test.js` |
| A hide with no scale signature never appears in matches | `skins-route.test.js` |

### Records and the HTTP boundary

| Invariant | Covered by |
|---|---|
| A failed capture leaves no hide record and no photo | `skins-route.test.js` |
| A capture refused for a missing field leaves nothing behind | `skins-route.test.js` |
| A failed redigitize leaves the original hide byte-identical | `skins-route.test.js` |
| A multi-piece pattern import is all-or-nothing | `geometry-boundary.test.js` |
| Only `public/`, `src/` and `node_modules/` are web-reachable | `static-route.test.js` — 8 named private paths |
| A permitted root cannot be used to climb into a private one | `static-route.test.js` — 7 traversals sent over a **raw socket**, because `fetch` resolves `..` client-side and would test nothing |
| A stored record's extension never decides a photo's `Content-Type` | `upload-boundary.test.js` |
| A self-crossing hole never reaches the cut file | `geometry-boundary.test.js` |
| A real 0.5mm² stitch hole is still accepted | `geometry-boundary.test.js` |
| **No test writes to `data/`** | Structural: `test/helpers/with-server.js` isolates every store unconditionally |
| The real pages and their modules still load | `static-route.test.js` |
| A stored photo's extension is never client-controlled | `upload-boundary.test.js` — 9 disguised names |
| A disguised upload never lands on disk under an executable name | `upload-boundary.test.js` — checks the real filename |
| Cross-origin writes are refused; same-origin and no-origin allowed | `upload-boundary.test.js` |
| A cross-origin DELETE leaves the record in place | `upload-boundary.test.js` |
| Unreadable photo-script output is a 422, not a crashed server | `python-timeout.test.js` |
| A script's own error message survives rather than being replaced | `python-timeout.test.js` |
| Every Python call times out rather than hanging forever | `python-timeout.test.js` — against the real interpreter |
| Only operator-typed fields are editable; measurements are not hand-editable | `skins-store.test.js`, `parts-store.test.js` |
| Re-photographing resets remaining area; measuring for matching does not | `skins-store.test.js` |
| Utilization is stored unclamped, so over-commitment stays visible | `skins-store.test.js` |

## Known gaps

Listed because they are real, not as a backlog. Ranked by what a failure would
cost.

1. **No physical validation of anything.** Every clearance, the packing
   efficiency, and the kerf model are assumptions chosen in conversation.
   Nothing in this suite can tell you whether a cut piece comes out the right
   size, because no piece has been cut. **This is the largest gap in the project
   and no amount of testing closes it** — it needs one real job on a real
   machine.
2. **No test that a hide record survives a schema change.** Records are not
   versioned and older ones simply lack newer fields. Reading is defensive by
   convention, not by test. A field added tomorrow could break on records
   written today, and nothing would catch it.
3. **Browser UI is untested by convention.** All of `src/*-app.js` — the
   calibration click-through, region select, every page's wiring. Deliberate
   (see AGENTS.md), but it means a page can be broken with a green suite.
4. **Placement quality is untested, only placement legality.** Tests prove parts
   land inside the outline and don't overlap. Nothing asserts a layout is *good*.
   First-fit is known to be loose; there is no regression guard against it
   getting looser.
5. **Interior paths are validated only on import.** A closed cut ring is checked
   for structure, containment and self-crossing when a pattern file is imported.
   Nothing re-checks a record written before that check existed, and
   `holeAreaMm2` will happily total a broken one.
6. **No concurrency test.** Two simultaneous writes to the same record are a
   last-writer-wins race in the flat-file stores. Single operator makes this
   theoretical today; it stops being theoretical the moment anything automated
   writes.
7. **`data/` directory growth is untested.** Nothing proves a deleted hide takes
   its photo with it in every path, or that a failed redigitize leaves no
   orphaned image file. Record cleanup is covered; file cleanup is only partly.
8. **No load or size limits tested on upload.** `formidable` is constructed with
   no options, so its defaults apply. A deliberately huge upload has not been
   tried.
9. **Colour has no validated threshold.** CIEDE2000 is verified against
   published vectors, so the *arithmetic* is right. What ΔE00 value means "these
   two hides match" is unknown and untested, because it needs real labelled hide
   pairs. Colour currently ranks and never gates, which is why this is a gap and
   not a bug.

## Conventions

- **A new test must fail before the fix and pass after.** If you cannot
  demonstrate that, you have not established that the test tests anything. Every
  test added on 2026-09-27 was checked this way by disabling the fix and
  confirming the failure.
- Fixture images are generated by `test/fixtures/generate-*.py`, never committed
  as opaque binaries. Regenerate rather than hand-edit.
- Python-facing tests run the project's **real** venv interpreter. A stubbed
  child process would not prove the wrapper passes its options through, which is
  the actual risk.
- Route tests get isolated temp data directories via `withServer`, torn down
  after. Isolation is **unconditional** — it does not depend on the test asking
  for it. It used to, and `test/upload-boundary.test.js` shipped with its options
  in a position `node:test` silently ignores (`test(name, fn, options)`), so
  every one of its cases wrote to the operator's real `data/sessions/` and left
  81 records behind. Found by the verifier, not by the suite.
