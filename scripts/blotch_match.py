#!/usr/bin/env python3
import sys
import json
import math
import cv2
import numpy as np

ROTATION_STEP_DEG = 15
MAX_MATCH_DISTANCE = 0.35  # TM_SQDIFF_NORMED: lower is better, 0 = perfect


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def polygon_to_px(polygon_mm, mm_per_px):
    return np.array(
        [[p["x"] / mm_per_px, p["y"] / mm_per_px] for p in polygon_mm],
        dtype=np.float32,
    )


def rotate_template_normalized(template, mask, angle_deg):
    """Rotates template+mask around pixel (0,0), then shifts so the
    rotated shape's own bounding box starts at (0,0) -- i.e. this matches
    rotatePolygon()+normalizeToOrigin() in src/nesting/geometry.js exactly
    (same x'=x*cos-y*sin, y'=x*sin+y*cos formula, not cv2's own rotation
    sign convention). Output pixel (0,0) is always where the die's own
    normalized-rotated origin lands, so a found top-left position is
    directly usable as match.x/match.y for later rendering via the same
    rotatePolygon()-based placedPolygon() the browser already uses.
    """
    h, w = template.shape[:2]
    corners = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    theta = np.radians(angle_deg)
    cos_a, sin_a = np.cos(theta), np.sin(theta)
    rot2x2 = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)
    rotated_corners = corners @ rot2x2.T
    min_xy = rotated_corners.min(axis=0)
    max_xy = rotated_corners.max(axis=0)
    out_w = int(np.ceil(max_xy[0] - min_xy[0]))
    out_h = int(np.ceil(max_xy[1] - min_xy[1]))
    if out_w <= 0 or out_h <= 0:
        return None, None

    M = np.hstack([rot2x2, (-min_xy).reshape(2, 1)]).astype(np.float32)
    rotated_template = cv2.warpAffine(template, M, (out_w, out_h))
    rotated_mask = cv2.warpAffine(mask, M, (out_w, out_h))
    return rotated_template, rotated_mask


def crop_to_polygon(image, points_px):
    """Crops image to the polygon's bounding box; returns
    (cropped, mask, (x0, y0)) or None if the polygon falls outside image."""
    x0 = int(np.floor(points_px[:, 0].min()))
    y0 = int(np.floor(points_px[:, 1].min()))
    x1 = int(np.ceil(points_px[:, 0].max()))
    y1 = int(np.ceil(points_px[:, 1].max()))
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return None
    if x0 < 0 or y0 < 0 or x1 > image.shape[1] or y1 > image.shape[0]:
        return None
    crop = image[y0:y1, x0:x1]
    mask = np.zeros(crop.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [(points_px - [x0, y0]).astype(np.int32)], 255)
    return crop, mask, (x0, y0)


