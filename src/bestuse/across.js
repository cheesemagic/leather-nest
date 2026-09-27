import { filterEligible } from './eligibility.js';
import { buildParts, componentIdOf, DEFAULT_SEARCH_GRID_MM } from './evaluate.js';
import { buildSetParts } from './products.js';
import { nestAcrossHides } from '../nesting/multi.js';
import { resolveClearances } from '../nesting/clearance.js';
import { polygonArea } from '../nesting/geometry.js';

// Filling one order out of the whole library, rather than asking what a
// single hide is best used for.
//
// runSearch() answers "given THIS hide, what is the best thing to cut from
// it". This answers the other question the operator actually has: "I need
// forty straps and twelve keepers -- which hides do they come off". Only
// named quantities, because the modes that ESTIMATE what to cut all reason
// from one hide's area, and estimating across a library is a different
// problem that nobody has needed yet.

// Which component each placement belongs to, counted. The operator thinks in
// components; the nester speaks in part ids like "strap#3".
function countByComponent(placements) {
  const counts = {};
  for (const placement of placements) {
    const id = componentIdOf(placement.id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export function runAcrossHides({
  hides,
  components,
  quantities = {},
  method,
  laserClearanceMm,
  kerfMm,
  gridStepMm,
}) {
  const empty = { layouts: [], placed: {}, shortfall: {}, noDie: [], skipped: [] };

  const items = components
    .filter((component) => (quantities[component.id] ?? 0) > 0)
    .map((component) => ({ component, quantity: quantities[component.id] }));

  if (items.length === 0) {
    return { ...empty, error: 'Name how many of at least one component you need.' };
  }

  // A hide with no outline cannot be nested on, and a part-cut one still
  // carries its ORIGINAL outline -- so a layout on it would place parts over
  // leather that is already gone. filterEligible knows both rules; reporting
  // which hides were skipped and why beats silently nesting onto fewer.
  const usable = [];
  const skipped = [];
  const eligibleIdsByHide = new Map();

  for (const hide of hides) {
    const { eligible, hideRejection } = filterEligible(hide, components);
    if (hideRejection) {
      skipped.push({ hideId: hide.id, reason: hideRejection });
      continue;
    }
    eligibleIdsByHide.set(hide.id, new Set(eligible.map((entry) => entry.component.id)));
    usable.push({ id: hide.id, polygon: hide.outlinePolygon });
  }

  if (usable.length === 0) {
    return { ...empty, skipped, error: 'No hide in the library can be nested on.' };
  }

  const { parts, componentsById } = buildParts(items);

  // Under 'die' a component with no recorded die clearance cannot be cut at
  // all, and is dropped here rather than reported as "did not fit" -- "buy a
  // die" and "find a bigger hide" are different problems with different
  // fixes.
  const { parts: cuttable, noDie } = resolveClearances(parts, { method, laserClearanceMm, kerfMm });

  const { layouts, noFit } = nestAcrossHides(usable, cuttable, {
    method,
    laserClearanceMm,
    kerfMm,
    gridStepMm: gridStepMm ?? DEFAULT_SEARCH_GRID_MM,
    // Species and thickness vary per hide, so a part that cannot legally come
    // off one may still fit the next. Precomputed per hide above rather than
    // re-derived per part, since filterEligible walks the whole component
    // library each time it is called.
    eligibleFor: (hide, part) => eligibleIdsByHide.get(hide.id).has(part.componentId),
  });

  const placed = {};
  const withUtilization = layouts.map((layout) => {
    const counts = countByComponent(layout.placements);
    for (const [componentId, n] of Object.entries(counts)) {
      placed[componentId] = (placed[componentId] ?? 0) + n;
    }

    const hideArea = polygonArea(hides.find((h) => h.id === layout.hideId).outlinePolygon);
    const placedArea = layout.placements.reduce((total, placement) => {
      const component = componentsById.get(componentIdOf(placement.id));
      return total + (component ? polygonArea(component.polygon) : 0);
    }, 0);

    return {
      ...layout,
      counts,
      utilization: hideArea > 0 ? placedArea / hideArea : 0,
    };
  });

  // What the operator actually asked and did not get. Reported per component
  // rather than as a list of part ids, and only where something is genuinely
  // short -- a fully satisfied order should report nothing rather than a row
  // of zeroes.
  const shortfall = {};
  for (const item of items) {
    const missing = item.quantity - (placed[item.component.id] ?? 0);
    if (missing > 0) shortfall[item.component.id] = missing;
  }

  return {
    layouts: withUtilization,
    placed,
    shortfall,
    noDie: [...new Set(noDie.map(componentIdOf))],
    skipped,
    // noFit is not returned as part ids: every one of them is already counted
    // in shortfall, and two representations of one fact drift apart.
    error: null,
  };
}

// Which pieces must stay together on one hide.
//
// A must-match piece groups with the rest of ITS set, so set 0's vamps cannot
// be split from each other; a spannable piece returns null and is free to land
// wherever it fits. That is the whole of the mustMatch semantics, in one
// expression -- see docs/superpowers/specs/2026-09-26-product-set-atomicity-design.md.
const groupOfSetPiece = (part) => (part.mustMatch ? `set${part.setIndex}` : null);

// The most whole sets of one product that the library can yield.
//
// Found by binary search over set count, the same way evaluateProductCandidate
// does it for a single hide, because the right quantity is not something one
// estimate can answer. Monotonicity is inherited rather than newly assumed:
// nestAcrossHides places parts in a strictly sequential pass and never
// backtracks, so succeeding at N implies succeeding at fewer, and rollback only
// ever REMOVES placements.
export function runProductAcrossHides({
  hides,
  components,
  product,
  method,
  laserClearanceMm,
  kerfMm,
  gridStepMm,
  orientations,
}) {
  const empty = { layouts: [], completeCount: 0, noDie: [], skipped: [] };

  const byId = new Map(components.map((component) => [component.id, component]));
  const entries = (product.parts ?? []).map((p) => {
    const component = byId.get(p.partId);
    return component ? { component } : null;
  });
  if (entries.length === 0 || entries.some((entry) => !entry)) {
    return { ...empty, error: 'This product names a component that is not in the library.' };
  }

  const usable = [];
  const skipped = [];
  const eligibleIdsByHide = new Map();
  for (const hide of hides) {
    const { eligible, hideRejection } = filterEligible(hide, components);
    if (hideRejection) {
      skipped.push({ hideId: hide.id, reason: hideRejection });
      continue;
    }
    eligibleIdsByHide.set(hide.id, new Set(eligible.map((entry) => entry.component.id)));
    usable.push({ id: hide.id, polygon: hide.outlinePolygon });
  }
  if (usable.length === 0) {
    return { ...empty, skipped, error: 'No hide in the library can be nested on.' };
  }

  const nestOptions = {
    method,
    laserClearanceMm,
    kerfMm,
    orientations,
    gridStepMm: gridStepMm ?? DEFAULT_SEARCH_GRID_MM,
    eligibleFor: (hide, part) => eligibleIdsByHide.get(hide.id).has(part.componentId),
    groupOf: groupOfSetPiece,
  };

  function tryNest(sets) {
    const { parts: cuttable, noDie } = resolveClearances(
      buildSetParts(product, entries, sets),
      { method, laserClearanceMm, kerfMm }
    );
    // A component with no recorded die cannot be cut at all under 'die', so a
    // set containing one can never be completed -- reported separately from
    // "did not fit", because "buy a die" is a different fix.
    if (noDie.length > 0) return { ok: false, noDie, layouts: [], setOf: new Map() };
    const { layouts, noFit } = nestAcrossHides(usable, cuttable, nestOptions);
    const setOf = new Map(cuttable.map((part) => [part.id, part.setIndex]));
    return { ok: noFit.length === 0, noDie: [], layouts, setOf };
  }

  const first = tryNest(1);
  if (first.noDie.length > 0) {
    return {
      ...empty,
      skipped,
      noDie: [...new Set(first.noDie.map(componentIdOf))],
      error: null,
    };
  }
  if (!first.ok) return { ...empty, skipped, error: null };

  // Generous upper bound on whole sets; the search finds the true ceiling by
  // placement failure, this only has to not undershoot it.
  const hideArea = usable.reduce((total, h) => total + polygonArea(h.polygon), 0);
  const setArea = product.parts.reduce((total, p, i) => {
    const area = polygonArea(entries[i].component.polygon);
    return total + area * p.quantity;
  }, 0);
  const maxSets = Math.max(1, Math.floor(hideArea / Math.max(setArea, 1)));

  let lo = 1;
  let hi = maxSets;
  let best = { sets: 1, layouts: first.layouts, setOf: first.setOf };
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const attempt = tryNest(mid);
    if (attempt.ok) {
      best = { sets: mid, layouts: attempt.layouts, setOf: attempt.setOf };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    layouts: best.layouts.map((layout) => ({
      ...layout,
      // Which sets this hide carries, so a reader can see that a set was not
      // split rather than taking it on trust. Read from the PARTS: a placement
      // carries only an id and a position.
      setIndexes: [...new Set(
        layout.placements.map((placement) => best.setOf.get(placement.id)).filter((n) => n !== undefined)
      )].sort((a, b) => a - b),
    })),
    completeCount: best.sets,
    noDie: [],
    skipped,
    error: null,
  };
}
