// THROWAWAY. Re-runs the C3 spike's key comparisons against IRREGULAR
// components instead of rectangles, closing the gap the original findings
// doc named as its biggest hole: "every fixture is a rectangle, and
// irregular parts interlock in ways rectangles can't."
//
// Shapes are HAND-TRACED APPROXIMATIONS of real dies the user photographed
// (concave notches, a curved bow strip, wavy-sided panels, a pinched
// hourglass, a tapered paddle tab, a zigzag tree) — not exact vector data,
// and deliberately holes-free: several of the real dies have small interior
// holes, which component.polygon cannot represent yet (see the "hole
// support" open item in memory). This tests concavity/curvature, not holes.
//
// Also exercises src/svg/parse.js's new <path> support end to end: every
// shape below is written as an SVG path `d` string and imported the same
// way a real die upload would be.
//
//   node scripts/c3-spike-irregular.mjs
import ClipperLib from 'clipper-lib';
globalThis.ClipperLib = ClipperLib;

import { parseSVGPolygon } from '../src/svg/parse.js';
import { filterEligible } from '../src/bestuse/eligibility.js';
import { generateCandidates } from '../src/bestuse/candidates.js';
import { evaluateCandidate } from '../src/bestuse/evaluate.js';
import { rankCandidates } from '../src/bestuse/ranking.js';
import { footprintArea, PACKING_EFFICIENCY, ASK_EFFICIENCY } from '../src/bestuse/estimate.js';
import { polygonArea, boundingBox } from '../src/nesting/geometry.js';

// Coarser than the app default (5mm): these fixtures carry 5-10x the vertex
// count of the rectangle fixtures, and this script only needs directional
// signal, not production fidelity.
const NEST_OPTS = { method: 'laser', laserClearanceMm: 1.0, gridStepMm: 15 };
const path = (d) => `<svg><path d="${d}" /></svg>`;

// ------------------------------------------------------ traced die shapes

// Every shape below is a polyline, not an arc/curve — real dies are usually
// digitized then simplified before nesting (a photo trace or contour-approx
// step reduces vertex count), and a first attempt using A/Q curves here
// measured a single 24-piece mixed nest at 35 SECONDS: NFP cost between two
// already-placed concave parts scales with the product of their vertex
// counts, and 50-120-point curve-flattened polygons made every placement
// after the first pay that. This is itself a real finding, reported below,
// not just a workaround.
const SHAPES = {
  // Dome top with a rectangular notch cut up into the bottom edge — traced
  // from the first die photographed (dome + pinched tab at the base).
  domeNotch:
    'M 5,80 L 5,35 L 15,15 L 35,3 L 55,3 L 75,15 L 85,35 L 85,80 ' +
    'L 55,80 L 55,62 L 35,62 L 35,80 Z',
  // The long curved bow/crescent strip.
  bowStrip: 'M 0,10 L 40,-4 L 110,-4 L 150,10 L 150,22 L 110,8 L 40,8 L 0,22 Z',
  // A wavy-sided panel, from the assorted board of card-slot/wallet-panel dies.
  wavyPanel: 'M 8,0 L 2,14 L 8,28 L 2,42 L 8,55 L 82,55 L 88,42 L 82,28 L 88,14 L 82,0 Z',
  // Pinched-waist hourglass keychain fob — HOLES OMITTED, outline only.
  // A first attempt used cubics that re-crossed the waist point, winding the
  // two lobes in opposite directions; the shoelace formula then cancelled
  // them to ~7mm^2 of "area" on an 86mm-tall shape. Straight-line stations,
  // each side strictly monotonic in y, avoid the self-intersection entirely.
  hourglass:
    'M 23,0 L 43,10 L 38,20 L 26,43 L 38,66 L 43,76 L 23,86 ' +
    'L 3,76 L 8,66 L 20,43 L 8,20 L 3,10 Z',
  // Tapered paddle/guitar-pick keychain tab (real stated size 12.5x3.7cm).
  // Straight tapers rather than curves, both for a lower vertex count and
  // because the real X10 photos show mostly straight-edge tapers.
  paddleTab: 'M 18,0 L 37,16 L 34,80 L 26,120 L 18,125 L 10,120 L 3,80 L 0,16 Z',
  // Zigzag tree-silhouette die, deeply concave branch notches.
  treeNotch: 'M 30,0 L 45,20 L 35,20 L 55,45 L 42,45 L 60,70 L 0,70 L 18,45 L 5,45 L 25,20 L 15,20 Z',
};

console.log('Importing traced shapes through parseSVGPolygon (real <path> import)...\n');
const polygons = {};
for (const [name, d] of Object.entries(SHAPES)) {
  const polygon = parseSVGPolygon(path(d));
  const bounds = boundingBox(polygon);
  const area = polygonArea(polygon);
  const bboxArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  polygons[name] = polygon;
  console.log(
    `  ${name.padEnd(12)} ${polygon.length} pts  ` +
      `${(bounds.maxX - bounds.minX).toFixed(0)}x${(bounds.maxY - bounds.minY).toFixed(0)}mm  ` +
      `area ${area.toFixed(0)}mm^2  fill ${((area / bboxArea) * 100).toFixed(0)}% of bbox`
  );
}

