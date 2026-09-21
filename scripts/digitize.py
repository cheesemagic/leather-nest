#!/usr/bin/env python3
import sys
import json
import math
import cv2
import numpy as np


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


# Traced edge length over convex-hull length. 1.0 is a convex shape; real
# offcuts measured 1.00-1.31; a circle carrying 2mm of tracing jitter reached
# 2.13; the one genuine glare failure scored 4.76. Set between the worst
# plausible trace and the real failure, and worth revisiting once more real
# photographs have been through this — it is calibrated on one failure.
MAX_ROUGHNESS = 3.0


def main():
    if len(sys.argv) not in (7, 11):
        fail(
            "Usage: digitize.py <image_path> <p1x> <p1y> <p2x> <p2y> "
            "<real_distance_mm> [<roi_x> <roi_y> <roi_w> <roi_h>]"
        )

    image_path = sys.argv[1]
    try:
        p1x, p1y, p2x, p2y, real_distance_mm = (float(v) for v in sys.argv[2:7])
        roi = tuple(float(v) for v in sys.argv[7:11]) if len(sys.argv) == 11 else None
    except ValueError:
        fail("Calibration points and distance must be numbers.")

    pixel_distance = ((p2x - p1x) ** 2 + (p2y - p1y) ** 2) ** 0.5
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")

    if not all(math.isfinite(v) for v in (p1x, p1y, p2x, p2y, real_distance_mm)) or real_distance_mm <= 0:
        fail("Calibration points and distance must be finite numbers, and the distance must be positive.")

    # IMREAD_IGNORE_ORIENTATION applies the file's EXIF orientation tag
    # (phone photos are frequently stored rotated) instead of the default
    # of returning raw sensor pixels — verified against real EXIF-rotated
    # photos, since without it the pixel frame doesn't match the
    # calibration/outline coordinates the browser computed from the
    # EXIF-corrected image it displayed.
    image = cv2.imread(image_path, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
    if image is None:
        fail("Could not read image file.")

    # Cropping to a user-selected region before contour detection matters
    # whenever the pattern piece doesn't dominate the frame (generous
    # margins, multiple objects in one photo) — the largest-contour
    # heuristic below can otherwise latch onto a fragment of the
    # background instead of the actual piece.
    if roi is not None:
        roi_x, roi_y, roi_w, roi_h = (int(round(v)) for v in roi)
        if roi_w <= 0 or roi_h <= 0:
            fail("Selected region must have positive width and height.")
        img_h, img_w = image.shape[:2]
        if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
            fail("Selected region falls outside the photo bounds.")
        image = image[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]

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

    # Is this the edge of a piece of leather, or the edge of a shadow?
    #
    # Thresholding decides what is leather by brightness, so a glare highlight
    # on shiny leather reads as background: the trace dives into the middle of
    # the piece, follows the edge of the shine, and comes back out. It returns
    # a shape, confidently, and nothing downstream can tell it is fiction.
    # That happened on the first real photo ever put through this — roughly
    # half a hide was thrown away and no error was raised.
    #
    # The tell is raggedness: how much longer the traced edge is than a taut
    # line pulled around it. Measured on real and synthetic outlines:
    #
    #     rectangle, long strap, circle                1.00
    #     L-shaped offcut, dome with a notch      1.08 - 1.13
    #     deeply concave shapes, zigzag            1.29 - 1.31
    #     a circle with 2mm of tracing jitter           2.13
    #     ------------------------------------------------------
    #     the real glare failure                        4.76
    #
    # Elongation does not move this number, which matters — a 1.5m strap
    # scores 1.00, and a rule based on perimeter against area would have
    # rejected it. Only genuine raggedness moves it.
    hull_perimeter = cv2.arcLength(cv2.convexHull(best_contour), True)
    roughness = cv2.arcLength(best_contour, True) / hull_perimeter if hull_perimeter else 0
    if roughness > MAX_ROUGHNESS:
        fail(
            "The outline came out too ragged to trust (roughness "
            f"{roughness:.1f}, limit {MAX_ROUGHNESS}). This usually means glare: "
            "a shine on the leather is as pale as the background, so the trace "
            "follows the edge of the highlight instead of the edge of the piece. "
            "Photograph the rough side up, on coloured card, in indirect light."
        )

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
