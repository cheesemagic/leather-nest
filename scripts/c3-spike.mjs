// THROWAWAY. The experiment specified by
// docs/superpowers/specs/2026-09-18-find-best-use-c3-spike.md.
//
// Its output is an ANSWER, not a component: does a mixed-component generator
// beat today's `singles` mode by enough to justify building C3 at all? Nothing
// here is imported by src/. Delete it once the question is settled.
//
//   node scripts/c3-spike.mjs            # full run
//   node scripts/c3-spike.mjs --quick    # smaller ranges, for iterating
import ClipperLib from 'clipper-lib';
globalThis.ClipperLib = ClipperLib;

import { filterEligible } from '../src/bestuse/eligibility.js';
import { generateCandidates } from '../src/bestuse/candidates.js';
import { evaluateCandidate } from '../src/bestuse/evaluate.js';
import { rankCandidates } from '../src/bestuse/ranking.js';
import { estimateCapacity, PACKING_EFFICIENCY } from '../src/bestuse/estimate.js';
import { polygonArea, polygonPerimeter } from '../src/nesting/geometry.js';
import { clearanceFor } from '../src/nesting/clearance.js';

const QUICK = process.argv.includes('--quick');
const NEST_OPTS = { method: 'laser', laserClearanceMm: 1.0 };
const STRATEGIES = ['value', 'utilization', 'demand'];

// ---------------------------------------------------------------- fixtures

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

// Four outlines chosen to vary the thing most likely to break an area-based
// estimate: how much of the area is reachable by a large part.
const T2_HIDES = [
  {
    id: 'rect', label: 'Rectangle (control)', species: 'python', thicknessMm: 1.8,
    remainingAreaPct: 100, outlinePolygon: rect(300, 220),
  },
  {
    id: 'ell', label: 'L-shape (concave)', species: 'python', thicknessMm: 1.8,
    remainingAreaPct: 100,
    outlinePolygon: [
      { x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 110 },
      { x: 170, y: 110 }, { x: 170, y: 240 }, { x: 0, y: 240 },
    ],
  },
  {
    id: 'strip', label: 'Narrow strip', species: 'python', thicknessMm: 1.8,
    remainingAreaPct: 100, outlinePolygon: rect(560, 95),
  },
  {
    // A deep notch: plenty of total area, but a long part cannot span it.
    id: 'notch', label: 'Deep notch', species: 'python', thicknessMm: 1.8,
    remainingAreaPct: 100,
    outlinePolygon: [
      { x: 0, y: 0 }, { x: 330, y: 0 }, { x: 330, y: 230 }, { x: 190, y: 230 },
      { x: 190, y: 70 }, { x: 140, y: 70 }, { x: 140, y: 230 }, { x: 0, y: 230 },
    ],
  },
];

function comp(id, name, w, h, valuePerPiece, demand) {
  return {
    id, name, polygon: rect(w, h), valuePerPiece, demand,
    allowedSpecies: null, thicknessMinMm: null, thicknessMaxMm: null,
    allowedRotations: [0, 90, 180, 270], dieClearanceMm: null,
  };
}

// TIER 1 — small enough that exhaustive enumeration reaches the true optimum.
// Hides are ~a third the linear size of tier 2, and the component mix spans
// the tradeoff the brief is about: one big valuable part, one middling, one
// small cheap one that can fill the gaps the big one leaves.
const T1_COMPONENTS = [
  comp('strap', 'strap 150x45', 150, 45, 60, 3),
  comp('pocket', 'pocket 90x70', 90, 70, 22, 4),
  comp('tab', 'tab 40x30', 40, 30, 5, 16),
];

const T1_HIDES = [
  { id: 't1-rect', label: 'Small rectangle', outlinePolygon: rect(240, 160) },
  {
    id: 't1-ell', label: 'Small L-shape',
    outlinePolygon: [
      { x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 85 },
      { x: 130, y: 85 }, { x: 130, y: 185 }, { x: 0, y: 185 },
    ],
  },
  { id: 't1-strip', label: 'Small strip', outlinePolygon: rect(400, 95) },
  {
    id: 't1-notch', label: 'Small notch',
    outlinePolygon: [
      { x: 0, y: 0 }, { x: 260, y: 0 }, { x: 260, y: 170 }, { x: 150, y: 170 },
      { x: 150, y: 55 }, { x: 110, y: 55 }, { x: 110, y: 170 }, { x: 0, y: 170 },
    ],
  },
].map((h) => ({ ...h, species: 'python', thicknessMm: 1.8, remainingAreaPct: 100 }));

