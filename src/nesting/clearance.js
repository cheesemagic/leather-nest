// Decides how much clear space each part needs, given how the job is being
// cut. The nester consumes the result: place() reads part.clearanceMm and
// inflates each part by its FULL clearance (clearances are not shared, so an
// 8mm part beside a 2mm part ends up 10mm away).

export const DEFAULT_LASER_CLEARANCE_MM = 1.0;

// HALF the gap the operator wants between two cuts, because clearances are
// not shared: each part reserves its own full margin, so two identical dies
// end up 2 x this value apart. 2.5 here means 5mm between cuts, which is how
// close the operator judged they can reliably position a bare steel-rule die
// by hand.
//
// That doubling is the trap in this field. An earlier default of 8.0 came
// from assuming a clicker die with a plywood board overhanging the blade;
// these dies are bare steel rule, with no board at all. On a real 88mm-wide
// python strip that mistake cost 10 keepers against 27 — $110 instead of
// $297 from the same piece of leather.
//
// Exported for the Components dialog to prefill when recording a new die —
// never used as a fallback in resolveClearances, because a component with no
// die recorded does not have a 2.5mm die, it has no die at all.
export const DEFAULT_DIE_CLEARANCE_MM = 2.5;

// The single rule for "how much clear space does THIS part need under THIS
// method". Shared so the cheap area estimate and the real nester cannot
// drift apart — the estimate ignoring clearance under-counted a 35x12mm
// keeper's footprint by 2.7x, because at 6mm the clearance IS most of the
// footprint (47x24mm occupied against 35x12mm of leather).
//
// Returns null under 'die' when no die is owned: that part cannot be cut at
// all, which is a different answer from "needs no clearance".
export function clearanceFor(part, options = {}) {
  const { method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM } = options;

  if (method !== 'laser' && method !== 'die') {
    throw new Error(`Unknown cutting method "${method}". Expected "laser" or "die".`);
  }
  if (method === 'laser') return laserClearanceMm;

  // `??`, not a falsy check: a dieClearanceMm of 0 is a real die needing no
  // margin beyond its cut line, and must not read as "no die".
  return part.dieClearanceMm ?? null;
}

export function resolveClearances(parts, options = {}) {
  const { method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM } = options;

  if (method !== 'laser' && method !== 'die') {
    throw new Error(`Unknown cutting method "${method}". Expected "laser" or "die".`);
  }

  // A laser cuts anything on the sheet, so dies are irrelevant and nothing
  // is ever untooled.
  if (method === 'laser') {
    return {
      parts: parts.map((part) => ({ ...part, clearanceMm: laserClearanceMm })),
      noDie: [],
    };
  }

  const tooled = [];
  const noDie = [];
  for (const part of parts) {
    // `??`, not a falsy check: a dieClearanceMm of 0 is a real die needing no
    // margin beyond its cut line, and must not read as "no die".
    const dieClearanceMm = part.dieClearanceMm ?? null;
    if (dieClearanceMm === null) {
      // No die means the piece physically cannot be cut on this job. Report
      // it separately from noFit — "buy a die" and "find a bigger offcut"
      // are different fixes.
      noDie.push(part.id);
    } else {
      tooled.push({ ...part, clearanceMm: dieClearanceMm });
    }
  }
  return { parts: tooled, noDie };
}
