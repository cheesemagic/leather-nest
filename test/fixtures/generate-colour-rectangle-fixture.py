#!/usr/bin/env python3
"""Generates the coloured-rectangle fixture used by test/digitize.test.js to
check digitize.py's colour sampling. Run manually with the project's venv if
the fixture ever needs regenerating:
    venv/bin/python3 test/fixtures/generate-colour-rectangle-fixture.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)

# Same geometry as test-rectangle.png (200x100 rectangle at (100,100)-(299,199)
# on a 400x300 canvas) so the existing outline-dimension assertions still
# apply, but filled with a known colour (BGR) instead of black -- the same
# colour as test-colour-brown.png, so its measured LAB (see
# test/colour-sample.test.js) doubles as this fixture's expected value.
canvas = np.full((300, 400, 3), 255, dtype=np.uint8)
cv2.rectangle(canvas, (100, 100), (299, 199), (60, 90, 140), -1)
cv2.imwrite(os.path.join(fixtures_dir, "test-colour-rectangle.png"), canvas)

print("wrote test-colour-rectangle.png")