function comp(id, name, polygon, valuePerPiece, demand) {
  return {
    id, name, polygon, valuePerPiece, demand,
    allowedSpecies: null, thicknessMinMm: null, thicknessMaxMm: null,
    allowedRotations: [0, 90, 180, 270], dieClearanceMm: null,
  };
}

// Small demand numbers on purpose: place() re-computes an NFP for every
// piece against a 50-125 vertex part, and the point of this script is
// concavity/curvature signal, not stress-testing volume the app has already
// measured (that was C1's job, on simple rectangles).
const COMPONENTS = [
  comp('dome', 'dome+notch die', polygons.domeNotch, 45, 3),
  comp('bow', 'bow strip die', polygons.bowStrip, 18, 4),
  comp('wavy', 'wavy panel die', polygons.wavyPanel, 28, 3),
  comp('hourglass', 'hourglass fob die', polygons.hourglass, 12, 6),
  comp('paddle', 'paddle tab die', polygons.paddleTab, 22, 4),
  comp('tree', 'tree die', polygons.treeNotch, 15, 4),
];

// Same four hide outlines as the original spike, for direct comparability.
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const HIDES = [
  { id: 'rect', label: 'Rectangle', outlinePolygon: rect(400, 300) },
  {
    id: 'notch', label: 'Deep notch',
    outlinePolygon: [
      { x: 0, y: 0 }, { x: 430, y: 0 }, { x: 430, y: 300 }, { x: 250, y: 300 },
      { x: 250, y: 90 }, { x: 190, y: 90 }, { x: 190, y: 300 }, { x: 0, y: 300 },
    ],
  },
].map((h) => ({ ...h, species: 'python', thicknessMm: 1.8, remainingAreaPct: 100 }));

// ------------------------------------------------------ shared machinery
// (reduced copy of c3-spike.mjs's greedy/knapsack — same algorithms, so the
// comparison to the rectangle-fixture results is apples to apples)

const scoreOf = (r, s) => (s === 'value' ? r.value : s === 'utilization' ? r.utilization : r.demandSatisfied);
const perPieceScore = (c, s) => (s === 'value' ? c.valuePerPiece ?? 0 : s === 'utilization' ? polygonArea(c.polygon) : 1);

let nestCount = 0;
function nest(hide, quantities, components, id) {
  nestCount++;
  const items = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([cid, quantity]) => ({ component: components.find((c) => c.id === cid), quantity, unverified: [] }));
  return evaluateCandidate(hide, { candidateId: id, mode: 'mix', items }, NEST_OPTS);
}

function greedy(hide, eligible, components, strategy) {
  let remaining = polygonArea(hide.outlinePolygon) * PACKING_EFFICIENCY;
  const density = (c) => perPieceScore(c, strategy) / footprintArea(c);
  const quantities = {};
  for (const entry of [...eligible].sort((a, b) => density(b.component) - density(a.component))) {
    const fp = footprintArea(entry.component);
    let n = Math.floor(remaining / fp);
    if (strategy === 'demand') n = Math.min(n, entry.component.demand ?? 0);
    if (n > 0) { quantities[entry.component.id] = n; remaining -= n * fp; }
  }
  return Object.keys(quantities).length ? { result: nest(hide, quantities, components, 'greedy') } : null;
}

const EFFICIENCIES = [0.6, 0.7, 0.75, 0.85, 0.95];
const BUCKET = 25;
function knapsackMix(hide, eligible, strategy, efficiency) {
  const capacity = Math.floor((polygonArea(hide.outlinePolygon) * efficiency) / BUCKET);
  if (capacity <= 0) return null;
  const items = eligible
    .map((e) => ({
      id: e.component.id,
      weight: Math.max(1, Math.round(footprintArea(e.component) / BUCKET)),
      value: perPieceScore(e.component, strategy),
      max: strategy === 'demand' ? (e.component.demand ?? 0) : Infinity,
    }))
    .filter((it) => it.value > 0 && it.max > 0);
  if (!items.length) return null;
  const dp = new Float64Array(capacity + 1);
  const used = items.map(() => new Int32Array(capacity + 1));
  for (let w = 1; w <= capacity; w++) {
    dp[w] = dp[w - 1];
    for (let i = 0; i < items.length; i++) used[i][w] = used[i][w - 1];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.weight > w) continue;
      const prev = w - it.weight;
      if (used[i][prev] >= it.max) continue;
      const candidate = dp[prev] + it.value;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        for (let k = 0; k < items.length; k++) used[k][w] = used[k][prev];
        used[i][w] = used[i][prev] + 1;
      }
    }
  }
  const quantities = {};
  for (let i = 0; i < items.length; i++) if (used[i][capacity] > 0) quantities[items[i].id] = used[i][capacity];
  return Object.keys(quantities).length ? quantities : null;
}

