# leather-nest

Gets pattern pieces out of irregular exotic leather hides and scrap. Two halves:

- **Nesting** — lay pattern pieces onto a photographed hide so the least leather
  is wasted, and write an SVG a laser can cut.
- **Matching** — rank which two hides in a library could pass as a matched pair,
  so a finished pair of shoes doesn't have one visibly different from the other.

A local web app for one operator. It proposes placements and writes files for a
human to approve; **it never talks to a machine.**

New here? `ARCHITECTURE.md` describes what is actually built, `DECISIONS.md` why,
and `AGENTS.md` the rules for changing it.

## Requirements

| | |
|---|---|
| Node | 22+ (developed on v22.17.0). No version manager file — any 22.x works |
| npm | 10+ (developed on 10.9.2) |
| Python | 3.11+ (developed on 3.14.4), only for the photo features |
| OS | macOS and Linux. Untested on Windows; `venv/bin/python3` is hardcoded, so it would need a change |

**No environment variables, and no `.env` file.** There is nothing to configure
— no database, no API keys, no external services. That is why there is no
`.env.example`: an empty one would imply configuration exists.

## Setup

```bash
npm install
```

That is enough to run the app, the nester, the matcher's ranking, and most of
the test suite. For anything involving a photo — tracing an outline, measuring
scale, sampling colour, texture matching — also do the one-time Python setup:

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

The server calls `venv/bin/python3` directly, so the venv never needs
activating.

## Run

```bash
npm start
```

Then open <http://localhost:8080>. It binds `127.0.0.1` only — it is not
reachable from another machine, and that is deliberate (see `SECURITY.md`).

Start at **Hides**, not the landing page: photograph a hide → add components on
**Components** → optionally group them into a product on **Products** → run the
search on **Find Best Use**.

## Test

```bash
npm test                              # all 605, about 27s
node --test test/nesting.test.js      # one file
```

`node --test` is Node's built-in runner — there is no test framework to install.
Tests needing Python run the real `venv` interpreter, so they fail without the
Python setup above.

## Lint, typecheck, build

**There are none, and that is not an oversight.** No linter, no TypeScript, no
bundler, no build step. Plain ES modules run unchanged in Node and the browser.
`npm test` is the whole gate.

Don't add any of the three as part of another change. If one is worth having,
it is worth its own conversation.

## Data

Records live in `data/{skins,parts,products,sessions,calibrations}/` as one JSON
file per record, with photos alongside. The directory is created on first write.

- **Gitignored, and never committed.** Keep it that way — it holds real hide
  photos.
- **No migrations and no seed script.** Records are not versioned, so a field
  added later is simply absent from older ones. Read defensively.
- **Backed up hourly**, by `scripts/backup-data.sh` via cron, into
  `~/leather-nest-backups/` — outside the repo, so re-cloning cannot take the
  backups with it. Identical snapshots are skipped and the last 60 differing ones
  are kept. Run it by hand any time:

  ```bash
  ./scripts/backup-data.sh
  ```

  To restore, look inside a snapshot and then unpack it over the repo:

  ```bash
  tar tzf ~/leather-nest-backups/data-2026-09-27T221338.tgz
  tar xzf ~/leather-nest-backups/data-2026-09-27T221338.tgz -C ~/leather-nest
  ```

  It adds and overwrites; it never deletes. **Same disk only** — this survives a
  mistake, not a dead drive.

**No test can touch `data/`.** `test/helpers/with-server.js` gives every store a
temp directory on every call, whether or not the test asked for one, and removes
them afterwards. That is unconditional by design — it used to depend on each
test setting a flag, and a test that forgot wrote to the real directory for
keeps.

## Common failures

**`spawn venv/bin/python3 ENOENT`, or any photo feature returning 422 or 500**
The Python venv is missing. Run the one-time setup above. Every photo route
shells out to it.

**Python tests failing while the rest pass**
Same cause. Check with `venv/bin/python3 -c "import cv2, numpy"`.

**A page loads but nothing works, console shows a module error**
Only `public/`, `src/` and `node_modules/` are web-reachable. If you moved a file
somewhere else and referenced it from a page, that is the 403. Add it to one of
those directories rather than widening `SERVABLE_ROOTS` in `server.js`.

**An imported SVG comes out 25.4x or 96x the wrong size**
The file states no physical unit, so the unit was picked — probably wrongly. The
import UI asks; answer it deliberately. This is the highest-consequence mistake
in the app, because a wrong scale looks completely normal until leather is cut.

**"The outline crosses itself" / "encloses no area" on a photo that looks fine**
The traced outline is genuinely broken — usually the selected region caught the
bench, a shadow, or two pieces at once. Re-drag the region, or re-shoot with more
contrast against the background. The shape is refused rather than straightened on
purpose, because a straightened guess would cut wrong silently.

**Upload succeeds but the photo will not process**
HEIC. OpenCV cannot read it and it is stored as `.jpg` regardless of its name.
Convert to JPEG or PNG first.

**A search seems to hang, then fails after three minutes**
Every Python call has a 180s ceiling. A full-resolution phone photo measured
52–65s for a texture search, so hitting the limit means the photo is far larger
than anything tested. Shrink it.

**Port 8080 already in use**
`PORT` is a constant in `server.js`, not an environment variable. Stop the other
process, or change it there.
