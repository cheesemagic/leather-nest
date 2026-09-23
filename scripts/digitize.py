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

    # Brightness alone is not enough, and a real photograph proved it. A bench
    # lit from one side puts a gradient across the whole frame, so a single
    # cutoff splits the picture into LIT and SHADOWED rather than leather and
    # bench — it swallowed the shadowed wood and sliced diagonally through the
    # middle of the hide.
    #
    # Colour survives that. Wood is strongly yellow; leather is grey, brown or
    # dyed. A shadow changes how bright something is and barely changes its
    # hue, so the blue-yellow and green-red axes cut cleanly through shade.
    # On the photograph that failed, brightness scored 4.40 roughness against
    # the blue-yellow axis's 1.18 — tracing essentially the true outline.
    #
    # Brightness stays in the list because it is the one that works on a plain
    # grey piece against a white mat, where there is no colour to separate.
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    channels = (
        ("brightness", gray),
        ("blue-yellow", lab[:, :, 2]),
        ("green-red", lab[:, :, 1]),
    )

    # Speckle along an edge is what inflates roughness; closing it costs
    # nothing real at this scale. Sized from the photo so it means the same
    # thing on a phone picture and on a small test fixture.
    k = max(3, int(min(gray.shape) * 0.01))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))

    candidates = []
    too_ragged = []
    clipped = False
    for name, channel in channels:
        # Both directions: we do not know whether the piece is darker or
        # lighter than the mat it is photographed on.
        for thresh_type in (cv2.THRESH_BINARY, cv2.THRESH_BINARY_INV):
            _, binary = cv2.threshold(channel, 0, 255, thresh_type + cv2.THRESH_OTSU)
            binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
            binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = cv2.contourArea(contour)
                if not (min_area <= area <= max_area):
                    continue
                # Discard anything running off the edge of the region. The
                # piece is photographed with bench visible around it, so its
                # outline never reaches the border — but an inverted threshold
                # happily returns the whole frame as one contour, and since
                # the biggest candidate wins, that would beat the real
                # outline every time. With only the brightness channel this
                # never came up; adding colour channels made it the answer
                # on the first real photograph.
                # Otsu returns the background just as readily as the piece,
                # and the background is the bigger of the two — so with the
                # largest candidate winning, it beats the real outline every
                # time. Adding colour channels made that the answer on the
                # first real photograph put through this.
                #
                # The background wraps the piece, so it reaches all four
                # sides of the frame. A piece photographed with its edge
                # against something — a tape measure laid alongside, say —
                # reaches one, or two in a corner. Three is the line.
                x, y, w, h = cv2.boundingRect(contour)
                sides = sum((
                    x <= 1,
                    y <= 1,
                    x + w >= gray.shape[1] - 1,
                    y + h >= gray.shape[0] - 1,
                ))
                if sides >= 3:
                    continue
                if sides:
                    clipped = True
                hull = cv2.arcLength(cv2.convexHull(contour), True)
                roughness = cv2.arcLength(contour, True) / hull if hull else 0
                if roughness > MAX_ROUGHNESS:
                    too_ragged.append(roughness)
                    continue
                candidates.append((area, contour))

    if not candidates:
        if too_ragged:
            fail(
                "Every outline found came out too ragged to trust (best "
                f"{min(too_ragged):.1f}, limit {MAX_ROUGHNESS}). That usually means "
                "glare or a hard shadow: a shine on the leather reads as pale as the "
                "background, or a shadow across the bench splits the picture into lit "
                "and dark instead of leather and bench. Photograph the rough side up, "
                "on coloured card, in even indirect light."
            )
        if clipped:
            fail(
                "Every outline found ran off the edge of the selected region. Select a "
                "region with a margin of bench visible around the piece, and keep the "
                "tape measure outside it."
            )
        fail("No clear pattern outline detected — check lighting/contrast against the mat.")

    _, best_contour = max(candidates, key=lambda pair: pair[0])

    # Colour sampled from inside the traced outline only -- the same photo
    # already taken, restricted to the piece itself rather than the bench
    # around it. Reuses the mask this function already has, rather than a
    # second pass over the image.
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.drawContours(mask, [best_contour], -1, 255, -1)
    mean_l, mean_a, mean_b = cv2.mean(lab, mask=mask)[:3]
    colour_l = mean_l * 100 / 255
    colour_a = mean_a - 128
    colour_b = mean_b - 128

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

    print(json.dumps({
        "polygon": normalized,
        "colourL": colour_l,
        "colourA": colour_a,
        "colourB": colour_b,
    }))


if __name__ == "__main__":
    main()
