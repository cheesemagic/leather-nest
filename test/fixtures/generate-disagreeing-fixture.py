#!/usr/bin/env python3
"""Build test-disagreeing.png — a photo the tracer cannot read confidently.

Two squares of equal lightness, one offset along the green-red axis and one
along the blue-yellow axis, on a neutral background of the same lightness.

Built in LAB and converted, so all three regions have identical L. That
leaves brightness with nothing to find, while the two colour channels each
find a *different* square. The surviving attempts therefore point at
disjoint parts of the picture, which is exactly the state digitize.py should
report as uncertain: several readings survived and none agreed, so the
largest was taken for no better reason than being largest.

Neither square touches the frame edge, so this isolates the disagreement
condition from the edge-touching one.

Run from the repo root:
    venv/bin/python test/fixtures/generate-disagreeing-fixture.py
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'test-disagreeing.png')

W, H = 400, 300

# Matched in BGR rather than LAB, because the channel digitize.py actually
# thresholds for brightness is cv2's grey conversion (0.114B + 0.587G +
# 0.299R), not LAB's L. Building in LAB and converting left a few greys of
# difference, which was enough for brightness to find one of the squares and
# agree with the colour channel that found it.
GREY = (128, 128, 128)          # 0.114*128 + 0.587*128 + 0.299*128 = 128
RED_ISH = (186, 80, 200)        # 21.2 + 47.0 + 59.8  = 128.0
YELLOW_ISH = (60, 120, 170)     #  6.8 + 70.4 + 50.8  = 128.0

img = np.zeros((H, W, 3), np.uint8)
img[:, :] = GREY
img[100:200, 60:160] = RED_ISH       # found on the green-red axis
img[100:200, 240:340] = YELLOW_ISH   # found on the blue-yellow axis

grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
spread = int(grey.max()) - int(grey.min())
assert spread <= 1, f'regions must be the same brightness, spread was {spread}'

cv2.imwrite(OUT, img)
print(f'wrote {OUT} (brightness spread across all three regions: {spread})')
