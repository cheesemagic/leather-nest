// What order the machine works through a job.
//
// Laser software generally follows the order things appear in the file unless
// its own path optimiser is switched on, so this is genuinely ours to decide.
// Two separate problems, both of which show up on the finished leather.

// Within one piece: everything that does NOT free the piece happens first,
// and the outline goes last.
//
// This one is not a preference. Cutting the outline first releases the piece,
// and a loose piece can shift, tilt, or drop into the bed — so every hole and
// stitch guide made after that lands somewhere other than where it was meant
// to. Marks and scores come before through-cuts for the same reason at a
// smaller scale: they are least likely to weaken what is holding everything
// in place.
export const KIND_ORDER = ['mark', 'score', 'cut'];

export function sortInteriorPaths(paths = []) {
  return [...paths]
    .map((path, index) => ({ path, index }))
    .sort((a, b) => {
      const rank = KIND_ORDER.indexOf(a.path.kind) - KIND_ORDER.indexOf(b.path.kind);
      // Stable within a kind, so a file is byte-identical run to run.
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.path);
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Across pieces: put distance between consecutive cuts so heat has somewhere
// to go.
//
// Placements come out of the nester broadly bottom-left outward, so
// neighbours get cut one after another, each into leather the beam has just
// been sitting beside. That is where charring and curled edges come from.
//
// Deal the sheet into quadrants and take from them in rotation. A greedy
// "always go furthest from the last few" was tried first and is worse in a
// way that only shows up at the end: it spreads the early cuts beautifully
// and then has nothing left but a cluster, so the final pieces come out
// adjacent anyway. Round-robin drains the quadrants evenly, so the last cuts
// are as spread as the first.
//
// Two refinements were tried and dropped, because measuring them showed they
// bought nothing: visiting the quadrants diagonally rather than in order, and
// taking alternately from each end of a quadrant. Across a 5x5 grid, an 8x8
// grid and a long 4x12 strip all four combinations landed within noise of
// each other — and on the strip the plain version was better. The rotation
// itself is doing the work.
export function orderForHeat(entries) {
  if (!Array.isArray(entries) || entries.length < 3) return entries ?? [];

  const xs = entries.map((e) => e.x);
  const ys = entries.map((e) => e.y);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const quadrants = [[], [], [], []];
  // Sorted by position, never by arrival: feeding the same job in a different
  // order must produce the same file.
  for (const entry of [...entries].sort((a, b) => a.y - b.y || a.x - b.x)) {
    quadrants[(entry.y > midY ? 2 : 0) + (entry.x > midX ? 1 : 0)].push(entry);
  }

  const ordered = [];
  while (ordered.length < entries.length) {
    let tookAny = false;
    for (const bucket of quadrants) {
      if (!bucket.length) continue;
      ordered.push(bucket.shift());
      tookAny = true;
    }
    // Everything landed in one quadrant (a long narrow job, say) — nothing
    // left to rotate between, so stop rather than spin.
    if (!tookAny) break;
  }
  return ordered;
}

// How far apart consecutive cuts are. Reported so the effect of a change is
// a number rather than a claim that it helped.
//
// `smallest` is the least useful of the three: some cluster always remains,
// so the single worst pair barely moves however good the ordering is. What
// matters is how OFTEN the beam returns to leather it was just beside, which
// is `adjacent`.
export function consecutiveGapStats(entries, { adjacentWithinMm = 0 } = {}) {
  if (!Array.isArray(entries) || entries.length < 2) {
    return { mean: Infinity, smallest: Infinity, adjacent: 0, pairs: 0 };
  }
  let total = 0;
  let smallest = Infinity;
  let adjacent = 0;
  for (let i = 1; i < entries.length; i++) {
    const d = distance(entries[i - 1], entries[i]);
    total += d;
    if (d < smallest) smallest = d;
    if (d <= adjacentWithinMm) adjacent++;
  }
  const pairs = entries.length - 1;
  return { mean: total / pairs, smallest, adjacent, pairs };
}
