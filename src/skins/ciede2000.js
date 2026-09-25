// The CIE's standard colour-difference formula (CIEDE2000), replacing the
// straight-line distance in a*/b* that matching used before it. Straight-line
// distance is not perceptually uniform, and the correction is largest exactly
// where leather lives -- browns, tans and cognacs are low-chroma oranges.
//
// Vendored rather than added as a third dependency, which is only safe
// because the result is checkable: Sharma, Wu & Dalal (2005) publish 34 test
// pairs chosen to exercise this formula's discontinuities (the hue-angle
// wraparound and the blue-region rotation, where naive implementations are
// wrong). test/fixtures/ciede2000-sharma-testdata.txt is that file, fetched
// from https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ and committed
// byte-for-byte. Change this function and that test says so.
//
// See docs/superpowers/specs/2026-09-25-colour-difference-ciede2000-design.md.

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// atan2 in degrees, folded to [0, 360). JS atan2(0, 0) is 0, which is what
// the formula wants for an achromatic colour.
function hueDegrees(b, aPrime) {
  const h = deg(Math.atan2(b, aPrime));
  return h < 0 ? h + 360 : h;
}

// The 25^7 constant appears twice; naming it keeps the two identical.
const POW25_7 = 25 ** 7;

// `lightnessWeight` multiplies the lightness term AFTER the standard
// weighting, and defaults to 1 so this function is the unmodified formula the
// published test data validates. leather-nest passes 0 -- see
// COLOUR_LIGHTNESS_WEIGHT in similarity.js for why.
export function ciede2000(labA, labB, options = {}) {
  const { kL = 1, kC = 1, kH = 1, lightnessWeight = 1 } = options;
  const [L1, a1, b1] = labA;
  const [L2, a2, b2] = labB;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const cBar = (C1 + C2) / 2;

  // Stretches the a* axis at low chroma, which is what pulls near-neutrals
  // apart correctly rather than crowding them together.
  const G = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = hueDegrees(b1, a1p);
  const h2p = hueDegrees(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  // Hue difference takes the short way round the circle. When either colour
  // is achromatic the hue is meaningless, not zero-by-coincidence, so the
  // whole hue term drops out.
  const chromaProduct = C1p * C2p;
  let dhp = 0;
  if (chromaProduct !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(chromaProduct) * Math.sin(rad(dhp) / 2);

  const lBarP = (L1 + L2) / 2;
  const cBarP = (C1p + C2p) / 2;

  // Mean hue, with the same wraparound care: averaging 350 and 10 naively
  // gives 180, the opposite side of the wheel.
  let hBarP;
  if (chromaProduct === 0) hBarP = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
  else hBarP = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));

  const SL = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const SC = 1 + 0.045 * cBarP;
  const SH = 1 + 0.015 * cBarP * T;

  // The blue-region rotation: chroma and hue errors interact around 275deg,
  // which is the term most implementations get wrong and the published test
  // data deliberately probes.
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + POW25_7));
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  const lightness = lightnessWeight * (dLp / (kL * SL));
  const chroma = dCp / (kC * SC);
  const hue = dHp / (kH * SH);

  return Math.sqrt(lightness ** 2 + chroma ** 2 + hue ** 2 + RT * chroma * hue);
}
