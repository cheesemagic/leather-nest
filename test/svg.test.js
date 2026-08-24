import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSVGPolygon } from '../src/svg/parse.js';
import { exportToSVG } from '../src/svg/export.js';

test('parseSVGPolygon extracts points from a <polygon> element', () => {
  const svg = '<polygon points="0,0 40,0 40,20 0,20" />';
  const polygon = parseSVGPolygon(svg);
  assert.deepEqual(polygon, [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ]);
});

test('parseSVGPolygon throws a clear error when no points attribute is found', () => {
  assert.throws(() => parseSVGPolygon('<rect width="10" height="10" />'), /No <polygon points/);
});

test('exportToSVG renders placements as red hairline-stroke polygons sized to the sheet', () => {
  const sheet = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const parts = [
    {
      id: 'A',
      polygon: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }],
      allowedRotations: [0, 180],
    },
  ];
  const placements = [{ id: 'A', x: 5, y: 5, rotation: 0 }];

  const svg = exportToSVG(sheet, placements, parts);

  assert.match(svg, /width="100mm"/);
  assert.match(svg, /height="60mm"/);
  assert.match(svg, /stroke="#FF0000"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /points="5,5 45,5 45,25 5,25"/);
});
