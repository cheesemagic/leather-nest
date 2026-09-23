import {
  boundingBox,
  placedPolygon,
  polygonToSVGPoints,
  inflatePolygon,
  deflatePolygon,
  placedPoints,
} from '../nesting/geometry.js';
import { kerfAllowanceMm } from '../nesting/clearance.js';
import { orderForHeat, sortInteriorPaths } from '../cut-order.js';

// LightBurn groups imported vectors into layers by stroke colour. The cuts
// and the registration outline MUST stay different colours: one colour means
// one layer, and the laser would fire around the hide perimeter. Exported so
// a test can assert they never collapse into the same value.
export const CUT_COLOR = '#FF0000';
export const OUTLINE_COLOR = '#0000FF';

// One colour per operation, because that is the only thing a laser file can
// say about intent — the operator maps colour to power and speed at the
// machine. Interior cuts share CUT_COLOR with the outline: both go all the
// way through, and the difference between them is not the machine's problem.
// How thick the lines are DRAWN. Nothing about cutting depends on this —
// laser software reads the path and takes power and speed from the layer the
// colour maps to, ignoring stroke width entirely. It matters only to the
// person opening the file to check it.
//
// It was 0.01mm, chosen to mean "hairline". On a real job that came out
// 1/82,000th of the drawing's width — 0.012 of a pixel on screen — so the
// file opened as a blank white page with 841 shapes invisibly in it. Scaled
// to the drawing instead, a line is always about the same thickness on
// screen whether the job is a 50mm part or a metre of hide.
const STROKE_DIVISOR = 600;

const strokeWidthFor = (width, height) =>
  (Math.max(width, height) / STROKE_DIVISOR).toFixed(4);

export const INTERIOR_COLORS = {
  cut: CUT_COLOR,
  score: '#00A000',
  mark: '#FF00FF',
};

function interiorMarkup(part, placement, kerf, stroke) {
  const paths = sortInteriorPaths(part.interiorPaths ?? []);
  if (!paths.length) return '';

  const lines = [];
  for (const path of paths) {
    const colour = INTERIOR_COLORS[path.kind] ?? CUT_COLOR;
    let points = placedPoints(part, placement, path.points);

    // Kerf runs the OTHER WAY inside a hole. The beam eats the edge of
    // whatever it follows, so to leave a correctly sized hole the cut goes
    // INSIDE the hole's line, where cutting the outline goes outside it.
    // Getting this backwards makes every hole a full kerf too big.
    if (kerf > 0 && path.kind === 'cut' && path.closed) {
      const shrunk = deflatePolygon(points, kerf);
      // A hole too small to survive the beam is dropped rather than cut at
      // full size — a 0.4mm hole with a 0.3mm kerf is not a hole.
      if (!shrunk) continue;
      points = shrunk;
    }

    if (path.closed) {
      lines.push(
        `  <polygon points="${polygonToSVGPoints(points)}" stroke="${colour}" stroke-width="${stroke}" fill="none" />`
      );
    } else {
      const d = points
        .map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x},${point.y}`)
        .join(' ');
      lines.push(`  <path d="${d}" stroke="${colour}" stroke-width="${stroke}" fill="none" />`);
    }
  }
  return lines.join('\n');
}

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
  const stroke = strokeWidthFor(width, height);

  // Spread consecutive cuts apart so heat has somewhere to go. Laser software
  // follows file order unless its own optimiser is on, so this is ours to set.
  const positioned = placements.map((placement) => {
    const part = partsById.get(placement.id);
    const absolute = placedPolygon(part, placement);
    const bounds = boundingBox(absolute);
    return {
      placement,
      part,
      absolute,
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  });

  const polygonsMarkup = orderForHeat(positioned, options)
    .map(({ placement, part, absolute }) => {
      const cutLine = kerf > 0 ? inflatePolygon(absolute, kerf) : absolute;
      const outer = `  <polygon points="${polygonToSVGPoints(cutLine)}" stroke="${CUT_COLOR}" stroke-width="${stroke}" fill="none" />`;
      // Interior first, outline last: cutting the outline frees the piece,
      // and anything cut after that goes into something loose enough to shift.
      const interior = interiorMarkup(part, placement, kerf, stroke);
      return interior ? `${interior}\n${outer}` : outer;
    })
    .join('\n');

  // The hide outline goes in first, in its own colour, so the operator can
  // line the offcut up on the bed. It is a reference, never a cut path.
  const outlineMarkup = `  <polygon points="${polygonToSVGPoints(sheetPolygon)}" stroke="${OUTLINE_COLOR}" stroke-width="${stroke}" fill="none" />`;

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
