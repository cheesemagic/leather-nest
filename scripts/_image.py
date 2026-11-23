"""Shared photo reading for the scripts the server spawns.

Exists for one reason: every coordinate these scripts receive — calibration
points, outline regions, scale patches, blotch search areas — is computed in
the browser from `img.naturalWidth/naturalHeight`. A browser applies the EXIF
orientation tag when it renders an `<img>`, so those numbers are always in the
**upright** frame the operator was looking at. Anything on this side that
reads the file differently is working in a different picture.

This used to be got backwards. Each of the four scripts passed
`cv2.IMREAD_IGNORE_ORIENTATION`, under a comment claiming the flag *applies*
the EXIF tag. It does the opposite: OpenCV documents it as "do not rotate the
image according to EXIF's orientation flag", so the scripts were reading raw
sensor pixels while the browser sent upright coordinates. On a portrait phone
photograph the two frames are transposed, and the symptoms were a region that
cropped the wrong part of the picture, an outline that came out a quarter turn
round, or an outright "Selected region falls outside the photo bounds" on a
region the operator had just successfully dragged.

Measured on the project's own photographs, 2026-11-23:

    IMG_7428   browser 4032x3024   IGNORE_ORIENTATION 3024x4032
    IMG_7432   browser 5712x4284   IGNORE_ORIENTATION 4284x5712
    IMG_7430   browser 3024x4032   IGNORE_ORIENTATION 3024x4032  (no tag)

Photographs carrying no orientation tag read identically either way, which is
very likely why the original flag survived its own verification.

The millimetre scale was never affected: the distance between two calibration
points does not change when the frame is rotated. This was a mislocation bug,
not a resizing one.

`test/fixtures/test-exif-rotated.jpg` carries a real Orientation=6 tag and
exists to keep this from regressing. If you are tempted to put the flag back,
that fixture will tell you why not.
"""
import cv2


def read_photo(image_path):
    """Read a photo in the same frame the browser showed the operator.

    Returns a BGR array, or None if the file could not be read — callers
    report that themselves, because each has its own wording for it.
    """
    # No IMREAD_IGNORE_ORIENTATION: the default honours the EXIF tag, which is
    # what matches the browser. See this module's docstring before changing it.
    return cv2.imread(image_path, cv2.IMREAD_COLOR)
