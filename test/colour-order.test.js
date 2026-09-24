import test from 'node:test';
import assert from 'node:assert/strict';
import { compareByColour, hueAngle, NEUTRAL_CHROMA } from '../src/skins/colour-order.js';

const hide = (id, colourL, colourA, colourB) => ({ id, colourL, colourA, colourB });
const order = (hides) => [...hides].sort(compareByColour).map((h) => h.id);

test('neutrals come first, ordered dark to light', () => {
  const black = hide('black', 8, 0, 0);
  const grey = hide('grey', 55, 1, -2);
  const ivory = hide('ivory', 92, 2, 3);

  assert.deepEqual(order([ivory, black, grey]), ['black', 'grey', 'ivory']);
});

test('a near-neutral is grouped by lightness, not dropped among the hues', () => {
  // The whole reason this module exists: on hue angle alone, a grey's
  // atan2(-2, 1) lands out near the greens and would be shuffled in among
  // them, even though it reads as grey to the eye.
  const grey = hide('grey', 55, 1, -2);
  const green = hide('green', 50, -40, 30);
  const red = hide('red', 45, 55, 35);

  assert.deepEqual(order([green, red, grey]), ['grey', 'red', 'green']);
});

test('chromatic hides run around the colour wheel from red through to blue', () => {
  const red = hide('red', 45, 60, 35);
  const brown = hide('brown', 35, 18, 25); // a low-chroma orange
  const yellow = hide('yellow', 85, 5, 75);
  const green = hide('green', 50, -45, 30);
  const blue = hide('blue', 35, 10, -45);

  assert.deepEqual(order([blue, green, yellow, brown, red]), [
    'red', 'brown', 'yellow', 'green', 'blue',
  ]);
});

test('hue wraps rather than splitting the reds across both ends', () => {
  // atan2 returns negative angles below the a* axis; without the wrap a
  // slightly-blue red would sort at the far end from a slightly-warm one.
  const warmRed = hide('warm', 45, 60, 8);
  const coolRed = hide('cool', 45, 60, -8);

  assert.ok(hueAngle(coolRed) > 180, 'a cool red should wrap to the top of the range');
  assert.deepEqual(order([coolRed, warmRed]), ['warm', 'cool']);
});

test('hides with no colour recorded sort last, behind every measured one', () => {
  const measured = hide('measured', 45, 60, 35);
  const neutral = hide('neutral', 20, 0, 0);
  const unmeasured = hide('unmeasured', null, null, null);

  assert.deepEqual(order([unmeasured, measured, neutral]), [
    'neutral', 'measured', 'unmeasured',
  ]);
});

test('the neutral cutoff is the documented chroma, applied as a strict threshold', () => {
  const justNeutral = hide('just-neutral', 50, NEUTRAL_CHROMA - 1, 0);
  const justChromatic = hide('just-chromatic', 50, NEUTRAL_CHROMA + 1, 0);

  assert.deepEqual(order([justChromatic, justNeutral]), ['just-neutral', 'just-chromatic']);
});
