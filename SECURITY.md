# Security

Audited 2026-09-27. This is a pre-revenue, single-operator local tool with no
customer data in it. The audit is scoped to that: what exists, checked by
running it. No enterprise infrastructure was built and none is recommended yet.

**The single most important fact about this app's security posture:** the server
binds `127.0.0.1` and has no authentication of any kind. Everything below is
"local tool" severity *because* of that bind. Change it to `0.0.0.0` and this
document is void — every finding becomes urgent and the app becomes an
unauthenticated file server on the network.

## What was checked, and how

Verified by running it, not by reading it.

| Area | Result |
|---|---|
| Secrets in the working tree | **None.** No `.env`, no keys, no certificates, and **no `process.env` reads anywhere in the codebase** — there is no configuration to leak |
| Secrets in git history | **None** across 194 commits, scanned for AWS keys, `sk-`/`ghp_` tokens, private-key headers, connection strings and JWTs |
| `.gitignore` coverage | `data/`, `venv/`, `node_modules/`, `.claude/*` (bar `agents/`). `data/` has **never** been committed |
| `npm audit` | **0 vulnerabilities.** Two runtime deps: `clipper-lib`, `formidable` |
| Python deps | Pinned exactly: `opencv-python-headless==5.0.0.93`, `numpy==2.5.2` on Python 3.14.4. No native audit tool in use |
| Path traversal out of the repo | **Blocked.** Raw-socket `GET /../../../../etc/passwd` → 403 |
| Command injection into the photo scripts | **Not reachable.** `execFile` with an argument array throughout — no shell, no string interpolation |

## Findings, and what was done

All three were confirmed by exploiting them, then fixed, then covered by tests
that fail without the fix.

### 1. Every file under the repo root was web-reachable — FIXED

`serveStatic` served anything asked for by name. Confirmed 200 on `.git/config`,
`.git/HEAD`, `.claude/settings.local.json`, `server.js`, and a live hide record
at `/data/skins/<id>.json`. The existing guard only stopped a path climbing
*out* of the repo, which was never the exposure. `.git/` alone meant the entire
commit history was downloadable.

Fixed with an allowlist — `public/`, `src/`, `node_modules/` — compared against
the resolved path, so `..` inside a permitted root cannot climb out of it.
Covered by `test/static-route.test.js`.

### 2. A stored photo's extension was client-controlled — FIXED

`photoExt` came from the uploaded filename with no validation, and both the
photo routes and the static server derive a `Content-Type` from it. Confirmed: a
file uploaded as `hide.html` was stored as `<uuid>.html` and served as
`text/html` from the app's own origin — stored XSS on an origin that can then
reach every route, with no auth and no CSRF token in the way.

Fixed with an allowlist: `.jpg`, `.jpeg`, `.png`; anything else stored as
`.jpg`. Covered by `test/upload-boundary.test.js`, including the filename
actually written to disk.

**The first version of this fix was incomplete, and the verifier caught it.**
Constraining what gets *written* left the read side still trusting the record —
the photo routes derived their `Content-Type` from the stored extension, so any
record already carrying `.html` kept being served as a page. A photo's
`Content-Type` is now derived from the same allowlist rather than from the
record, so writes and reads are each safe independently of the other.

### 3. No CSRF protection on any write route — FIXED

A cross-origin multipart POST needs no preflight, so any page the operator
visited could create and rewrite hide records on `localhost:8080`. `DELETE` was
already covered by CORS preflight; POST was not.

Fixed with an `Origin` check on every non-GET request. A *missing* `Origin` is
allowed through — curl, the test suite and anything that is not a browser send
none, and they are not the threat. Covered by `test/upload-boundary.test.js`.

### 4. Unreadable photo-script output crashed the server — FIXED

Seven handlers called `JSON.parse` on Python stdout with no catch, inside an
`execFile` callback with nothing above it to catch either. One malformed line
took the process down and left the operator's upload in the temp directory.
`execPython` now treats non-JSON output on a zero exit as a failure, so each
handler's existing error path returns a 422. Covered by
`test/python-timeout.test.js`.

### 5. A self-crossing hole reached the cut file — FIXED

Not a security finding, but the most physically consequential thing found in
this pass. Interior rings — stitch holes, punch holes — were validated for
structure and containment but not for self-crossing, and the exporter writes them
in the **same colour as the real cuts**. A bowtie where a hole should be became an
X slashed across the finished piece, with nothing between the upload and the
laser file to stop it.

Fixed in `validateInteriorPaths` (`src/interior.js`), which is where interior
validation already lived and was simply incomplete — so every caller gains the
check, not just the import route. Closed `cut` rings only: an open path is a
stitch guide with no inside to be ambiguous about, and a decorative `mark` may
legitimately cross itself.

Deliberately **not** `validatePolygon`: a real stitch hole in this repo's own
records measures about half a square millimetre, and that function's
one-square-millimetre floor would refuse every one of them.

## Open, not fixed

Judged not worth code in a loopback-only single-operator tool. Each becomes real
the moment the bind address changes.

- **No authentication or authorization at all.** Anything that can reach the port
  can do anything. This is by design today — see DECISIONS.md, 2026-09-27.
