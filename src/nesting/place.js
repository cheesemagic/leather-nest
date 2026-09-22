import {
  getClipperLib,
  boundingBox,
  rotatePolygon,
  normalizeToOrigin,
  toClipperPath,
  placedPolygon,
  polygonContains,
  inflatePolygon,
  translatePolygon,
  polygonArea,
  SCALE,
} from './geometry.js';
import { computeNFP } from './nfp.js';

export const GRID_STEP_MM = 1;

export function place(sheetPolygon, parts, options = {}) {
  const ClipperLib = getClipperLib();
  const sheetBounds = boundingBox(sheetPolygon);
  const sheetWidth = sheetBounds.maxX - sheetBounds.minX;
  const sheetHeight = sheetBounds.maxY - sheetBounds.minY;
  const defaultClearanceMm = options.clearanceMm;

  // How far apart candidate positions are tried. This is a packing-QUALITY
  // knob, not a correctness one: every position still passes the same exact
  // containment and overlap checks, so a coarse layout is genuinely
  // cuttable — it just packs less tightly. Measured on a 120-vertex hide
  // asking for 277 keepers: 1mm placed 277 in 172s, 5mm placed 234 in 5.5s.
  //
  // Guarded like clearanceMm, and for a sharper reason: a step of 0 loops
  // forever, and NaN makes `y <= maxY` false immediately so nothing places
  // at all. Both fall back to the 1mm default, which keeps every existing
  // caller — src/app.js included — behaving exactly as before.
  const rawGridStep = options.gridStepMm;
  const gridStepMm =
    Number.isFinite(rawGridStep) && rawGridStep > 0 ? rawGridStep : GRID_STEP_MM;

  // Containment is tested against the sheet's true outline via
  // polygonContains, which is now exact (backed by a clipper difference, not
  // just the cheap vertex/edge checks). The axis-aligned bounds below are
  // kept only as a free pre-filter — they reject far-outside positions
  // before any real work, but they are never the authority on whether a
  // part fits. Part-vs-part overlap is a separate story: it still goes
  // through computeNFP (nfp.js), which is exact for convex parts only.
  const placed = [];
  const placements = [];
  const noFit = [];
  // Keyed by shape, rotation and clearance on both sides. Local to this call,
  // so it cannot grow across runs.
  const nfpCache = new Map();

  // Once a part fails, every later part from the SAME component fails too:
  // `placed` only grows during this call, so the free region only ever
  // shrinks, and a part that fit nowhere cannot fit against less space.
  // Skipping them turns a wasted full grid scan per part into nothing — a
  // measured 12.9s drops to roughly the cost of the parts that could fit.
  // componentId is optional; parts without it are never skipped, so existing
  // callers behave exactly as before.
  const failedComponentIds = new Set();

  // Biggest pieces first.
  //
  // Placement is greedy, so whatever is fed in first gets the run of the
  // hide and everything after fills the gaps. Big pieces need big gaps and
  // cannot use the scraps small ones leave; small pieces can always use the
  // scraps big ones leave. Feeding them in the order they happened to arrive
  // means that ordering is decided by the component store.
  //
  // Measured on mixed jobs, biggest-first against smallest-first, leather
  // used: real offcut 64.2% vs 58.5%, the same offcut turned 57.4% vs 52.7%,
  // a plain rectangle 74.7% vs 64.6%, a chevron 42.5% vs 39.2%. Positive on
  // every hide tried, which is more than can be said for the other levers
  // measured alongside it — preferring a different rotation first won on one
  // hide and lost on two others.
  //
  // It also stacks with the orientation search rather than duplicating it:
  // on the turned offcut, 52.7% as-given at one orientation, 67.5% with both.
  //
  // Stable within a size, so parts of the same component stay together and
  // the doomed-repeat skip below still fires.
  const ordered = parts
    .map((part, index) => ({ part, index, area: polygonArea(part.polygon) }))
    .sort((a, b) => b.area - a.area || a.index - b.index)
    .map((entry) => entry.part);

  for (const part of ordered) {
    if (part.componentId !== undefined && failedComponentIds.has(part.componentId)) {
      noFit.push(part.id);
      continue;
    }

    let accepted = null;

    // Clearances are not shared between neighbours: each part reserves its
    // full clearance around its own cut line, so an 8mm part beside a 2mm
    // part ends up 10mm away. Inflating each by its FULL clearance (rather
    // than half) is what produces that.
    const rawClearance = part.clearanceMm ?? defaultClearanceMm;
    // Cap as well as floor. A finite but absurd clearance (1e18) passes
    // Number.isFinite yet overflows clipper's coordinate range, and clipper
    // reports that by calling alert() — which throws in Node and, worse,
    // returns silently in a browser, leaving placement to run on a bogus
    // offset. Anything wider than the sheet can never fit anyway, so the
    // cap costs no real placement and keeps the offset in range.
    const maxUsefulClearanceMm = sheetWidth + sheetHeight;
    const clearanceMm =
      Number.isFinite(rawClearance) && rawClearance > 0
        ? Math.min(rawClearance, maxUsefulClearanceMm)
        : 0;

    // Records predating the component metadata feature have no
    // allowedRotations key at all; default to full rotation freedom rather
    // than throwing on `for...of undefined`.
    for (const rotation of part.allowedRotations ?? [0, 90, 180, 270]) {
      const normalized = normalizeToOrigin(rotatePolygon(part.polygon, rotation));

      // The test shape carries the clearance and is deliberately NOT
      // re-normalized: expressed relative to the true part's origin it
      // spans (-c,-c)..(w+c,h+c), which keeps the scan position, the NFP's
      // reference point, and the reported polygon on one shared origin.
      const testShape = inflatePolygon(normalized, clearanceMm);
      const testBounds = boundingBox(testShape);
      const testWidth = testBounds.maxX - testBounds.minX;
      const testHeight = testBounds.maxY - testBounds.minY;

      if (testWidth > sheetWidth || testHeight > sheetHeight) {
        continue;
      }

      const minX = sheetBounds.minX - testBounds.minX;
      const minY = sheetBounds.minY - testBounds.minY;
      const maxX = sheetBounds.maxX - testBounds.maxX;
      const maxY = sheetBounds.maxY - testBounds.maxY;
      // The no-fit region between two shapes depends only on the shapes and
      // their rotations — moving one of them just moves the region with it.
      // It was being recomputed against every already-placed part, which was
      // free while an NFP was one Minkowski sum. It is not free now: a part
      // with a deep curved concavity decomposes into around twenty convex
      // pieces, and an NFP costs one sum per PAIR of pieces. Computed once
      // per shape-and-rotation pair and translated, a job of identical parts
      // needs sixteen NFPs rather than one per placed part.
      const forbiddenRegions = [];
      for (const other of placed) {
        const key =
          other.componentId !== undefined && part.componentId !== undefined
            ? `${other.componentId}@${other.rotation}/${other.clearanceMm}|` +
              `${part.componentId}@${rotation}/${clearanceMm}`
            : null;

        let base = key === null ? null : nfpCache.get(key);
        if (!base) {
          base = computeNFP(other.baseShape, testShape);
          if (key !== null) nfpCache.set(key, base);
        }
        for (const region of base) {
          forbiddenRegions.push(translatePolygon(region, other.x, other.y));
        }
      }
      // Forbidden regions don't change during the grid scan below, so
      // convert to clipper format once per rotation trial rather than once
      // per candidate point (was 4.8x slower re-converting per point).
      const forbiddenClipperPaths = forbiddenRegions.map(toClipperPath);

      let found = null;
      // Bottom-left-fill scan: rows from sheet minY upward, left to right
      // within each row, first valid position wins.
      //
      // Worst case, synchronous, no early exit: a part that fits the
      // sheet's bounding box but no reachable position on the true outline
      // pays a full grid traversal — every (x, y) at GRID_STEP_MM spacing,
      // per allowed rotation — before it's reported noFit. Measured at
      // ~680ms for one such part on a 200-vertex hide; ~6.9s for ten of
      // them in a row. The AABB pre-filter above only catches parts bigger
      // than the box, so "fits the box, not the hide" is the common failure
      // mode on an irregular hide, not an edge case. No caching, early
      // exit, or yielding here by design — that's a later optimization
      // pass, not this fix.
      for (let y = minY; y <= maxY && !found; y += gridStepMm) {
        for (let x = minX; x <= maxX && !found; x += gridStepMm) {
          const clipperPoint = new ClipperLib.IntPoint2(
            Math.round(x * SCALE),
            Math.round(y * SCALE)
          );
          const overlapsPlacedPart = forbiddenClipperPaths.some(
            (path) =>
              // 1 = strictly inside (overlap, reject); -1 = on boundary
              // (touching, allowed — enables flush nesting); 0 = outside (allowed).
              ClipperLib.Clipper.PointInPolygon(clipperPoint, path) === 1
          );
          if (!overlapsPlacedPart) {
            const placedTestShape = translatePolygon(testShape, x, y);
            if (polygonContains(sheetPolygon, placedTestShape)) {
              found = {
                x,
                y,
                rotation,
                polygon: placedPolygon(part, { x, y, rotation }),
                testPolygon: placedTestShape,
                baseShape: testShape,
              };
            }
          }
        }
      }

      if (found) {
        accepted = found;
        break;
      }
    }

    if (accepted) {
      placed.push({
        polygon: accepted.polygon,
        testPolygon: accepted.testPolygon,
        // Kept so the NFP can be computed against the UNPLACED shape and
        // translated, rather than recomputed against the placed one.
        baseShape: accepted.baseShape,
        x: accepted.x,
        y: accepted.y,
        rotation: accepted.rotation,
        componentId: part.componentId,
        clearanceMm,
      });
      placements.push({ id: part.id, x: accepted.x, y: accepted.y, rotation: accepted.rotation });
    } else {
      noFit.push(part.id);
      if (part.componentId !== undefined) failedComponentIds.add(part.componentId);
    }
  }

  return { placements, noFit };
}
