import { boundingBox, placedPolygon, polygonToSVGPoints } from '../nesting/geometry.js';

// LightBurn groups imported vectors into layers by stroke colour. The cuts
// and the registration outline MUST stay different colours: one colour means
// one layer, and the laser would fire around the hide perimeter. Exported so
// a test can assert they never collapse into the same value.
export const CUT_COLOR = '#FF0000';
export const OUTLINE_COLOR = '#0000FF';

export function exportToSVG(sheetPolygon, placements, parts) {
  const bounds = boundingBox(sheetPolygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  const polygonsMarkup = placements
    .map((placement) => {
      const part = partsById.get(placement.id);
      const absolute = placedPolygon(part, placement);
      return `  <polygon points="${polygonToSVGPoints(absolute)}" stroke="${CUT_COLOR}" stroke-width="0.01" fill="none" />`;
    })
    .join('\n');

  // The hide outline goes in first, in its own colour, so the operator can
  // line the offcut up on the bed. It is a reference, never a cut path.
  const outlineMarkup = `  <polygon points="${polygonToSVGPoints(sheetPolygon)}" stroke="${OUTLINE_COLOR}" stroke-width="0.01" fill="none" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
  <!-- ${OUTLINE_COLOR} is the hide outline, for positioning only. Set that
       layer to Tool (no output) in LightBurn before running the job.
       ${CUT_COLOR} is the cut path. -->
${outlineMarkup}
${polygonsMarkup}
</svg>`;
}
