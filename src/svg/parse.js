export function parseSVGPolygon(svgString) {
  const match = svgString.match(/points\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('No <polygon points="..."> found in SVG string');
  }
  return match[1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
}
