import { nestBestOrientation } from './orient.js';
import { polygonArea } from './geometry.js';

// Nesting one job across SEVERAL hides, spilling what will not fit onto the
// next. place() and nestBestOrientation() both answer "what fits on this one
// sheet"; this answers "how do I cut these forty straps out of what I own".
//
// Deliberately knows nothing about products, sets or matching. It takes a
// flat list of parts and returns which hide each one lands on. Keeping a
// product's visible pieces together on one hide is a real requirement (asked
// and confirmed 2026-09-26) but it is a layer above this one, and it needs a
// per-component flag that does not exist yet.
//
// PART IDS MUST BE UNIQUE across the whole job, not just within one hide --
// they are how a placed part is struck off the remaining list. products.js
// already builds them as `${component.id}#${n}` for exactly this reason.

// ponytail: O(hides x orientations x parts) full re-nests, no backtracking.
// A hide that cannot take a part is simply skipped and the part tries the
// next one, so a job never revisits a decision. Good enough for a library of
// tens; if it ever has to handle hundreds of hides, the upgrade is to skip
// hides whose total area cannot hold what is left before nesting them at all.
// Group atomicity: a group lands on one hide whole, or not at all.
//
// Discards the placements of any group that came out only partly placed, so
// its members go back into the remaining list and try the next hide together.
// The alternative -- re-nesting the hide without the failed group, repeatedly
// until it settles -- costs a full NFP scan per attempt for a gain nobody has
// measured. This loses yield, never correctness: the space a rolled-back
// group occupied is simply left unused on that hide.
//
// Counted against REMAINING rather than against what this hide was offered.
// A group split by eligibility can never be completed here, and counting only
// the eligible members would let it read as complete when part of it was
// never even a candidate.
function keepWholeGroups(placements, remaining, groupOf) {
  const placedIds = new Set(placements.map((placement) => placement.id));

  const tally = new Map();
  for (const part of remaining) {
    const key = groupOf(part);
    if (key === null || key === undefined) continue;
    const seen = tally.get(key) ?? { outstanding: 0, placed: 0 };
    seen.outstanding += 1;
    if (placedIds.has(part.id)) seen.placed += 1;
    tally.set(key, seen);
  }

  const incomplete = new Set();
  for (const [key, seen] of tally) {
    if (seen.placed > 0 && seen.placed < seen.outstanding) incomplete.add(key);
  }
  if (incomplete.size === 0) return placements;

  // Ungrouped parts on the same hide are untouched: they had no reason to
  // move, and evicting them would lose yield for nothing.
  const groupById = new Map(remaining.map((part) => [part.id, groupOf(part)]));
  return placements.filter((placement) => !incomplete.has(groupById.get(placement.id)));
}

export function nestAcrossHides(hides, parts, options = {}) {
  // Defaults to "any part may be cut from any hide". The real predicate is
  // species and thickness eligibility, which lives in bestuse/eligibility.js
  // and is the caller's to supply -- this module has no business knowing what
  // a species is.
  const { eligibleFor = () => true, groupOf = () => null } = options;

  // Smallest first, so scrap is consumed before whole skins are broken into.
  // The operator's call (2026-09-26) and standard cutting-room practice: a
  // large hide kept whole can still take work that a pile of offcuts cannot.
  //
  // Sorted here rather than trusted from the caller, so the policy holds
  // however the library happens to arrive.
  const ordered = [...hides].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));

  const layouts = [];
  let remaining = parts;

  for (const hide of ordered) {
    // Nesting is expensive -- several orientations of a full NFP scan each --
    // so a finished job stops rather than walking the rest of the library.
    if (remaining.length === 0) break;

    const eligible = remaining.filter((part) => eligibleFor(hide, part));
    if (eligible.length === 0) continue;

    const { placements, orientationDegrees } = nestBestOrientation(hide.polygon, eligible, options);

    const kept = keepWholeGroups(placements, remaining, groupOf);

    // An empty layout would read as "this hide was used" and could put a hide
    // with nothing on it into a cut file. A hide whose only placements were
    // rolled back is empty for exactly that purpose.
    if (kept.length === 0) continue;

    const placed = new Set(kept.map((placement) => placement.id));
    remaining = remaining.filter((part) => !placed.has(part.id));
    layouts.push({ hideId: hide.id, placements: kept, orientationDegrees });
  }

  // Whatever is still here fits nowhere in the library. Derived from what was
  // actually placed rather than collected from each hide's own noFit: a part
  // that failed on three hides and succeeded on the fourth is not a failure,
  // and summing the per-hide rejections would report it as three.
  return { layouts, noFit: remaining.map((part) => part.id) };
}
