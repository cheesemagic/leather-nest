#!/usr/bin/env python3
import sys
import json
import math
import cv2
import numpy as np


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 6:
        fail("Usage: colour_sample.py <image_path> <roi_x> <roi_y> <roi_w> <roi_h>")

    image_path = sys.argv[1]
    try:
        roi_x, roi_y, roi_w, roi_h = (float(v) for v in sys.argv[2:6])
    except ValueError:
        fail("Region values must be numbers.")

    if not all(math.isfinite(v) for v in (roi_x, roi_y, roi_w, roi_h)):
        fail("Region values must be finite.")

    roi_x, roi_y, roi_w, roi_h = (int(round(v)) for v in (roi_x, roi_y, roi_w, roi_h))
    if roi_w <= 0 or roi_h <= 0:
        fail("Selected region must have positive width and height.")

    # Same EXIF-orientation handling as skin_signature.py -- phone photos
    # are frequently stored rotated relative to raw sensor pixels.
    image = cv2.imread(image_path, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
    if image is None:
        fail("Could not read image file.")

    img_h, img_w = image.shape[:2]
    if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
        fail("Selected region falls outside the photo bounds.")

    roi = image[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]

    # LAB, not RGB: distance in LAB corresponds to what the eye judges as
    # "the same brown", which is the comparison the products spec needs.
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float64)
    mean_l, mean_a, mean_b = lab.reshape(-1, 3).mean(axis=0)

    print(json.dumps({
        # OpenCV packs LAB into 0-255; rescale to the conventional ranges
        # (L*: 0-100, a*/b*: roughly -128..127) so deltas are comparable to
        # published just-noticeable-difference thresholds.
        "l": mean_l * 100 / 255,
        "a": mean_a - 128,
        "b": mean_b - 128,
    }))


if __name__ == "__main__":
    main()
