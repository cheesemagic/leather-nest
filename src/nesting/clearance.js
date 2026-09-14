// Decides how much clear space each part needs, given how the job is being
// cut. The nester consumes the result: place() reads part.clearanceMm and
// inflates each part by its FULL clearance (clearances are not shared, so an
// 8mm part beside a 2mm part ends up 10mm away).

export const DEFAULT_LASER_CLEARANCE_MM = 1.0;

// A typical clicker board overhang beyond the blade. Exported for the
// Components dialog to prefill when recording a new die — never used as a
// fallback here, because a component with no die recorded does not have an
// 8mm die, it has no die at all.
export const DEFAULT_DIE_CLEARANCE_MM = 8.0;

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
