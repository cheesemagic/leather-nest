import {
  boundingBox,
  placedPolygon,
  polygonToSVGPoints,
  inflatePolygon,
} from '../nesting/geometry.js';
import { kerfAllowanceMm } from '../nesting/clearance.js';

// LightBurn groups imported vectors into layers by stroke colour. The cuts
// and the registration outline MUST stay different colours: one colour means
// one layer, and the laser would fire around the hide perimeter. Exported so
// a test can assert they never collapse into the same value.
export const CUT_COLOR = '#FF0000';
export const OUTLINE_COLOR = '#0000FF';

export function exportToSVG(sheetPolygon, placements, parts, options = {}) {
  const bounds = boundingBox(sheetPolygon);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const partsById = new Map(parts.map((p) => [p.id, p]));

  // The beam destroys material as it goes, so cutting exactly on the drawn
  // line returns a piece that is half a kerf undersize all the way round.
  // Moving the cut outward by that much means what is LEFT after the burn is
  // the size that was drawn. Zero by default — see DEFAULT_KERF_MM.
  const kerf = kerfAllowanceMm(options);

  const polygonsMarkup = placements
    .map((placement) => {
      const part = partsById.get(placement.id);
      const absolute = placedPolygon(part, placement);
      const cutLine = kerf > 0 ? inflatePolygon(absolute, kerf) : absolute;
      return `  <polygon points="${polygonToSVGPoints(cutLine)}" stroke="${CUT_COLOR}" stroke-width="0.01" fill="none" />`;
    })
    .join('\n');

  // The hide outline goes in first, in its own colour, so the operator can
  // line the offcut up on the bed. It is a reference, never a cut path.
  const outlineMarkup = `  <polygon points="${polygonToSVGPoints(sheetPolygon)}" stroke="${OUTLINE_COLOR}" stroke-width="0.01" fill="none" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">
  <!-- ${OUTLINE_COLOR} is the hide outline, for positioning only. It must be
       set to no-output before running, or the laser will trace the edge of
       the leather. ${CUT_COLOR} is the cut path.${
         kerf > 0 ? ` Cut lines are offset ${kerf.toFixed(3)}mm outward to compensate for kerf.` : ''
       } -->
${outlineMarkup}
${polygonsMarkup}
</svg>`;
}
