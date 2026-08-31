#!/usr/bin/env python3
"""Generates the synthetic fixtures used by test/digitize.test.js. Run
manually with the project's venv if fixtures ever need regenerating:
    venv/bin/python3 test/fixtures/generate-test-image.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)

# A precise 200x100px black rectangle on a white background. Corners are
# (100,100) to (299,199) rather than (100,100) to (300,200) so the filled
# region is exactly 200x100 pixels (cv2.rectangle's -1 fill is inclusive
# of both corners).
rect = np.full((300, 400), 255, dtype=np.uint8)
cv2.rectangle(rect, (100, 100), (299, 199), 0, -1)
cv2.imwrite(os.path.join(fixtures_dir, "test-rectangle.png"), rect)

# A uniform blank image — no contour should be detectable in this at all.
blank = np.full((300, 400), 255, dtype=np.uint8)
cv2.imwrite(os.path.join(fixtures_dir, "test-blank.png"), blank)

print("wrote test-rectangle.png and test-blank.png")
