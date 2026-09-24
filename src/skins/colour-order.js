// Ordering hides by colour for display, which is a different job from
// matching them (src/skins/similarity.js) and follows a different rule.
//
// Matching compares on a*/b* only and never lightness, because lightness
// tracks a photo's exposure and glare more than its dye. Ordering a shelf
// cannot do that: black, grey and ivory all sit at a*~0, b*~0, so on hue
// alone they are indistinguishable from each other and their hue angle is
// pure noise -- they would scatter randomly through the greens and purples.
// So neutrals are pulled out and ordered by lightness, which is exactly the
// axis that separates them, and it is safe here because a mis-ordered
// swatch is a cosmetic annoyance rather than a bad match.

// Below this chroma a colour reads as neutral rather than as a hue. A
// judgement call, not a measurement -- picked because a*/b* within ~10 of
// the axis looks grey to the eye. Raise it if tans start landing in with
// the greys.
export const NEUTRAL_CHROMA = 10;

export function chroma(hide) {
  return Math.hypot(hide.colourA, hide.colourB);
}

// Degrees around the colour wheel, 0 at the red/magenta axis, increasing
// through orange, yellow, green, blue. Leather's browns and tans are
// low-chroma oranges, so they land together early in the run.
export function hueAngle(hide) {
  return ((Math.atan2(hide.colourB, hide.colourA) * 180) / Math.PI + 360) % 360;
}

// 0 = neutral, 1 = has a hue, 2 = no colour recorded at all. Hides captured
// before colour sampling existed sort last rather than pretending to be black.
function colourGroup(hide) {
  if (hide.colourL == null || hide.colourA == null || hide.colourB == null) return 2;
  return chroma(hide) < NEUTRAL_CHROMA ? 0 : 1;
}

export function compareByColour(a, b) {
  const groupA = colourGroup(a);
  const groupB = colourGroup(b);
  if (groupA !== groupB) return groupA - groupB;
  if (groupA === 2) return 0;
  // Neutrals dark to light: black, charcoal, grey, ivory.
  if (groupA === 0) return a.colourL - b.colourL;
  return hueAngle(a) - hueAngle(b);
}
