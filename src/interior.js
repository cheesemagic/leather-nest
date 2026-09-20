import { pointInPolygon, polygonArea } from './nesting/geometry.js';

// Everything a component needs cut, scored or marked INSIDE its own outline:
// punch holes, stitch guides, fringe slits, etched line art.
//
// A component has always been one closed outline and nothing else, which is
// why the SVG importer refuses a file with more than one path — it has
// nowhere to put the second one and will not guess. This is the
// representation that was missing. It does not solve the other half: given a
// file with five paths, deciding which is the outline, which is a hole and
// which is a stitch guide still needs either the operator or a convention,
// and guessing wrong means cutting a stitch line straight through a piece.

// What the machine should do with a line. The operator assigns real power and
// speed per layer at the machine; the file only has to keep them apart.
export const INTERIOR_KINDS = {
  // All the way through. Punch holes, fringe slits.
  cut: { closedMeans: 'hole', throughCut: true },
  // Part depth. Fold lines, decorative grooves.
  score: { closedMeans: 'groove', throughCut: false },
  // Surface only. Stitch guides, etched line art.
  mark: { closedMeans: 'outline', throughCut: false },
};

export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(INTERIOR_KINDS, kind);
}

// Checks interior paths against the outline they belong to.
//
// Returns a list of problems rather than throwing on the first, because a
// die imported with four bad paths should report four, not send the operator
// round the loop four times.
export function validateInteriorPaths(polygon, paths) {
  const problems = [];
  if (!Array.isArray(paths)) return ['Interior paths must be a list.'];
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return ['The component has no outline to put interior cuts inside.'];
  }

  paths.forEach((path, index) => {
    const where = `Interior path ${index + 1}`;
    if (!path || typeof path !== 'object') {
      problems.push(`${where} is not a path.`);
      return;
    }
    if (!isKnownKind(path.kind)) {
      problems.push(
        `${where} has kind ${JSON.stringify(path.kind)}; expected one of: ` +
          `${Object.keys(INTERIOR_KINDS).join(', ')}.`
      );
    }
    const points = path.points;
    if (!Array.isArray(points) || points.length < 2) {
      problems.push(`${where} needs at least two points.`);
      return;
    }
    if (path.closed && points.length < 3) {
      problems.push(`${where} is closed but has only ${points.length} points.`);
    }
    if (!points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
      problems.push(`${where} has a point that is not a real coordinate.`);
      return;
    }
    // Every point must lie within the outline. A cut outside the piece is a
    // cut through whatever leather happens to be next to it.
    //
    // pointInPolygon, not polygonContains: the latter takes a whole part and
    // treats a single point as degenerate, returning false — which would
    // reject every interior path ever written. It also counts the boundary as
    // inside, which matters for fringe slits that start on the edge.
    const outside = points.filter((point) => !pointInPolygon(point, polygon));
    if (outside.length) {
      problems.push(
        `${where} has ${outside.length} point(s) outside the component outline.`
      );
    }
  });

  return problems;
}

// How much leather a closed cut actually removes from the piece. Not used for
// nesting — a piece with a hole still OCCUPIES its full outline on the hide,
// and the hole is waste trapped inside it, so the space it takes up is
// unchanged. This is for telling the operator what they are really getting.
export function holeAreaMm2(paths = []) {
  return paths
    .filter((path) => path.kind === 'cut' && path.closed)
    .reduce((total, path) => total + polygonArea(path.points), 0);
}
