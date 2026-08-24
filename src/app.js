import { nest } from './nesting/index.js';
import { boundingBox, placedPolygon, polygonToSVGPoints } from './nesting/geometry.js';
import { parseSVGPolygon } from './svg/parse.js';
import { exportToSVG } from './svg/export.js';

const sheet = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

const parts = [
  {
    id: 'A',
    polygon: parseSVGPolygon('<polygon points="0,0 40,0 40,20 0,20" />'),
    allowedRotations: [0, 180],
  },
  {
    id: 'B',
    polygon: parseSVGPolygon('<polygon points="0,0 30,0 30,50 0,50" />'),
    allowedRotations: [0, 180],
  },
];

const result = nest(sheet, parts);
const partsById = new Map(parts.map((p) => [p.id, p]));

function renderPreview(sheetPolygon, placements) {
  const bounds = boundingBox(sheetPolygon);
  const sheetMarkup = `<polygon points="${polygonToSVGPoints(sheetPolygon)}" stroke="#000000" stroke-width="0.5" fill="none" />`;
  const partsMarkup = placements
    .map((placement) => {
      const part = partsById.get(placement.id);
      const absolute = placedPolygon(part, placement);
      return `<polygon points="${polygonToSVGPoints(absolute)}" stroke="#FF0000" stroke-width="0.5" fill="none" />`;
    })
    .join('');
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return `<svg width="500" height="${(500 * height) / width}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">${sheetMarkup}${partsMarkup}</svg>`;
}

const previewEl = document.getElementById('preview');

if (result.noFit.length > 0) {
  previewEl.textContent = `Does not fit: ${result.noFit.join(', ')}`;
} else {
  previewEl.innerHTML = renderPreview(sheet, result.placements);
}

document.getElementById('export-btn').addEventListener('click', () => {
  const svgContent = exportToSVG(sheet, result.placements, parts);
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nested-parts.svg';
  a.click();
  URL.revokeObjectURL(url);
});
