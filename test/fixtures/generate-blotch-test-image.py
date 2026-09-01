#!/usr/bin/env python3
"""Generates the synthetic blotch-pattern fixture used by
test/blotch-match.test.js. Run manually with the project's venv if the
fixture ever needs regenerating:
    venv/bin/python3 test/fixtures/generate-blotch-test-image.py
"""
import os
import sys
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
from blotch_match import rotate_template_normalized  # noqa: E402

fixtures_dir = os.path.dirname(__file__)

canvas = np.full((500, 500, 3), 200, dtype=np.uint8)

# Reference patch: 60x40, half red half blue (asymmetric -> rotation-
# sensitive), unrotated, top-left at (100, 100).
patch = np.full((40, 60, 3), 255, dtype=np.uint8)
patch[:, :30] = (0, 0, 220)  # red half (BGR)
patch[:, 30:] = (220, 0, 0)  # blue half (BGR)
patch_mask = np.full((40, 60), 255, dtype=np.uint8)
canvas[100:140, 100:160] = patch

# True match: the identical pattern, rotated 45 degrees (a multiple of
# ROTATION_STEP_DEG so the coarse-angle search lands on it exactly),
# top-left placed at (300, 250).
rotated, rotated_mask = rotate_template_normalized(patch, patch_mask, 45)
rh, rw = rotated.shape[:2]
region = canvas[250:250 + rh, 300:300 + rw]
canvas[250:250 + rh, 300:300 + rw] = np.where(cv2.merge([rotated_mask] * 3) > 0, rotated, region)

# Distractor: different color arrangement (green/yellow), unrotated,
# elsewhere -- should score clearly worse than the true match.
distractor = np.full((40, 60, 3), 255, dtype=np.uint8)
distractor[:, :30] = (0, 200, 0)
distractor[:, 30:] = (0, 200, 200)
canvas[350:390, 50:110] = distractor

cv2.imwrite(os.path.join(fixtures_dir, "test-blotch-canvas.png"), canvas)
print("done")