// TIER 2 — realistic sizes. No reference is computable here; the question is
// only whether a mix beats the incumbent `singles` mode.
const T2_COMPONENTS = [
  comp('strap', 'belt strap 200x38', 200, 38, 60, 4),
  comp('keeper', 'keeper 35x12', 35, 12, 4, 30),
  comp('pocket', 'card pocket 90x70', 90, 70, 22, 6),
  comp('tab', 'tab 50x25', 50, 25, 9, 10),
  comp('panel', 'panel 120x80', 120, 80, 30, 3),
];

// ------------------------------------------------------------ shared maths

// Mirrors estimate.js's footprint formula. Duplicated rather than exported,
// because this file is throwaway and src/ should not grow a seam for it.
function footprintArea(component, options = NEST_OPTS) {
  const cutArea = polygonArea(component.polygon);
  const c = clearanceFor(component, options) ?? 0;
  if (!(c > 0)) return cutArea;
  return cutArea + polygonPerimeter(component.polygon) * c + Math.PI * c ** 2;
}

// What one piece contributes to the question being asked. The whole point of
// the C1 design is that this differs by strategy, so every search below takes
// it as a parameter rather than assuming dollars.
function perPieceScore(component, strategy) {
  if (strategy === 'value') return component.valuePerPiece ?? 0;
  if (strategy === 'utilization') return polygonArea(component.polygon);
  return 1; // demand: one piece fills at most one order, capped separately
}

function scoreOf(result, strategy) {
  if (strategy === 'value') return result.value;
  if (strategy === 'utilization') return result.utilization;
  return result.demandSatisfied;
}

function candidateFrom(quantities, components, id) {
  const items = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([componentId, quantity]) => ({
      component: components.find((c) => c.id === componentId),
      quantity,
      unverified: [],
    }));
  return { candidateId: id, mode: 'full', items };
}

let nestCount = 0;
function nest(hide, quantities, components, id) {
  nestCount++;
  return evaluateCandidate(hide, candidateFrom(quantities, components, id), NEST_OPTS);
}

// --------------------------------------------------------------- reference

// Ground truth by exhaustive enumeration. Only trustworthy when no component
// sits at its cap in the winning vector — if one does, the true optimum may
// lie beyond the range searched and this is a LOWER bound, not the answer.
// Every caller checks and reports that.
const TIER1_CAP = QUICK ? 8 : 24;

function bruteForce(hide, components, strategy) {
  const caps = components.map((c) =>
    Math.min(TIER1_CAP, estimateCapacity(hide, c, NEST_OPTS).pieces)
  );

  let best = null;
  const quantities = {};
  const recurse = (i) => {
    if (i === components.length) {
      if (Object.values(quantities).every((q) => q === 0)) return;
      const result = nest(hide, quantities, components, 'ref');
      if (!best || scoreOf(result, strategy) > scoreOf(best.result, strategy)) {
        best = { result, quantities: { ...quantities } };
      }
      return;
    }
    for (let q = 0; q <= caps[i]; q++) {
      quantities[components[i].id] = q;
      recurse(i + 1);
    }
    quantities[components[i].id] = 0;
  };
  recurse(0);

  // Did the winner press against a wall we imposed?
  const onBoundary = components.some(
    (c, i) => caps[i] > 0 && (best.quantities[c.id] ?? 0) >= caps[i]
  );
  return { ...best, onBoundary, combos: caps.reduce((a, b) => a * (b + 1), 1) };
}

// ------------------------------------------------------------- strategy A

