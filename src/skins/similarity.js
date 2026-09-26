import { ciede2000 } from './ciede2000.js';

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

// ZERO, and like DEFAULT_KERF_MM that is a statement rather than a
// placeholder: lightness is not weighted down, it is excluded, because
// nobody can measure it honestly yet. Every colour in the library is sampled
// from an uncontrolled photograph, and lightness tracks exposure and glare
// far more than dye -- measured on two real photos of the same offcut under
// different light, lightness swung by ~20 while hue held within ~1-2 (see
// docs/superpowers/specs/2026-09-22-products-design.md).
//
// Textile practice has the same instinct and de-weights lightness by half
// (CMC 2:1). Halving is for a measurement that is merely noisy; this one is
// dominated by the photograph, so it gets no vote at all.
//
// What would change it: a grey card or colour reference target in frame when
// photographing a hide, corrected for in digitize.py. That is the ~£30
// equivalent of the kerf test square, and this is the one line to move when
// it exists.
export const COLOUR_LIGHTNESS_WEIGHT = 0;

// How different two hides' colours are, as CIEDE2000 (ΔE00) -- the CIE
// standard, which unlike straight-line distance in a*/b* is weighted to track
// perception, and which comes with published tolerance bands (<1
// imperceptible, 2-3.5 practical tolerance, >5 clearly different). Those bands
// are what gives the still-open colour threshold a number to calibrate
// against instead of one to invent.
//
// colourL is passed through but cannot reach the result at weight 0 -- L
// enters the formula only via S_L, and S_L multiplies only the lightness
// term. `?? 0` therefore makes a hide with no recorded lightness safe rather
// than merely tolerable; test/ciede2000.test.js asserts that independence
// directly.
export function colourDifference(a, b) {
  return ciede2000(
    [a.colourL ?? 0, a.colourA, a.colourB],
    [b.colourL ?? 0, b.colourA, b.colourB],
    { lightnessWeight: COLOUR_LIGHTNESS_WEIGHT }
  );
}

// The attributes that decide whether two hides CAN pair at all, as opposed to
// how well they score once they do. Each one names a real, visible difference
// that no amount of scale or colour agreement can overcome:
//
//   cut     -- which part of the animal. A tail's scales and a belly's are
//              different geometry, and the supplier sells both under species
//              "caiman". The trade's own rule is the same: a pair of alligator
//              skins makes two pairs of boots, one from the matching tails and
//              one from the matching bellies.
//   finish  -- how the surface was treated. Suede is the flesh side; it does
//              not look like a glazed surface and never will. Confirmed with
//              the operator 2026-09-26: those two would never pair.
//
// Species is NOT in here, because it is the grouping key rather than a gate --
// two species never reach the same group to be compared.
export const GATING_ATTRIBUTES = ['cut', 'finish'];

// Whether two hides may pair, and which gating attributes could not be
// checked. One predicate over the whole list rather than one function per
// field: "two known different values never pair" is the rule twice now, and
// will be again if grade or origin ever lands.
//
// A pair is blocked ONLY when both sides state a value and the values differ.
// An unknown cannot rule a pair out -- it can only leave the pair unverified,
// which is what `unverified` reports and what sorts such pairs last.
export function attributesCanPair(a, b) {
  const unverified = [];
  for (const field of GATING_ATTRIBUTES) {
    const valueA = a[field] ?? null;
    const valueB = b[field] ?? null;
    if (valueA === null || valueB === null) {
      unverified.push(field);
      continue;
    }
    // No pair at all, rather than a pair ranked badly: a ranking carries no
    // warning, so a wrong pair sitting in the list is a confidently wrong
    // answer. Leaving it out is the only honest option.
    if (valueA !== valueB) return { canPair: false, unverified: [] };
  }
  return { canPair: true, unverified };
}

// The scale/colour ordering, lifted out of rankMatches() so it can be applied
// to more than one partition of pairs. Nothing in here changed when cut
// arrived -- it is the original ranking, verbatim.
function orderByScaleAndColour(pairs) {
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

  return [...withColour, ...withoutColour];
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
        // No pair at all, rather than a pair ranked badly: a ranking carries
        // no warning, so a wrong pair sitting in the list is a confidently
        // wrong answer. Leaving it out is the only honest option.
        // eligibility.js's word for "this constraint could not be checked",
        // reused rather than reinvented. Colour keeps its own existing signal
        // (colourDifference: null) instead of being folded in here -- two
        // representations of one state is how they drift apart.
        const { canPair, unverified } = attributesCanPair(a, b);
        if (!canPair) continue;

        const bothHaveColour = a.colourA != null && a.colourB != null && b.colourA != null && b.colourB != null;
        pairs.push({
          skinAId: a.id,
          skinBId: b.id,
          scaleDifferenceMm: scaleDifferenceMm(a, b),
          spectrumCorrelation: spectrumCorrelation(a.radialSpectrum, b.radialSpectrum),
          colourDifference: bothHaveColour ? colourDifference(a, b) : null,
          unverified,
        });
      }
    }

    // Two nested partitions: cut-known before cut-unknown on the outside, and
    // colour-present before colour-missing within each (that inner split lives
    // in orderByScaleAndColour). A pair missing both sorts last.
    const judged = pairs.filter((p) => p.unverified.length === 0);
    const flagged = pairs.filter((p) => p.unverified.length > 0);

    result.push({
      species,
      pairs: [...orderByScaleAndColour(judged), ...orderByScaleAndColour(flagged)],
    });
  }
  return result;
}
