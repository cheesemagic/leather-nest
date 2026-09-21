import { CUT_COLOR } from './svg/export.js';
import { kerfAllowanceMm } from './nesting/clearance.js';

// A fringed strip: a rectangle with a row of parallel slits cut in from one
// edge, stopping short of the far side so the piece stays in one part and the
// strands hang off a solid band.
//
// Standalone on purpose. Fringe does not need the nester — a fringed strip
// comes off a long straight offcut, where there is nothing to nest around —
// and a component here is a single closed outline with no way to carry slits
// inside it. Rather than bend that model before anyone has cut fringe, this
// generates the file directly. What it teaches about interior cuts should
// inform the data model later, not the other way round.

export const DEFAULT_STRAND_WIDTH_MM = 5;
export const DEFAULT_HEADER_MM = 15;

// The slits stop this far short of the strip's ends, so the outer strands do
// not fall off. Zero would make the first and last cut run along the edge.
export const DEFAULT_MARGIN_MM = 3;

function fail(message) {
  throw new Error(message);
}

// Positions of every slit, measured from the left edge of the strip.
//
// Returned separately from the markup because the spacing rule is the part
// worth checking: strands must come out even, and the outer two must be full
// width rather than whatever remainder was left over.
export function slitPositions({
  lengthMm,
  strandWidthMm = DEFAULT_STRAND_WIDTH_MM,
  marginMm = DEFAULT_MARGIN_MM,
}) {
  if (!(lengthMm > 0)) fail('Strip length must be greater than zero.');
  if (!(strandWidthMm > 0)) fail('Strand width must be greater than zero.');
  if (marginMm < 0) fail('Margin cannot be negative.');

  const usable = lengthMm - 2 * marginMm;
  if (usable <= 0) {
    fail(`A ${lengthMm}mm strip has no room for fringe once ${marginMm}mm margins are taken off each end.`);
  }

  // Round to whole strands and spread the rounding error across all of them,
  // so every strand is the same width and the pattern stays symmetric. Taking
  // the remainder off one end instead leaves a runt strand at the edge, which
  // is where it is most visible and most likely to tear.
  const strandCount = Math.max(1, Math.round(usable / strandWidthMm));
  const actualStrandWidth = usable / strandCount;

  // One slit BETWEEN each pair of strands: n strands need n-1 cuts. The strip
  // edges do the outer two, which is why a margin exists at all.
  const positions = [];
  for (let i = 1; i < strandCount; i++) {
    positions.push(marginMm + i * actualStrandWidth);
  }
  return { positions, strandCount, actualStrandWidth };
}

// The whole strip: outline, slits, and the numbers behind them.
export function fringedStrip({
  lengthMm,
  widthMm,
  fringeDepthMm,
  strandWidthMm = DEFAULT_STRAND_WIDTH_MM,
  marginMm = DEFAULT_MARGIN_MM,
  kerfMm = 0,
}) {
  if (!(widthMm > 0)) fail('Strip width must be greater than zero.');
  if (!(fringeDepthMm > 0)) fail('Fringe depth must be greater than zero.');
  if (fringeDepthMm >= widthMm) {
    fail(
      `Fringe depth (${fringeDepthMm}mm) must be less than the strip width (${widthMm}mm), ` +
        'or the slits cut the strip into separate pieces instead of fringe.'
    );
  }

  const { positions, strandCount, actualStrandWidth } = slitPositions({
    lengthMm,
    strandWidthMm,
    marginMm,
  });

  const kerf = kerfAllowanceMm({ method: 'laser', kerfMm });
  // The beam widens every slit by a full kerf, so each strand loses half a
  // kerf from each side. Reporting the finished width rather than the drawn
  // one matters here: on 5mm strands a 0.3mm kerf is 6% of the strand.
  const finishedStrandWidthMm = actualStrandWidth - 2 * kerf;

  return {
    lengthMm,
    widthMm,
    fringeDepthMm,
    strandCount,
    // What the program drew.
    strandWidthMm: actualStrandWidth,
    // What comes off the bed once the beam has taken its share.
    finishedStrandWidthMm,
    headerMm: widthMm - fringeDepthMm,
    slitPositions: positions,
  };
}

// The cut file. Slits and outline share the cut colour because both go all
// the way through — the difference between them is only where they stop.
export function fringeToSVG(strip) {
  const { lengthMm, widthMm, fringeDepthMm, slitPositions: positions } = strip;
  // Drawn thickness only — the laser ignores it. A fixed hairline renders as
  // a blank page on a large job; scaled to the drawing it is always visible.
  const stroke = (Math.max(lengthMm, widthMm) / 600).toFixed(4);

  const outline =
    `  <polygon points="0,0 ${lengthMm},0 ${lengthMm},${widthMm} 0,${widthMm}" ` +
    `stroke="${CUT_COLOR}" stroke-width="${stroke}" fill="none" />`;

  // Each slit runs up from the bottom edge and stops at the header, leaving
  // the strip in one piece.
  const slits = positions
    .map(
      (x) =>
        `  <line x1="${x}" y1="${widthMm}" x2="${x}" y2="${widthMm - fringeDepthMm}" ` +
        `stroke="${CUT_COLOR}" stroke-width="${stroke}" />`
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lengthMm}mm" height="${widthMm}mm" viewBox="0 0 ${lengthMm} ${widthMm}">
  <!-- Fringed strip: ${strip.strandCount} strands at ${strip.finishedStrandWidthMm.toFixed(2)}mm finished,
       ${fringeDepthMm}mm deep, on a ${strip.headerMm}mm solid header.
       ${CUT_COLOR} cuts through. The slits stop short of the top edge on purpose. -->
${outline}
${slits}
</svg>`;
}