// Greedy by score density: fill with the densest component, then the next.
// One nest. This is the baseline anything cleverer has to beat.
function greedy(hide, eligible, components, strategy) {
  let remaining = polygonArea(hide.outlinePolygon) * PACKING_EFFICIENCY;
  const density = (c) => perPieceScore(c, strategy) / footprintArea(c);
  const quantities = {};
  for (const entry of [...eligible].sort((a, b) => density(b.component) - density(a.component))) {
    const fp = footprintArea(entry.component);
    let n = Math.floor(remaining / fp);
    if (strategy === 'demand') n = Math.min(n, entry.component.demand ?? 0);
    if (n > 0) {
      quantities[entry.component.id] = n;
      remaining -= n * fp;
    }
  }
  if (!Object.keys(quantities).length) return null;
  return { result: nest(hide, quantities, components, 'greedy'), quantities };
}

// ------------------------------------------------------------- strategy B

// Bounded knapsack over estimated area, then verify the proposals by nesting.
// Run at several efficiency assumptions so one wrong constant cannot sink it —
// the spike proposal flags 0.75 as the figure most likely to be wrong for
// mixes, so this deliberately brackets it.
const EFFICIENCIES = [0.6, 0.7, 0.75, 0.85, 0.95];
const BUCKET = 25; // mm^2 per DP cell

function knapsackMix(hide, eligible, strategy, efficiency) {
  const capacity = Math.floor((polygonArea(hide.outlinePolygon) * efficiency) / BUCKET);
  if (capacity <= 0) return null;

  const items = eligible.map((e) => ({
    id: e.component.id,
    weight: Math.max(1, Math.round(footprintArea(e.component) / BUCKET)),
    value: perPieceScore(e.component, strategy),
    // Demand caps the counts, or the solver proposes 140 keepers for an
    // order of 20. Only the demand question has that ceiling.
    max: strategy === 'demand' ? (e.component.demand ?? 0) : Infinity,
  })).filter((it) => it.value > 0 && it.max > 0);
  if (!items.length) return null;

  const dp = new Float64Array(capacity + 1);
  const pick = new Int32Array(capacity + 1).fill(-1);
  const used = items.map(() => new Int32Array(capacity + 1));

  for (let w = 1; w <= capacity; w++) {
    dp[w] = dp[w - 1];
    pick[w] = -1;
    for (let i = 0; i < items.length; i++) used[i][w] = used[i][w - 1];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.weight > w) continue;
      const prev = w - it.weight;
      if (used[i][prev] >= it.max) continue;
      const candidate = dp[prev] + it.value;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        pick[w] = i;
        for (let k = 0; k < items.length; k++) used[k][w] = used[k][prev];
        used[i][w] = used[i][prev] + 1;
      }
    }
  }

  const quantities = {};
  for (let i = 0; i < items.length; i++) {
    if (used[i][capacity] > 0) quantities[items[i].id] = used[i][capacity];
  }
  return Object.keys(quantities).length ? quantities : null;
}

function knapsack(hide, eligible, components, strategy) {
  const proposals = [];
  const seen = new Set();
  for (const efficiency of EFFICIENCIES) {
    const q = knapsackMix(hide, eligible, strategy, efficiency);
    if (!q) continue;
    const key = JSON.stringify(q);
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(q);
  }
  let best = null;
  for (const quantities of proposals) {
    const result = nest(hide, quantities, components, 'knapsack');
    if (!best || scoreOf(result, strategy) > scoreOf(best.result, strategy)) {
      best = { result, quantities };
    }
  }
  return best ? { ...best, proposals: proposals.length } : null;
}

// ------------------------------------------------------------- incumbent

function singles(hide, eligible, components, strategy) {
  const candidates = generateCandidates('singles', eligible, { hide, strategy });
  if (!candidates.length) return null;
  const evaluated = candidates.map((c) => {
    nestCount++;
    return evaluateCandidate(hide, c, NEST_OPTS);
  });
  return { result: rankCandidates(evaluated, strategy)[0] };
}

// ------------------------------------------------------------------- run

function timed(fn) {
  const t = Date.now();
  const out = fn();
  return { out, ms: Date.now() - t };
}

