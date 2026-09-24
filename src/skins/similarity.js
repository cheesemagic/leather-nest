export function scaleDifferenceMm(a, b) {
  return Math.abs(a.dominantWavelengthMm - b.dominantWavelengthMm);
}

export function spectrumCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  const meanA = a.slice(0, n).reduce((sum, v) => sum + v, 0) / n;
  const meanB = b.slice(0, n).reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let sumSqA = 0;
  let sumSqB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    sumSqA += da * da;
    sumSqB += db * db;
  }

  const denominator = Math.sqrt(sumSqA) * Math.sqrt(sumSqB);
  return denominator > 0 ? numerator / denominator : 0;
}

// Hue/chroma only, never lightness -- lightness tracks a photo's exposure
// and glare far more than it tracks the dye (measured on two real photos of
// the same offcut under different light: lightness swung by ~20, hue held
// within ~1-2). See docs/superpowers/specs/2026-09-22-products-design.md.
export function colourDifference(a, b) {
  return Math.hypot(a.colourA - b.colourA, a.colourB - b.colourB);
}

export function rankMatches(skins) {
  skins = skins.filter((s) => s.dominantWavelengthMm != null);

  const groups = new Map();
  for (const skin of skins) {
    const key = skin.species.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(skin);
  }

  const result = [];
  for (const [species, group] of groups) {
    const pairs = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const bothHaveColour = a.colourA != null && a.colourB != null && b.colourA != null && b.colourB != null;
        pairs.push({
          skinAId: a.id,
          skinBId: b.id,
          scaleDifferenceMm: scaleDifferenceMm(a, b),
          spectrumCorrelation: spectrumCorrelation(a.radialSpectrum, b.radialSpectrum),
          colourDifference: bothHaveColour ? colourDifference(a, b) : null,
        });
      }
    }
    // Scale and colour both matter for a matched pair -- neither dominates.
    // Combined by RANK POSITION rather than raw magnitude, because
    // millimetres and LAB units aren't convertible into one another without
    // real calibration data (which doesn't exist yet): "2nd-closest on
    // scale, 1st-closest on colour" needs no conversion, a weighted sum of
    // "4.2mm" and "11.3 LAB units" would need an invented one.
    const withColour = pairs.filter((p) => p.colourDifference != null);
    const withoutColour = pairs.filter((p) => p.colourDifference == null);

    const byScale = [...withColour].sort((x, y) => x.scaleDifferenceMm - y.scaleDifferenceMm);
    const byColour = [...withColour].sort((x, y) => x.colourDifference - y.colourDifference);
    const scaleRank = new Map(byScale.map((p, i) => [p, i]));
    const colourRank = new Map(byColour.map((p, i) => [p, i]));
    withColour.sort(
      (x, y) => scaleRank.get(x) + colourRank.get(x) - (scaleRank.get(y) + colourRank.get(y))
    );

    // A pair missing colour on either side (an older skin, captured before
    // this) can't be judged on it at all, so it falls back to scale alone
    // and sorts after every pair that could be fully judged.
    withoutColour.sort((x, y) => x.scaleDifferenceMm - y.scaleDifferenceMm);

    result.push({ species, pairs: [...withColour, ...withoutColour] });
  }
  return result;
}
