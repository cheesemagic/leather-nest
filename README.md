# leather-nest

Nests laser-cut leather pattern pieces onto irregular exotic-leather scrap
offcuts, for a Thunder Laser Nova 51 (100W CO2, LightBurn).

See `docs/superpowers/specs/2026-08-24-leather-nesting-design.md` for the
v0 design.

## Run

    npm install
    npm start

Then open http://localhost:8080 in a browser.

## Test

    npm test

## Python setup (photo digitization)

The photo digitization feature uses a small Python/OpenCV script. One-time setup:

    python3 -m venv venv
    venv/bin/pip install -r requirements.txt

The server calls `venv/bin/python3` directly — no need to activate the venv.