function pct(a, b) {
  if (!(b > 0)) return a > 0 ? 'n/a' : '—';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function describe(quantities, components) {
  return (
    Object.entries(quantities ?? {})
      .filter(([, q]) => q > 0)
      .map(([id, q]) => `${q}x ${components.find((c) => c.id === id)?.name ?? id}`)
      .join(' + ') || '(none)'
  );
}

const num = (n, w) => String(n).padStart(w);

console.log(`C3 spike — ${QUICK ? 'QUICK' : 'FULL'} run`);
console.log('Q: does a mixed-component generator beat `singles` by enough to build C3?');

// ===================================================================== T1
console.log(`\n${'='.repeat(80)}`);
console.log('TIER 1 — small hides, exhaustive reference is reachable');
console.log('='.repeat(80));

const t1 = [];
for (const hide of T1_HIDES) {
  console.log(`\n## ${hide.label} — ${(polygonArea(hide.outlinePolygon) / 100).toFixed(0)} cm^2`);
  const { eligible } = filterEligible(hide, T1_COMPONENTS);

  for (const strategy of STRATEGIES) {
    nestCount = 0;
    const ref = timed(() => bruteForce(hide, T1_COMPONENTS, strategy));
    const refNests = nestCount;
    nestCount = 0;
    const sing = timed(() => singles(hide, eligible, T1_COMPONENTS, strategy));
    const singNests = nestCount;
    nestCount = 0;
    const grd = timed(() => greedy(hide, eligible, T1_COMPONENTS, strategy));
    const grdNests = nestCount;
    nestCount = 0;
    const kna = timed(() => knapsack(hide, eligible, T1_COMPONENTS, strategy));
    const knaNests = nestCount;

    const refScore = scoreOf(ref.out.result, strategy);
    const get = (r) => (r.out ? scoreOf(r.out.result, strategy) : 0);
    const flag = ref.out.onBoundary ? '  [BOUNDARY — lower bound only]' : '';

    console.log(`\n  ${strategy}${flag}`);
    console.log(`    reference   ${pct(refScore, refScore).padStart(7)} ${num(refNests, 5)} nests ${num(ref.ms, 6)}ms  ${describe(ref.out.quantities, T1_COMPONENTS)}`);
    console.log(`    singles     ${pct(get(sing), refScore).padStart(7)} ${num(singNests, 5)} nests ${num(sing.ms, 6)}ms`);
    console.log(`    greedy      ${pct(get(grd), refScore).padStart(7)} ${num(grdNests, 5)} nests ${num(grd.ms, 6)}ms  ${describe(grd.out?.quantities, T1_COMPONENTS)}`);
    console.log(`    knapsack    ${pct(get(kna), refScore).padStart(7)} ${num(knaNests, 5)} nests ${num(kna.ms, 6)}ms  ${describe(kna.out?.quantities, T1_COMPONENTS)}`);

    t1.push({
      hide: hide.label, strategy, onBoundary: ref.out.onBoundary,
      ref: refScore, singles: get(sing), greedy: get(grd), knapsack: get(kna),
      refMixSize: Object.values(ref.out.quantities).filter((q) => q > 0).length,
      knaNests, knaMs: kna.ms,
    });
  }
}

// ===================================================================== T2
console.log(`\n\n${'='.repeat(80)}`);
console.log('TIER 2 — realistic hides, no reference computable; vs the incumbent');
console.log('='.repeat(80));

const t2 = [];
for (const hide of T2_HIDES) {
  console.log(`\n## ${hide.label} — ${(polygonArea(hide.outlinePolygon) / 100).toFixed(0)} cm^2`);
  const { eligible } = filterEligible(hide, T2_COMPONENTS);

  for (const strategy of STRATEGIES) {
    nestCount = 0;
    const sing = timed(() => singles(hide, eligible, T2_COMPONENTS, strategy));
    const singNests = nestCount;
    nestCount = 0;
    const grd = timed(() => greedy(hide, eligible, T2_COMPONENTS, strategy));
    const grdNests = nestCount;
    nestCount = 0;
    const kna = timed(() => knapsack(hide, eligible, T2_COMPONENTS, strategy));
    const knaNests = nestCount;

    const base = sing.out ? scoreOf(sing.out.result, strategy) : 0;
    const get = (r) => (r.out ? scoreOf(r.out.result, strategy) : 0);

    console.log(`\n  ${strategy}`);
    console.log(`    singles     ${pct(base, base).padStart(7)} ${num(singNests, 5)} nests ${num(sing.ms, 6)}ms`);
    console.log(`    greedy      ${pct(get(grd), base).padStart(7)} ${num(grdNests, 5)} nests ${num(grd.ms, 6)}ms  ${describe(grd.out?.quantities, T2_COMPONENTS)}`);
    console.log(`    knapsack    ${pct(get(kna), base).padStart(7)} ${num(knaNests, 5)} nests ${num(kna.ms, 6)}ms  ${describe(kna.out?.quantities, T2_COMPONENTS)}`);

    t2.push({
      hide: hide.label, strategy, singles: base, greedy: get(grd), knapsack: get(kna),
      knaNests, knaMs: kna.ms, singMs: sing.ms,
      mixSize: Object.values(kna.out?.quantities ?? {}).filter((q) => q > 0).length,
    });
  }
}

// ======================================= the 0.75 packing-efficiency question
console.log(`\n\n${'='.repeat(80)}`);
console.log('ACHIEVED PACKING EFFICIENCY — is 0.75 still an upper bound for mixes?');
console.log('='.repeat(80));
console.log(`\n  ${'hide'.padEnd(24)}${'best single'.padStart(12)}${'best mix'.padStart(12)}`);
for (const hide of T2_HIDES) {
  const { eligible } = filterEligible(hide, T2_COMPONENTS);
  const best = singles(hide, eligible, T2_COMPONENTS, 'utilization');
  const mix = knapsack(hide, eligible, T2_COMPONENTS, 'utilization');
  const s1 = best ? `${(best.result.utilization * 100).toFixed(1)}%` : 'n/a';
  const s2 = mix ? `${(mix.result.utilization * 100).toFixed(1)}%` : 'n/a';
  console.log(`  ${hide.label.padEnd(24)}${s1.padStart(12)}${s2.padStart(12)}`);
}

// ================================================================= verdict
console.log(`\n\n${'='.repeat(80)}\nSUMMARY\n${'='.repeat(80)}\n`);

const meanPct = (rows, key, baseKey) => {
  const vals = rows.filter((r) => r[baseKey] > 0).map((r) => r[key] / r[baseKey]);
  return vals.length
    ? `${((vals.reduce((a, b) => a + b, 0) / vals.length) * 100).toFixed(1)}%`
    : 'n/a';
};

const clean = t1.filter((r) => !r.onBoundary);
console.log(`TIER 1 (${clean.length}/${t1.length} cases with a trustworthy reference)`);
console.log(`  mean % of optimum   singles ${meanPct(clean, 'singles', 'ref')}   greedy ${meanPct(clean, 'greedy', 'ref')}   knapsack ${meanPct(clean, 'knapsack', 'ref')}`);
console.log(`  optimum was a MIX of >1 type in ${clean.filter((r) => r.refMixSize > 1).length}/${clean.length} cases`);
console.log(`  knapsack matched the optimum exactly in ${clean.filter((r) => r.knapsack >= r.ref - 1e-9).length}/${clean.length}`);

console.log(`\nTIER 2 (vs singles = 100%)`);
console.log(`  mean vs singles     greedy ${meanPct(t2, 'greedy', 'singles')}   knapsack ${meanPct(t2, 'knapsack', 'singles')}`);
console.log(`  knapsack beat singles in ${t2.filter((r) => r.knapsack > r.singles * 1.0001).length}/${t2.length}, lost in ${t2.filter((r) => r.knapsack < r.singles * 0.9999).length}/${t2.length}`);
console.log(`  knapsack proposed >1 component type in ${t2.filter((r) => r.mixSize > 1).length}/${t2.length}`);
console.log(`  knapsack cost: ${Math.max(...t2.map((r) => r.knaNests))} nests worst case, ${Math.max(...t2.map((r) => r.knaMs))}ms worst case`);