def main():
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        fail("Could not parse JSON payload from stdin.")

    try:
        image_path = payload["imagePath"]
        calibration = payload["calibration"]
        search_region = payload["searchRegion"]
        die_polygon = payload["diePolygon"]
        reference = payload["referencePlacement"]
        occupied_placements = payload.get("occupied", [])
    except KeyError as err:
        fail(f"Missing required field: {err}")

    if len(die_polygon) < 3:
        fail("diePolygon must have at least 3 points.")

    p1x, p1y = calibration["p1x"], calibration["p1y"]
    p2x, p2y = calibration["p2x"], calibration["p2y"]
    real_distance_mm = calibration["realDistanceMm"]
    pixel_distance = math.hypot(p2x - p1x, p2y - p1y)
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")
    mm_per_px = real_distance_mm / pixel_distance

    roi_x = int(round(search_region["roiX"]))
    roi_y = int(round(search_region["roiY"]))
    roi_w = int(round(search_region["roiWidth"]))
    roi_h = int(round(search_region["roiHeight"]))
    if roi_w <= 0 or roi_h <= 0:
        fail("Search region must have positive width and height.")

    image = cv2.imread(image_path, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
    if image is None:
        fail("Could not read image file.")
    img_h, img_w = image.shape[:2]
    if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
        fail("Search region falls outside the photo bounds.")

    die_points_px = polygon_to_px(die_polygon, mm_per_px)

    # Reference template: crop the die's own footprint directly from the
    # full photo. Rotation is always 0 for a reference (v1 doesn't allow
    # rotating a reference placement), so this is a plain translated crop.
    ref_points = die_points_px + [reference["x"], reference["y"]]
    ref_crop = crop_to_polygon(image, ref_points)
    if ref_crop is None:
        fail("Reference placement falls outside the photo bounds.")
    template_bgr, template_mask, _ = ref_crop
    template_lab = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2LAB)

    region_bgr = image[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]
    region_lab = cv2.cvtColor(region_bgr, cv2.COLOR_BGR2LAB)

    # Occupied mask, in the search region's own coordinate frame: the
    # reference itself (must never re-select its own spot), plus every
    # prior placement in this session.
    occupied_mask = np.zeros((roi_h, roi_w), dtype=np.uint8)

    def stamp_occupied(polygon_mm_or_none, x, y, rotation):
        if polygon_mm_or_none is not None:
            base_px = polygon_to_px(polygon_mm_or_none, mm_per_px)
        else:
            base_px = die_points_px
        theta = np.radians(rotation)
        cos_a, sin_a = np.cos(theta), np.sin(theta)
        rot2x2 = np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)
        rotated = base_px @ rot2x2.T
        normalized = rotated - rotated.min(axis=0)
        placed = normalized + [x, y]
        shifted = (placed - [roi_x, roi_y]).astype(np.int32)
        cv2.fillPoly(occupied_mask, [shifted], 255)

    stamp_occupied(None, reference["x"], reference["y"], reference["rotation"])
    for placement in occupied_placements:
        stamp_occupied(placement["polygon"], placement["x"], placement["y"], placement["rotation"])

    occupied_f = (occupied_mask > 0).astype(np.float32)

    best = None  # (score, region_local_x, region_local_y, angle)
    for angle in range(0, 360, ROTATION_STEP_DEG):
        rotated_template, rotated_mask = rotate_template_normalized(template_lab, template_mask, angle)
        if rotated_template is None:
            continue
        rt_h, rt_w = rotated_template.shape[:2]
        if rt_h > roi_h or rt_w > roi_w:
            continue

        mask3 = cv2.merge([rotated_mask, rotated_mask, rotated_mask])
        channel_scores = [
            cv2.matchTemplate(
                region_lab[:, :, c], rotated_template[:, :, c], cv2.TM_SQDIFF_NORMED, mask=mask3[:, :, c]
            )
            for c in range(3)
        ]
        score_map = np.mean(channel_scores, axis=0)

        mask_f = (rotated_mask > 0).astype(np.float32)
        overlap = cv2.filter2D(occupied_f, -1, mask_f, anchor=(0, 0), borderType=cv2.BORDER_CONSTANT)
        overlap = overlap[: score_map.shape[0], : score_map.shape[1]]
        score_map[overlap > 0.5] = np.inf

        idx = np.unravel_index(np.argmin(score_map), score_map.shape)
        score = score_map[idx]
        if best is None or score < best[0]:
            best = (score, idx[1], idx[0], angle)

    if best is None or not np.isfinite(best[0]) or best[0] > MAX_MATCH_DISTANCE:
        print(json.dumps({
            "match": None,
            "reason": "No sufficiently similar, non-overlapping region found in the search area.",
        }))
        return

    score, top_x, top_y, angle = best
    print(json.dumps({
        "match": {
            "x": float(roi_x + top_x),
            "y": float(roi_y + top_y),
            "rotation": angle,
            "score": float(score),
        }
    }))


if __name__ == "__main__":
    main()
