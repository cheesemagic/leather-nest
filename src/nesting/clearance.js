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

// The width of material the laser beam destroys as it cuts.
//
// ZERO, and that is not a placeholder for a small number — it is the honest
// statement that nobody has measured it. Every other physical constant in
// this file was chosen in conversation; this one refuses to be. A guessed
// kerf silently resizes every piece the program ever cuts, in a direction
// nobody would notice until a strap does not fit its buckle.
//
// Set it once a test square has been cut and measured: cut a 50mm square,
// measure what comes off the bed, and the difference is the kerf. Until
// then 0 means "cut exactly on the line", which is what the program has
// always done.
//
// Die cutting ignores this entirely — a steel rule shears the leather apart
// rather than burning a channel through it, so nothing is removed.
export const DEFAULT_KERF_MM = 0;

// Half the kerf, because the beam eats into BOTH sides of the line it
// follows: a cut path is a channel of kerf width centred on the line, so the
// piece on either side loses half of it. Compensating means moving the cut
// line outward by this much, so what is left after the burn is the size that
// was drawn.
export function kerfAllowanceMm(options = {}) {
  const { method = 'laser', kerfMm = DEFAULT_KERF_MM } = options;
  if (method !== 'laser') return 0;
  if (!Number.isFinite(kerfMm) || kerfMm <= 0) return 0;
  return kerfMm / 2;
}

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
  // A kerf-compensated piece is cut slightly oversize, so it takes up more
  // room on the hide than its drawn outline does. Folding that into the
  // clearance keeps one rule for "space this part needs" rather than two
  // that can disagree — and because clearances are not shared, two adjacent
  // parts each reserve half a kerf, which is exactly the full kerf between
  // their cut lines.
  const kerf = kerfAllowanceMm(options);
  if (method === 'laser') return laserClearanceMm + kerf;

  // `??`, not a falsy check: a dieClearanceMm of 0 is a real die needing no
  // margin beyond its cut line, and must not read as "no die".
  const dieClearanceMm = part.dieClearanceMm ?? null;
  return dieClearanceMm === null ? null : dieClearanceMm + kerf;
}

export function resolveClearances(parts, options = {}) {
  const { method = 'laser', laserClearanceMm = DEFAULT_LASER_CLEARANCE_MM } = options;

  if (method !== 'laser' && method !== 'die') {
    throw new Error(`Unknown cutting method "${method}". Expected "laser" or "die".`);
  }

  // A laser cuts anything on the sheet, so dies are irrelevant and nothing
  // is ever untooled.
  const kerf = kerfAllowanceMm(options);

  if (method === 'laser') {
    return {
      parts: parts.map((part) => ({ ...part, clearanceMm: laserClearanceMm + kerf })),
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
      tooled.push({ ...part, clearanceMm: dieClearanceMm + kerf });
    }
  }
  return { parts: tooled, noDie };
}
