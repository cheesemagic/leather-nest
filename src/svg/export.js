import { boundingBox, placedPolygon, polygonToSVGPoints } from '../nesting/geometry.js';

export function exportToSVG(sheetPolygon, placements, parts) {
  const bounds = boundingBox(sheetPolygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  const polygonsMarkup = placements
    .map((placement) => {
      const part = partsById.get(placement.id);
      const absolute = placedPolygon(part, placement);
      return `  <polygon points="${polygonToSVGPoints(absolute)}" stroke="#FF0000" stroke-width="0.01" fill="none" />`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
${polygonsMarkup}
</svg>`;
}
