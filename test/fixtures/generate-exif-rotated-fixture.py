#!/usr/bin/env python3
"""Build test-exif-rotated.jpg — a photo whose stored pixels and displayed
pixels disagree, which is what every portrait phone photograph is.

The stored (raw sensor) frame is 400x300 landscape with a 200x100 light
rectangle in it. The file then carries EXIF Orientation = 6, meaning "rotate
a quarter turn clockwise to display". So anything that honours EXIF — every
browser, and cv2.imread's default — sees a 300x400 portrait photo holding a
100x200 rectangle. Anything that ignores EXIF sees the landscape original.

The two readings differ by a quarter turn, which is exactly the bug this
fixture exists to catch. Written by hand because the project has no EXIF
library and does not need one for a single tag.

Run from the repo root:
    venv/bin/python test/fixtures/generate-exif-rotated-fixture.py
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'test-exif-rotated.jpg')

# Stored frame: 400 wide, 300 tall. Dark bench, light piece.
RAW_W, RAW_H = 400, 300
img = np.full((RAW_H, RAW_W, 3), 30, np.uint8)

# A 200x100 rectangle, placed off-centre so the orientation it is read in is
# unambiguous: a symmetric shape would look the same either way round.
cv2.rectangle(img, (60, 90), (259, 189), (225, 225, 225), -1)

# Quality 95 so JPEG ringing does not blur the edge the tracer has to find.
cv2.imwrite(OUT, img, [cv2.IMWRITE_JPEG_QUALITY, 95])

# An APP1 segment carrying one EXIF tag: Orientation = 6.
#
#   FF E1        APP1 marker
#   00 22        segment length, 34 = 2 (itself) + 32 (payload)
#   "Exif\0\0"   6 bytes
#   "MM" 00 2A   TIFF header, big-endian
#   00 00 00 08  offset of IFD0 from the start of the TIFF header
#   00 01        IFD0 holds one entry
#   01 12        tag 0x0112, Orientation
#   00 03        type 3, SHORT
#   00 00 00 01  count 1
#   00 06 00 00  value 6, left-aligned in the 4-byte value field
#   00 00 00 00  no IFD1
APP1 = bytes([
    0xFF, 0xE1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
])

with open(OUT, 'rb') as f:
    data = f.read()
assert data[:2] == b'\xff\xd8', 'expected a JPEG starting with SOI'
with open(OUT, 'wb') as f:
    f.write(data[:2] + APP1 + data[2:])

# Prove the fixture actually does what it claims before anything depends on it.
upright = cv2.imread(OUT)
stored = cv2.imread(OUT, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
assert upright.shape[:2] == (RAW_W, RAW_H), f'upright should be 400 tall x 300 wide, got {upright.shape[:2]}'
assert stored.shape[:2] == (RAW_H, RAW_W), f'stored should be 300 tall x 400 wide, got {stored.shape[:2]}'
print(f'wrote {OUT}')
print(f'  honouring EXIF: {upright.shape[1]}x{upright.shape[0]} (what a browser shows)')
print(f'  ignoring  EXIF: {stored.shape[1]}x{stored.shape[0]} (raw sensor pixels)')
