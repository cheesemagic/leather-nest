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

export function rankMatches(skins) {
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
        pairs.push({
          skinAId: a.id,
          skinBId: b.id,
          scaleDifferenceMm: scaleDifferenceMm(a, b),
          spectrumCorrelation: spectrumCorrelation(a.radialSpectrum, b.radialSpectrum),
        });
      }
    }
    pairs.sort((x, y) => x.scaleDifferenceMm - y.scaleDifferenceMm);
    result.push({ species, pairs });
  }
  return result;
}