- **Upload size is `formidable`'s default**, i.e. 200MB per file, `maxFiles:
  Infinity`, 20MB of field data. Not tuned, not tested. A deliberately large
  upload will consume disk and memory. Local-only, so it is self-inflicted.
- **No rate limiting.** Irrelevant on loopback; a blocker if ever exposed.
- **No integrity protection on records.** Flat JSON files, writable by anything
  running as the operator's user. There is no threat model in which that is
  distinguishable from "the attacker already has the machine".
- **Hide photos are readable by anyone who can reach the port**, via
  `/skins/:id/photo`. Ids are UUIDv4, so not guessable, but nothing authorizes
  the read.
- **Backups are local only.** `data/` is now snapshotted hourly by
  `scripts/backup-data.sh` into `~/leather-nest-backups/`, and the restore path
  has been exercised — a snapshot unpacked into a clean directory came back
  byte-identical. That covers an accidental delete, a bad `redigitize` and a
  corrupted record. **It does not cover losing the disk.** Getting a copy
  off this machine is still an open decision.

## Confidential material — where it lives

A real partner shop has not formally agreed to anything. Do not move any of
this into a public location or an example file.

Settled 2026-09-27: the two tracked files **stay tracked** (DECISIONS.md). They
are working reference material the project depends on. That is safe while this
repository is private and **must be revisited before it is ever made public.**

| What | Where | Tracked in git? |
|---|---|---|
| A supplier's sample charts transcribed — 39 charts, 413 colour names, their taxonomy | `docs/reference/leather-swatches.json` | **Yes** |
| Magna named, and how they work | `docs/magna-visit.md` | **Yes** |
| Live hide records and photos | `data/` | No, and never has been |
| Supplier chart photographs | `docs/reference/swatches/` | Empty by design |

The two tracked files are the ones to deal with before this repository is made
public. Nothing confidential is in a public location today, and nothing
confidential has ever been committed.

## Agent containment

No Docker and no dev container — the project does not use one, and adding one to
satisfy a checklist would be new infrastructure to maintain for no current
benefit. The recommended boundary is documented instead:

```
coding agent  ──>  this repo  ──>  data/ (a local scratch directory)
                                   venv/ (a local interpreter)
```

There is nothing else in reach. There are no credentials, no remote database, no
deploy target, and no production environment — so there is nothing for an agent
to be given access to by mistake. That is a property of the project's current
stage, not a control, and it stops being true the first time a hosted service is
added.

Runtime hook coverage (Prismor) is a per-machine install, not part of the repo —
see `CLAUDE.md`. Do not assume a clone has it.

## Production Gate

**Must pass before any real shop's data goes in.** Marked from what was actually
verified on 2026-09-27.

**This gate does not pass. It is not close to passing, and it is not meant to be
at this stage.**

| Item | Status | Basis |
|---|---|---|
| **Auth** | **FAIL** | None exists. Nothing authenticates or authorizes any request |
| **Tenant isolation tests** | **N/A** | Single shop by decision (DECISIONS.md, 2026-09-27). Nothing to isolate. Becomes FAIL the moment a second shop's data is introduced |
| **DB policies** | **N/A** | No database. Flat JSON files with filesystem permissions only |
| **Storage** | **PARTIAL PASS** | `data/` is no longer web-served, and a photo's `Content-Type` now comes from an allowlist on both write and read. Still no authorization on `/skins/:id/photo`, and no size limits |
| **Secrets** | **PASS** | None in the tree, none in 194 commits, no `process.env` reads at all. Nothing to rotate |
| **Dependencies** | **PASS** | `npm audit` clean. Python deps pinned exactly. No native Python audit in use — recheck before any release |
| **Input validation** | **PARTIAL PASS** | Outlines, interior cut rings, photo extensions, units, numeric fields and cross-origin writes are all validated. Upload size is not. Records written before these checks existed are not re-validated |
| **Destructive-action protection** | **FAIL** | `DELETE /skins/:id` removes a record and its photo immediately, with no confirmation server-side, no soft delete, and no undo |
| **Backup / recovery** | **PARTIAL PASS** | Hourly local snapshots via `scripts/backup-data.sh`, retaining the last 60 that differ; restore verified byte-identical. Same-disk only, so a disk failure still loses everything |
| **Separate dev/prod environments** | **N/A** | There is only one environment, running locally. No deploy exists |
| **No prod credentials available to coding agents** | **PASS** | Trivially — there are no credentials and no production |

### What would have to change first

In the order that reduces the most risk:

1. ~~**Back up `data/`.**~~ Done 2026-09-27 — hourly local snapshots. The
   remaining half is getting a copy off this machine.
2. **Make deletion recoverable** — soft delete, or a trash directory. A
   mis-clicked DELETE currently destroys a photographed hide and its outline.
   Backups blunt this to "lose up to an hour" rather than "lose it", which is why
   it dropped a place.
3. **Cap upload size.** One `formidable` option.
4. **Then, and only if this is ever exposed beyond loopback:** authentication,
   authorization on photo reads, rate limiting, and a real review of everything
   marked N/A above — none of which is worth writing while the answer to "who can
   reach it" is "the person sitting at the machine".
