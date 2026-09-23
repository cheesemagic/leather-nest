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


def rotation_matrix_deg(angle_deg):
    """The single authoritative 2x2 rotation matrix derivation -- both
    rotate_points_deg() and rotate_template_normalized()'s cv2.warpAffine
    matrix are built from this, so they can't desync."""
    theta = np.radians(angle_deg)
    cos_a, sin_a = np.cos(theta), np.sin(theta)
    return np.array([[cos_a, -sin_a], [sin_a, cos_a]], dtype=np.float32)


def rotate_points_deg(points, angle_deg):
    """Rotate (N,2) points around origin using the same formula as
    rotatePolygon() in src/nesting/geometry.js: x'=x*cos-y*sin, y'=x*sin+y*cos.
    This is the single authoritative rotation formula; both rotate_template_normalized()
    and stamp_occupied() use it to stay in lockstep.
    """
    return points @ rotation_matrix_deg(angle_deg).T


def polygon_to_px(polygon_mm, mm_per_px):
    return np.array(
        [[p["x"] / mm_per_px, p["y"] / mm_per_px] for p in polygon_mm],
        dtype=np.float32,
    )


def rotate_template_normalized(template, mask, angle_deg, poly_local=None):
    """Rotates template+mask around pixel (0,0), then shifts so the
    rotated CROP RECTANGLE's own bounding box starts at (0,0). This is
    NOT the same frame placedPolygon() uses in src/nesting/geometry.js --
    that normalizes to bbox(rotate(the part's own polygon)), which for a
    non-rectangular part sits inside and offset from the crop rectangle's
    own rotated bbox. `poly_local`, when given, is the part's polygon in
    the template's local coordinate frame (i.e. points_px - [x0, y0] from
    the crop step); when provided, this also returns `offset` -- where
    the part's own normalized-rotated origin sits within THIS function's
    rotated-raster frame. A caller must add `offset` to a found top-left
    raster position to get match.x/match.y in the placedPolygon() frame;
    using the raster's raw top-left directly (as if offset were always
    (0,0)) is only correct when the part is itself a rectangle.
    """
    h, w = template.shape[:2]
    corners = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    rotated_corners = rotate_points_deg(corners, angle_deg)
    min_xy = rotated_corners.min(axis=0)
    max_xy = rotated_corners.max(axis=0)
    out_w = int(np.ceil(max_xy[0] - min_xy[0]))
    out_h = int(np.ceil(max_xy[1] - min_xy[1]))
    if out_w <= 0 or out_h <= 0:
        return None, None, None

    rot2x2 = rotation_matrix_deg(angle_deg)
    M = np.hstack([rot2x2, (-min_xy).reshape(2, 1)]).astype(np.float32)
    rotated_template = cv2.warpAffine(template, M, (out_w, out_h))
    rotated_mask = cv2.warpAffine(mask, M, (out_w, out_h))

    offset = None
    if poly_local is not None:
        poly_rotated = rotate_points_deg(poly_local, angle_deg)
        offset = poly_rotated.min(axis=0) - min_xy

    return rotated_template, rotated_mask, offset


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
        part_polygon = payload["partPolygon"]
        reference = payload["referencePlacement"]
        occupied_placements = payload.get("occupied", [])

        # Extract nested fields with the same error handling
        p1x, p1y = calibration["p1x"], calibration["p1y"]
        p2x, p2y = calibration["p2x"], calibration["p2y"]
        real_distance_mm = calibration["realDistanceMm"]

        roi_x = int(round(search_region["roiX"]))
        roi_y = int(round(search_region["roiY"]))
        roi_w = int(round(search_region["roiWidth"]))
        roi_h = int(round(search_region["roiHeight"]))

        # Validate reference placement fields exist (will be used later)
        _ = reference["x"], reference["y"], reference["rotation"]
        # Validate occupied placement fields exist (will be used later)
        for placement in occupied_placements:
            _ = placement["polygon"], placement["x"], placement["y"], placement["rotation"]
    except KeyError as err:
        fail(f"Missing required field: {err}")

    if len(part_polygon) < 3:
        fail("partPolygon must have at least 3 points.")

    pixel_distance = math.hypot(p2x - p1x, p2y - p1y)
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")
    mm_per_px = real_distance_mm / pixel_distance

    if roi_w <= 0 or roi_h <= 0:
        fail("Search region must have positive width and height.")

    image = cv2.imread(image_path, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
    if image is None:
        fail("Could not read image file.")
    img_h, img_w = image.shape[:2]
    if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
        fail("Search region falls outside the photo bounds.")

    part_points_px = polygon_to_px(part_polygon, mm_per_px)
    # Normalize so the part's own bbox minimum is (0,0) -- true for
    # photo-digitized parts already, but NOT guaranteed for SVG-uploaded
    # parts (src/svg/parse.js doesn't normalize). Without this, ref_points
    # below would be offset by the part's raw (un-normalized) bbox origin
    # instead of matching the placedPolygon() convention the browser uses.
    part_points_px -= part_points_px.min(axis=0)

    # Reference template: crop the part's own footprint directly from the
    # full photo. Rotation is always 0 for a reference (v1 doesn't allow
    # rotating a reference placement), so this is a plain translated crop.
    ref_points = part_points_px + [reference["x"], reference["y"]]
    ref_crop = crop_to_polygon(image, ref_points)
    if ref_crop is None:
        fail("Reference placement falls outside the photo bounds.")
    template_bgr, template_mask, (x0, y0) = ref_crop
    template_lab = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2LAB)
    # The part's own polygon in the template's local frame (relative to the
    # crop's own top-left corner) -- fed to rotate_template_normalized() so
    # it can report where the part's own rotated-normalized origin lands
    # within its rotated raster, not just the raster rectangle's own origin.
    poly_local = ref_points - [x0, y0]

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
            base_px = part_points_px
        rotated = rotate_points_deg(base_px, rotation)
        normalized = rotated - rotated.min(axis=0)
        placed = normalized + [x, y]
        shifted = (placed - [roi_x, roi_y]).astype(np.int32)
        cv2.fillPoly(occupied_mask, [shifted], 255)

    stamp_occupied(None, reference["x"], reference["y"], reference["rotation"])
    for placement in occupied_placements:
        stamp_occupied(placement["polygon"], placement["x"], placement["y"], placement["rotation"])

    occupied_f = (occupied_mask > 0).astype(np.float32)

    best = None  # (score, region_local_x, region_local_y, angle, offset)
    for angle in range(0, 360, ROTATION_STEP_DEG):
        rotated_template, rotated_mask, offset = rotate_template_normalized(
            template_lab, template_mask, angle, poly_local
        )
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

        # Masked TM_SQDIFF_NORMED can produce NaN (e.g. a pure-black patch
        # under the mask). np.argmin would happily "select" a NaN, and
        # NaN's comparisons are always False, so a NaN latched into `best`
        # can never be beaten by a later, genuinely better score. Convert
        # NaN to +inf so it's never selected as a minimum.
        score_map = np.nan_to_num(score_map, nan=np.inf, posinf=np.inf)

        idx = np.unravel_index(np.argmin(score_map), score_map.shape)
        score = score_map[idx]
        if best is None or score < best[0]:
            best = (score, idx[1], idx[0], angle, offset)

    if best is None or not np.isfinite(best[0]) or best[0] > MAX_MATCH_DISTANCE:
        print(json.dumps({
            "match": None,
            "reason": "No sufficiently similar, non-overlapping region found in the search area.",
        }))
        return

    score, top_x, top_y, angle, offset = best
    print(json.dumps({
        "match": {
            "x": float(roi_x + top_x + offset[0]),
            "y": float(roi_y + top_y + offset[1]),
            "rotation": angle,
            "score": float(score),
        }
    }))


if __name__ == "__main__":
    main()
