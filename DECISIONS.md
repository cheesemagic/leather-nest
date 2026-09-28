# Decisions

Settled choices, newest first. A decision lands here once it stops being
reopened. The reasoning matters more than the choice — if you are about to undo
one, the thing to argue with is the *why*.

Fuller reasoning for most of these is in `docs/superpowers/specs/`.

---

## 2026-09-27 — Single shop, local tool. No multi-tenancy.

One shop, one operator, one machine, bound to `127.0.0.1`. No accounts, no
users, no tenant or shop scoping, no auth layer.

**Why:** an earlier framing had this as a multi-tenant SaaS licensed to many
shops, with every business record shop-scoped from day one. That is not what
was built, and after six weeks of work in the other direction it is not what
is wanted now. Carrying a tenancy requirement nobody implements would mean
every document in the repo describes a wish instead of a rule.

**Consequence:** do not add tenant ids, shop scoping or auth speculatively.
`SECURITY.md`'s Production Gate records what would have to become true before
any real customer's data went in. Revisit this entry, not the code, if
licensing to other shops comes back.

## 2026-09-27 — Only `public/`, `src/` and `node_modules/` are web-reachable.

`serveStatic` serves files from an allowlist of three directories.

**Why:** it previously served any file under the repo root. Verified at the
time: `.git/config`, `.git/HEAD`, `.claude/settings.local.json` and live hide
records under `data/` all answered 200. The existing guard only stopped a path
from climbing *out* of the repo, which was never the exposure.

**An allowlist, not a deny-list,** so a directory added later is private until
someone decides otherwise.

## 2026-09-27 — A stored photo's extension comes from an allowlist, never the client.

`.jpg`, `.jpeg` or `.png`. Anything else is stored as `.jpg`.

**Why:** the extension came straight from the uploaded filename, and both the
photo routes and the static server derive a `Content-Type` from it — so a file
uploaded as `hide.html` was stored as one and served as a page from this app's
own origin. The bytes decide what a file is; OpenCV reads those itself rather
than trusting a name.

HEIC is deliberately absent. OpenCV cannot read it, so an iPhone photo straight
off the camera roll already fails digitization — storing it under a name that
claims otherwise would not change that.

## 2026-09-27 — Cross-origin writes are refused.

Any non-GET request whose `Origin` is set and is not this server gets a 403. A
*missing* `Origin` is allowed through.

**Why:** a browser sends a cross-origin multipart POST with no preflight, so
before this any page the operator happened to visit could create and rewrite
hide records on `localhost:8080`. `DELETE` was already covered, because CORS
preflights it. Allowing a missing `Origin` keeps curl and the test suite
working; they are not the threat this is for.

## 2026-09-27 — Invalid geometry is refused at the boundary, not repaired.

`validatePolygon` rejects fewer than three points, non-finite coordinates, zero
area, self-crossing outlines, and anything over ten metres across.

**Why:** clipper does not complain about a self-crossing path — it applies a
fill rule and then answers containment questions with confidence about the
wrong region. So a broken outline does not fail loudly, it produces a layout
that looks fine and cuts wrong.

**Not a repair,** because a shape that badly formed means the photo, the
selected region or the file was wrong, and silently straightening it hides what
the operator needs to fix. The ten-metre ceiling is a unit-error trap, not a bed
size: the realistic failure is a file read in the wrong unit, which lands 10x to
100x out.

## 2026-09-27 — Unreadable output from a photo script is a failure, not a crash.

`execPython` treats non-JSON output on a zero exit as an error.

**Why:** seven handlers called `JSON.parse` on that output with no catch, inside
an `execFile` callback that nothing above catches either. One malformed line
took the whole server down and left the operator's upload in the temp
directory. The wrapper owns the guard for the same reason it owns the timeout —
every call site had forgotten it.

## 2026-09-27 — The supplier catalogue and the Magna notes stay tracked.

