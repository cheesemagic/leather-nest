#!/usr/bin/env python3
import sys
import json
import math
import cv2
import numpy as np

MIN_SIDE_PX = 32
MIN_R = 3
STD_DEV_THRESHOLD = 3.0
REF_WAVELENGTHS_MM = np.geomspace(0.5, 20, 40)


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def main():
    if len(sys.argv) != 11:
        fail(
            "Usage: skin_signature.py <image_path> <roi_x> <roi_y> <roi_w> "
            "<roi_h> <p1x> <p1y> <p2x> <p2y> <real_distance_mm>"
        )

    image_path = sys.argv[1]
    try:
        roi_x, roi_y, roi_w, roi_h, p1x, p1y, p2x, p2y, real_distance_mm = (
            float(v) for v in sys.argv[2:11]
        )
    except ValueError:
        fail("Region and calibration values must be numbers.")

    values = (roi_x, roi_y, roi_w, roi_h, p1x, p1y, p2x, p2y, real_distance_mm)
    if not all(math.isfinite(v) for v in values) or real_distance_mm <= 0:
        fail("Region and calibration values must be finite, and the distance must be positive.")

    pixel_distance = math.hypot(p2x - p1x, p2y - p1y)
    if pixel_distance < 1e-6:
        fail("Calibration points must be distinct.")
    mm_per_px = real_distance_mm / pixel_distance

    roi_x, roi_y, roi_w, roi_h = (int(round(v)) for v in (roi_x, roi_y, roi_w, roi_h))
    if roi_w <= 0 or roi_h <= 0:
        fail("Selected region must have positive width and height.")

    # IMREAD_IGNORE_ORIENTATION applies the file's EXIF orientation tag
    # (phone photos are frequently stored rotated) instead of the default
    # of returning raw sensor pixels — verified against real EXIF-rotated
    # photos, since without it the pixel frame doesn't match the
    # calibration/region coordinates the browser computed from the
    # EXIF-corrected image it displayed.
    image = cv2.imread(image_path, cv2.IMREAD_IGNORE_ORIENTATION | cv2.IMREAD_COLOR)
    if image is None:
        fail("Could not read image file.")

    gray_full = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    img_h, img_w = gray_full.shape
    if roi_x < 0 or roi_y < 0 or roi_x + roi_w > img_w or roi_y + roi_h > img_h:
        fail("Selected region falls outside the photo bounds.")

    roi = gray_full[roi_y:roi_y + roi_h, roi_x:roi_x + roi_w]

    # The radial-average step below is only meaningful for a square region
    # (a non-square 2D FFT's axes have different frequency scales, so
    # combining them into one radius is only valid when they match) — center-
    # crop to the largest square that fits.
    side = min(roi.shape)
    if side < MIN_SIDE_PX:
        fail(f"Selected region is too small — needs at least {MIN_SIDE_PX}x{MIN_SIDE_PX}px.")
    y0 = (roi.shape[0] - side) // 2
    x0 = (roi.shape[1] - side) // 2
    square = roi[y0:y0 + side, x0:x0 + side].astype(np.float64)

    if square.std() < STD_DEV_THRESHOLD:
        fail("Selected region has too little contrast to detect a scale pattern.")

    # Hann window tapers the crop's edges to zero, avoiding the spurious
    # frequencies a hard rectangular crop would introduce.
    window = np.outer(np.hanning(side), np.hanning(side))
    windowed = square * window

    fshift = np.fft.fftshift(np.fft.fft2(windowed))
    power = np.abs(fshift) ** 2

    center = side // 2
    yy, xx = np.indices((side, side))
    r = np.hypot(xx - center, yy - center).astype(int)

    radial_sum = np.bincount(r.ravel(), power.ravel())
    radial_count = np.bincount(r.ravel())
    radial_profile = radial_sum / np.maximum(radial_count, 1)

    # Bins below MIN_R reflect large-scale brightness gradients across the
    # photo (near-DC energy), not scale texture — excluded from peak-finding.
    max_r = side // 2
    candidate_r = np.arange(MIN_R, max_r)
    peak_r = candidate_r[np.argmax(radial_profile[MIN_R:max_r])]
    dominant_wavelength_mm = (side / peak_r) * mm_per_px

    # Convert every non-DC bin's wavelength to mm, then resample onto a
    # fixed log-spaced grid (REF_WAVELENGTHS_MM) so any two skins' spectra
    # are directly comparable position-by-position regardless of the ROI's
    # pixel size or the photo's calibration scale.
    r_bins = np.arange(1, max_r)
    wavelength_mm = (side / r_bins) * mm_per_px
    power_bins = radial_profile[1:max_r]
    order = np.argsort(wavelength_mm)
    wavelength_sorted = wavelength_mm[order]
    power_sorted = power_bins[order]

    resampled = np.interp(
        REF_WAVELENGTHS_MM,
        wavelength_sorted,
        power_sorted,
        left=power_sorted[0],
        right=power_sorted[-1],
    )
    peak = resampled.max()
    if peak > 0:
        resampled = resampled / peak

    print(json.dumps({
        "dominantWavelengthMm": dominant_wavelength_mm,
        "radialSpectrum": resampled.tolist(),
    }))


if __name__ == "__main__":
    main()
