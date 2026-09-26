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
export function nestAcrossHides(hides, parts, options = {}) {
  // Defaults to "any part may be cut from any hide". The real predicate is
  // species and thickness eligibility, which lives in bestuse/eligibility.js
  // and is the caller's to supply -- this module has no business knowing what
  // a species is.
  const { eligibleFor = () => true } = options;

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

    // An empty layout would read as "this hide was used" and could put a hide
    // with nothing on it into a cut file.
    if (placements.length === 0) continue;

    const placed = new Set(placements.map((placement) => placement.id));
    remaining = remaining.filter((part) => !placed.has(part.id));
    layouts.push({ hideId: hide.id, placements, orientationDegrees });
  }

  // Whatever is still here fits nowhere in the library. Derived from what was
  // actually placed rather than collected from each hide's own noFit: a part
  // that failed on three hides and succeeded on the fourth is not a failure,
  // and summing the per-hide rejections would report it as three.
  return { layouts, noFit: remaining.map((part) => part.id) };
}
