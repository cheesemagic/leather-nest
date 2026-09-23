#!/usr/bin/env python3
"""Generates the non-rectangular-part fixture used by
test/blotch-match.test.js to cover the rotate_template_normalized()
polygon-vs-rectangle offset fix. Run manually with the project's venv if
the fixture ever needs regenerating:
    venv/bin/python3 test/fixtures/generate-blotch-triangle-fixture.py

Unlike a rectangular part, a triangular part's own polygon bbox does not
coincide with its bounding-rectangle crop's bbox once rotated -- that
mismatch is exactly the bug this fixture exists to catch. The rotated
match patch below is placed using rotate_template_normalized()'s own
`offset` output (imported directly from the production script), so the
fixture and the code under test can't silently diverge in convention.
"""
import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
from blotch_match import rotate_template_normalized  # noqa: E402

fixtures_dir = os.path.dirname(__file__)

canvas = np.full((500, 500, 3), 200, dtype=np.uint8)

# Part: a right triangle, (0,0)-(60,0)-(0,40) in the patch's own local
# frame -- asymmetric under rotation, and (unlike a rectangle) its own
# rotated bbox diverges from its 60x40 bounding-rectangle crop's rotated
# bbox for many angles (verified separately: at 120 degrees the offset
# between the two frames is a clean (30, 0)).
TRIANGLE_LOCAL = np.array([[0, 0], [60, 0], [0, 40]], dtype=np.float32)

patch = np.full((40, 60, 3), 255, dtype=np.uint8)
patch[:, :30] = (0, 0, 220)  # red half (BGR)
patch[:, 30:] = (220, 0, 0)  # blue half (BGR)
patch_mask = np.zeros((40, 60), dtype=np.uint8)
cv2.fillPoly(patch_mask, [TRIANGLE_LOCAL.astype(np.int32)], 255)

# Reference: unrotated, triangle's own (normalized) origin placed at
# canvas (50, 50) -- i.e. placedPolygon(TRIANGLE_LOCAL, {x:50,y:50,rotation:0}).
REF_X, REF_Y = 50, 50
canvas[REF_Y:REF_Y + 40, REF_X:REF_X + 60] = np.where(
    cv2.merge([patch_mask] * 3) > 0, patch, canvas[REF_Y:REF_Y + 40, REF_X:REF_X + 60]
)

# True match: same pattern, rotated 120 degrees (a multiple of
# ROTATION_STEP_DEG), with the part's own normalized-rotated origin
# (i.e. what match.x/match.y must report) placed at canvas (300, 250).
TARGET_X, TARGET_Y, TARGET_ROTATION = 300, 250, 120
rotated, rotated_mask, offset = rotate_template_normalized(patch, patch_mask, TARGET_ROTATION, TRIANGLE_LOCAL)
assert offset is not None and not np.allclose(offset, [0, 0]), (
    "expected a non-zero polygon/rectangle offset at this angle -- fixture no longer exercises the bug"
)
place_x = int(round(TARGET_X - offset[0]))
place_y = int(round(TARGET_Y - offset[1]))
rh, rw = rotated.shape[:2]
region = canvas[place_y:place_y + rh, place_x:place_x + rw]
canvas[place_y:place_y + rh, place_x:place_x + rw] = np.where(cv2.merge([rotated_mask] * 3) > 0, rotated, region)

cv2.imwrite(os.path.join(fixtures_dir, "test-blotch-triangle-canvas.png"), canvas)
print(f"done (offset={offset.tolist()}, place=({place_x},{place_y}), size={rw}x{rh})")