`docs/reference/leather-swatches.json` and `docs/magna-visit.md` remain in git.

**Why:** Andrew's call, asked and answered. They are working reference material
the project depends on — the catalogue is the only source for the names the
operator and Magna actually use for a colour, and the visit notes are the brief
for the one trip that unblocks matching. Keeping them out of the repo to be
cautious would mean the project's own reasoning lived somewhere nobody reads.

**The obligation does not go away.** Both came from a real supplier and a real
shop that have not formally agreed to anything, and `AGENTS.md` still names them
as confidential: they must not be copied into example files, published pages, or
anything that leaves the repo. **This decision is safe only while the repository
is private, and has to be revisited before it is ever made public** — not
reopened lightly, but genuinely reconsidered, because the audience changes.

## 2026-09-27 — data/ is snapshotted hourly by cron.

`scripts/backup-data.sh`, run hourly, writing tarballs **into iCloud Drive** —
outside the repository, so deleting or re-cloning it cannot take the backups
with it, and off the machine, so a dead drive cannot either. Keeps the last 60
snapshots that differ from each other; identical ones are skipped, so the window
counts real changes rather than elapsed hours.

Where they go is a per-machine choice, set by `LEATHER_NEST_BACKUPS` in the cron
line rather than hard-coded. The script's own default stays local.

**Why:** `data/` is gitignored on purpose, because it holds real hide photos,
which meant nothing versioned it at all. Two photographed hides and eight
digitised components existed in exactly one place, and `redigitize()` replaces a
hide's outline outright — so a bad re-photograph destroys the old one with no
undo. This was the only FAIL on the production gate that was costing something
today.

**Cron rather than Time Machine** because Time Machine has **no destination
configured on this machine**. `data/` reports as included, which is meaningless
without somewhere to back up to. If a Time Machine disk is ever attached, it
covers more than this does and this becomes the second line of defence.

**iCloud rather than an external drive or object storage**, because the account
was already signed in, the data is 132KB, and it needed no new credential — this
project's `SECURITY.md` gets a PASS on secrets precisely because it has none, and
an S3 key would have been the first. Verified by writing into the folder and
watching iCloud's own sync state advance, rather than assuming.

**Two things this trades away, both fine at 132KB and neither fine later.** The
archives are unencrypted on a consumer cloud, and hide photos are a partner
shop's material. And 60 *full* snapshots rather than differences means a 500MB
photo library would want 30GB up there. **The first real hide photograph is the
trigger to revisit both** — probably encrypting the archive, and moving to a
deduplicating tool.

## 2026-09-27 — A closed cut ring is validated like an outline.

`validateInteriorPaths` refuses a closed `cut` ring that crosses itself.

**Why:** a hole is an outline too. The exporter writes interior cut rings in the
same colour as the real cuts, so a self-crossing ring becomes an X slashed
across the finished piece — and nothing between the upload and the laser file
questioned it.

**In `validateInteriorPaths`, not `validatePolygon`,** because a real stitch hole
measures about half a square millimetre and `validatePolygon`'s
one-square-millimetre floor would refuse every one of them. Closed `cut` rings
only: an open path is a stitch guide with no inside to be ambiguous about, and a
decorative `mark` may legitimately cross itself.

## 2026-09-27 — Test isolation is unconditional.

`test/helpers/with-server.js` gives every store a temp directory on every call,
whether or not the caller asks.

**Why:** it used to apply the default — the operator's real `data/` — unless a
test set a `withXDataDir` flag. `test/upload-boundary.test.js` passed its options
as `test(name, fn, options)`, which `node:test` accepts and silently drops, so
every case in it wrote to the real `data/sessions/` and left 81 records and their
photos behind. The suite reported 593 passes throughout.

A helper whose default is the production directory is the bug; a convention about
remembering a flag is not a fix. Isolation now cannot be opted out of.

## 2026-09-27 — Subagents are committed; the rest of `.claude/` is not.

