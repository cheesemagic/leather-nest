#!/usr/bin/env python3
"""Generates the textured-hide fixture used by test/skins-route.test.js.

Every other fixture exercises one half of the Hides page's capture: a plain
shape digitize.py can trace (test-rectangle.png), or a periodic pattern
skin_signature.py can measure (test-grid-10px.png). Adding a hide "for
matching" runs BOTH scripts over one photo, so it needs a fixture that is
both at once -- a clearly bounded shape with scale-like texture inside it,
which is what a real hide photo actually is.

Run manually with the project's venv if it ever needs regenerating:
    venv/bin/python3 test/fixtures/generate-textured-hide-fixture.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)

WIDTH, HEIGHT = 400, 300
SHAPE = (50, 50, 300, 200)  # x, y, w, h
SCALE_PERIOD_PX = 10

# White ground so the shape's edge is the strongest contrast in the frame --
# digitize.py traces that edge, and nothing inside the shape comes close to it.
canvas = np.full((HEIGHT, WIDTH), 255, dtype=np.uint8)

x, y, w, h = SHAPE
canvas[y:y + h, x:x + w] = 150

# A regular grid standing in for scales. The period has to be coarse enough
# that skin_signature.py's radial peak lands clear of its near-DC exclusion
# (a 160px region at this period peaks around r=16, well past the r=4 floor)
# and fine enough to stay above Nyquist.
for line_y in range(y, y + h, SCALE_PERIOD_PX):
    canvas[line_y:line_y + 2, x:x + w] = 70
for line_x in range(x, x + w, SCALE_PERIOD_PX):
    canvas[y:y + h, line_x:line_x + 2] = 70

cv2.imwrite(os.path.join(fixtures_dir, "test-textured-hide.png"), canvas)
print("wrote test-textured-hide.png")
