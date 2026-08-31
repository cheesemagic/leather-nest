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
    if len(sys.argv) != 7:
        fail("Usage: digitize.py <image_path> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>")

    image_path = sys.argv[1]
    try:
        p1x, p1y, p2x, p2y, real_distance_mm = (float(v) for v in sys.argv[2:7])
    except ValueError:
        fail("Calibration points and distance must be numbers.")

    pixel_distance = ((p2x - p1x) ** 2 + (p2y - p1y) ** 2) ** 0.5
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")

    if not all(math.isfinite(v) for v in (p1x, p1y, p2x, p2y, real_distance_mm)) or real_distance_mm <= 0:
        fail("Calibration points and distance must be finite numbers, and the distance must be positive.")

    image = cv2.imread(image_path)
    if image is None:
        fail("Could not read image file.")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    total_area = gray.shape[0] * gray.shape[1]
    min_area = total_area * 0.01
    max_area = total_area * 0.90

    # Try both threshold directions — we don't know in advance whether the
    # pattern piece is darker or lighter than the mat it's photographed on.
    candidates = []
    for thresh_type in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
        _, binary = cv2.threshold(gray, 0, 255, thresh_type + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if min_area <= area <= max_area:
                candidates.append((area, contour))

    if not candidates:
        fail("No clear pattern outline detected — check lighting/contrast against the mat.")

    _, best_contour = max(candidates, key=lambda pair: pair[0])

    scale_mm_per_px = real_distance_mm / pixel_distance
    epsilon = 0.5 / scale_mm_per_px
    approx = cv2.approxPolyDP(best_contour, epsilon, True)

    points_mm = [
        {"x": float(pt[0][0]) * scale_mm_per_px, "y": float(pt[0][1]) * scale_mm_per_px}
        for pt in approx
    ]

    min_x = min(p["x"] for p in points_mm)
    min_y = min(p["y"] for p in points_mm)
    normalized = [{"x": p["x"] - min_x, "y": p["y"] - min_y} for p in points_mm]

    print(json.dumps({"polygon": normalized}))


if __name__ == "__main__":
    main()