`.gitignore` excludes `.claude/*` but re-includes `.claude/agents/`.

**Why:** `settings.local.json` and `launch.json` are per-machine. A verifier
that encodes what to distrust about work in *this* repo is project knowledge —
worthless on the one machine that already has it, and worth having in every
clone. Written as `.claude/*` rather than `.claude/` because git cannot
re-include anything inside an excluded directory.

## 2026-09-26 — A component can be required to stay with its set.

`mustMatch` on a component. Absent means true.

**Why:** a product's visible pieces have to come off one hide or the finished
item has mismatched panels. Interior pieces that nobody sees can span hides.
Absent defaults to true so a caller that does not mention it cannot silently
make a visible piece spannable.

## 2026-09-26 — `finish` is one field, and a hard gate on matching.

matte / glossy / suede / hand-painted / pebble grain / hand-painted two-tone /
nappa. Operator-set.

**Why:** gloss cannot be measured from a photo — it is lighting-dependent. One
field even though the values span gloss, treatment and grain, because every
supplier chart states exactly one of them; splitting it would invent structure
the source does not have. A suede hide and a glossy one are never a pair.
`semi-gloss` was invented on our side and is gone; a test keeps it gone.

## 2026-09-25 — `cut` is a hard gate on matching.

whole / belly / full quill / hornback / leg / tail. `null` when unknown.

**Why:** a caiman tail and a caiman belly are different scale geometry, and the
supplier sells both as species "caiman". Two hides with known, different cuts
never pair. Unknown on either side still pairs but is flagged `unverified` and
sorts last. **`multispine` is in the supplier charts but is not a cut** — do not
add it.

## 2026-09-25 — Colour ranks pairs; it does not gate them.

CIEDE2000 at `COLOUR_LIGHTNESS_WEIGHT = 0`, so `colourL` never reaches the
result.

**Why:** lightness sampled from a phone photo tracks exposure and glare more
than dye. A threshold would need real labelled hide pairs, which do not exist
yet — so colour orders candidates and a human decides.

## 2026-09-22 — "Dies" became "Components"/"Parts".

**Why:** a laser job involves no die at all. `dieClearanceMm` survived the
rename because it is a genuinely different concept — the clearance a physical
steel-rule die needs when a piece is die-cut rather than lasered.

## 2026-09-21 — First-fit placement stays, for now.

`place.js` takes the first position where a part fits, scanning from the bottom
left.

**Why:** measured — a deeply concave L places exactly as many pieces as its
convex hull, despite the hull being 32% larger. Interlocking is real but
deferred until exotics are actually being cut, because the packing gain is
unproven against a real job and the current behaviour is correct, just loose.

## 2026-09-01 — Internally "skins", user-facing "Hides".

Routes and the data directory keep the old name.

**Why:** a rename would touch every route, every store path and every existing
record for no behavioural gain. See
`docs/superpowers/specs/2026-09-01-hide-library-design.md`.

## 2026-08-24 — NFP via clipper's Minkowski sum. No convex decomposition.

**Why:** `MinkowskiSum` is **exact for concave parts too**. The file claimed
"convex only" for months; a convex decomposition was built on that claim,
measured, found to change nothing, and deleted. `test/nfp.test.js` guards the
real behaviour. Do not rebuild it.

SVGnest's orbiting-NFP code is not used, for a separate licensing reason — see
`docs/superpowers/specs/2026-08-24-leather-nesting-design.md`.

## Open, deliberately

- **The target machine.** Large-bed CO2, SVG in. Nothing more is settled, and
  nothing should be designed against a specific controller until someone has
  stood at one.
- **Every physical constant.** Clearances, packing efficiency, kerf. All chosen
  in conversation, none measured against cut leather.
- **What actually makes two hides a match.** The program guesses from scale and
  colour. The people who do it by hand have not been asked yet — see
  `docs/magna-visit.md`.
