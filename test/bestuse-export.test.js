// test/bestuse-export.test.js
// The Find Best Use page turns a scored candidate into a cuttable SVG by
// mapping each placement id back to the component it came from. That mapping
// lives in browser code with no tests, so the contract it depends on is
// pinned here: componentIdOf() must round-trip every placement the nester
// returns, or the export silently writes a file full of undefined points.
import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

globalThis.ClipperLib = ClipperLib;

import { evaluateCandidate, componentIdOf } from '../src/bestuse/evaluate.js';
import { exportToSVG, CUT_COLOR, OUTLINE_COLOR } from '../src/svg/export.js';

const OUTLINE = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const HIDE = {
  id: 'h1', label: 'Test hide', species: 'python', thicknessMm: 1.8,
  outlinePolygon: OUTLINE, remainingAreaPct: 100,
};

function rect(w, h) {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}
function comp(id, w, h) {
  return {
    id, name: id, polygon: rect(w, h), allowedSpecies: null,
    thicknessMinMm: null, thicknessMaxMm: null, valuePerPiece: 10,
    demand: 0, allowedRotations: [0], dieClearanceMm: null,
  };
}

// The exact rebuild src/find-best-use-app.js performs on Confirm & Export.
function partsForExport(result, components) {
  return result.placements.map((placement) => ({
    id: placement.id,
    polygon: components.find((c) => c.id === componentIdOf(placement.id))?.polygon,
  }));
}

test('componentIdOf maps every placement back to a real component', () => {
  const components = [comp('strap', 60, 20), comp('keeper', 20, 10)];
  const candidate = {
    candidateId: 'c1', mode: 'explicit',
    items: components.map((component) => ({ component, quantity: 3, unverified: [] })),
  };
  const result = evaluateCandidate(HIDE, candidate);

  assert.ok(result.placements.length > 0, 'expected the fixture to place something');
  for (const placement of result.placements) {
    const id = componentIdOf(placement.id);
    assert.ok(
      components.some((c) => c.id === id),
      `placement ${placement.id} mapped to unknown component ${id}`
    );
  }
});

test('the exported SVG has one polygon per placement and no undefined points', () => {
  const components = [comp('strap', 60, 20), comp('keeper', 20, 10)];
  const candidate = {
    candidateId: 'c1', mode: 'explicit',
    items: components.map((component) => ({ component, quantity: 3, unverified: [] })),
  };
  const result = evaluateCandidate(HIDE, candidate);
  const svg = exportToSVG(HIDE.outlinePolygon, result.placements, partsForExport(result, components));

  // One polygon per placement, plus the hide outline drawn for registration.
  const polygonCount = svg.match(/<polygon /g)?.length ?? 0;
  assert.equal(polygonCount, result.placements.length + 1);
  assert.ok(!svg.includes('undefined'), 'export wrote undefined coordinates');
  assert.ok(!svg.includes('NaN'), 'export wrote NaN coordinates');
  assert.match(svg, /width="200mm" height="100mm"/);
});

test('a component id containing a # still round-trips', () => {
  // componentIdOf splits on the LAST '#', so an id carrying one of its own
  // must survive. Part names come from operator input, so this is reachable.
  const components = [comp('strap#2', 60, 20)];
  const candidate = {
    candidateId: 'c1', mode: 'explicit',
    items: [{ component: components[0], quantity: 2, unverified: [] }],
  };
  const result = evaluateCandidate(HIDE, candidate);

  assert.ok(result.placements.length > 0);
  for (const placement of result.placements) {
    assert.equal(componentIdOf(placement.id), 'strap#2');
  }
  const svg = exportToSVG(HIDE.outlinePolygon, result.placements, partsForExport(result, components));
  assert.ok(!svg.includes('undefined'));
});

test('the registration outline is a different colour from the cut paths', () => {
  // LightBurn layers ARE stroke colours. Collapse these two and the laser
  // cuts the hide perimeter, so this is a safety property, not a style one.
  assert.notEqual(CUT_COLOR, OUTLINE_COLOR);

  const components = [comp('strap', 60, 20)];
  const candidate = {
    candidateId: 'c1', mode: 'explicit',
    items: [{ component: components[0], quantity: 2, unverified: [] }],
  };
  const result = evaluateCandidate(HIDE, candidate);
  const svg = exportToSVG(HIDE.outlinePolygon, result.placements, partsForExport(result, components));

  // The outline is the hide, at full size, on its own colour.
  assert.equal(svg.match(new RegExp(`stroke="${OUTLINE_COLOR}"`, 'g')).length, 1);
  assert.equal(
    svg.match(new RegExp(`stroke="${CUT_COLOR}"`, 'g')).length,
    result.placements.length
  );
  assert.match(svg, /points="0,0 200,0 200,100 0,100" stroke="#0000FF"/);
});