function knapsack(hide, eligible, components, strategy) {
  const seen = new Set();
  let best = null;
  for (const efficiency of EFFICIENCIES) {
    const q = knapsackMix(hide, eligible, strategy, efficiency);
    if (!q) continue;
    const key = JSON.stringify(q);
    if (seen.has(key)) continue;
    seen.add(key);
    const result = nest(hide, q, components, 'knapsack');
    if (!best || scoreOf(result, strategy) > scoreOf(best.result, strategy)) best = { result, quantities: q };
  }
  return best;
}

function singlesAt(hide, eligible, strategy, askEfficiency) {
  const cands = generateCandidates('singles', eligible, { hide, strategy, askEfficiency });
  if (!cands.length) return null;
  nestCount += cands.length;
  const evaluated = cands.map((c) => evaluateCandidate(hide, c, NEST_OPTS));
  return { result: rankCandidates(evaluated, strategy)[0] };
}

const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : a > 0 ? 'n/a' : '—');
const describe = (q, components) =>
  Object.entries(q ?? {}).filter(([, n]) => n > 0)
    .map(([id, n]) => `${n}x ${components.find((c) => c.id === id)?.name.replace(' die', '')}`)
    .join(' + ') || '(none)';

// ------------------------------------------------------------------- run

console.log(`\n${'='.repeat(80)}\nsingles vs greedy vs knapsack, on IRREGULAR components\n${'='.repeat(80)}`);
const rows = [];
for (const hide of HIDES) {
  console.log(`\n## ${hide.label} — ${(polygonArea(hide.outlinePolygon) / 100).toFixed(0)} cm^2`);
  const { eligible } = filterEligible(hide, COMPONENTS);
  for (const strategy of ['value', 'utilization', 'demand']) {
    const base = singlesAt(hide, eligible, strategy, PACKING_EFFICIENCY);
    const baseline = base ? scoreOf(base.result, strategy) : 0;
    const grd = greedy(hide, eligible, COMPONENTS, strategy);
    const kna = knapsack(hide, eligible, COMPONENTS, strategy);
    const get = (r) => (r ? scoreOf(r.result, strategy) : 0);

    console.log(`\n  ${strategy}`);
    console.log(`    singles(0.75) ${pct(baseline, baseline).padStart(7)}  ${describe(null, COMPONENTS)}`);
    console.log(`    greedy        ${pct(get(grd), baseline).padStart(7)}  ${describe(grd?.result?.counts, COMPONENTS)}`);
    console.log(`    knapsack      ${pct(get(kna), baseline).padStart(7)}  ${describe(kna?.quantities, COMPONENTS)}`);
    rows.push({ hide: hide.label, strategy, baseline, greedy: get(grd), knapsack: get(kna) });
  }
}

console.log(`\n\n${'='.repeat(80)}\nachieved packing efficiency, IRREGULAR components (0.75 ceiling check)\n${'='.repeat(80)}\n`);
for (const hide of HIDES) {
  const { eligible } = filterEligible(hide, COMPONENTS);
  const best = singlesAt(hide, eligible, 'utilization', PACKING_EFFICIENCY);
  const mix = knapsack(hide, eligible, COMPONENTS, 'utilization');
  console.log(
    `  ${hide.label.padEnd(16)} best single ${best ? (best.result.utilization * 100).toFixed(1) + '%' : 'n/a'}` +
      `   best mix ${mix ? (mix.result.utilization * 100).toFixed(1) + '%' : 'n/a'}`
  );
}

console.log(`\n\n${'='.repeat(80)}\nthe over-ask test, IRREGULAR components (0.75 -> 0.95)\n${'='.repeat(80)}\n`);
for (const hide of HIDES) {
  const { eligible } = filterEligible(hide, COMPONENTS);
  const row = [];
  for (const strategy of ['value', 'utilization', 'demand']) {
    const low = singlesAt(hide, eligible, strategy, PACKING_EFFICIENCY);
    const high = singlesAt(hide, eligible, strategy, ASK_EFFICIENCY);
    const l = low ? scoreOf(low.result, strategy) : 0;
    const h = high ? scoreOf(high.result, strategy) : 0;
    row.push(`${strategy}: ${pct(h, l)}`);
  }
  console.log(`  ${hide.label.padEnd(16)} ${row.join('   ')}`);
}

console.log(`\n\n${'='.repeat(80)}\nSUMMARY (irregular components)\n${'='.repeat(80)}\n`);
const mean = (key) => {
  const vals = rows.filter((r) => r.baseline > 0).map((r) => r[key] / r.baseline);
  return vals.length ? `${((vals.reduce((a, b) => a + b, 0) / vals.length) * 100).toFixed(1)}%` : 'n/a';
};
console.log(`  mean vs singles(0.75)   greedy ${mean('greedy')}   knapsack ${mean('knapsack')}`);
console.log(`  knapsack beat singles in ${rows.filter((r) => r.knapsack > r.baseline * 1.0001).length}/${rows.length}`);
console.log(`  total nests run: ${nestCount}`);
