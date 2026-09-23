#!/usr/bin/env python3
"""Generates the solid-colour fixtures used by test/colour-sample.test.js.
Run manually with the project's venv if fixtures ever need regenerating:
    venv/bin/python3 test/fixtures/generate-colour-test-image.py
"""
import os
import cv2
import numpy as np

fixtures_dir = os.path.dirname(__file__)

# Mid-brown, uniform -- BGR order, matching cv2.imwrite's expectation.
brown = np.full((100, 100, 3), (60, 90, 140), dtype=np.uint8)
cv2.imwrite(os.path.join(fixtures_dir, "test-colour-brown.png"), brown)

# A visibly different blue, same size -- for asserting the sampler tells
# two different colours apart.
blue = np.full((100, 100, 3), (150, 60, 30), dtype=np.uint8)
cv2.imwrite(os.path.join(fixtures_dir, "test-colour-blue.png"), blue)

print("wrote test-colour-brown.png and test-colour-blue.png")
