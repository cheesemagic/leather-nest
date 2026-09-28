#!/bin/sh
# Snapshots data/ -- the hide records, component geometry and photos -- into a
# timestamped tarball OUTSIDE the repository.
#
# Why this exists: data/ is gitignored on purpose (it holds real hide photos),
# so nothing versioned it. Two hides and eight digitised components existed in
# exactly one place on one disk, and a mis-clicked DELETE or a bad
# re-photograph destroys one permanently -- redigitize() replaces a hide's
# outline outright and resets how much of it is left.
#
# RESTORE: pick a snapshot and unpack it over the repo.
#
#   tar tzf ~/leather-nest-backups/data-2026-09-27T140000.tgz        # look first
#   tar xzf ~/leather-nest-backups/data-2026-09-27T140000.tgz -C ~/leather-nest
#
# The tarball stores paths as `data/...`, so it unpacks straight back into
# place. It ADDS and OVERWRITES; it never deletes. To roll back to exactly a
# snapshot, move the current data/ aside first.
#
# Deliberately not offsite. This survives an accidental delete, a bad
# redigitize and a corrupted record -- the likely losses. It does NOT survive
# losing the disk. Copying ~/leather-nest-backups to anything that leaves the
# house is a separate decision nobody has made yet.

set -eu

REPO="${LEATHER_NEST_REPO:-$HOME/leather-nest}"
DEST="${LEATHER_NEST_BACKUPS:-$HOME/leather-nest-backups}"
KEEP=60

[ -d "$REPO/data" ] || { echo "no data directory at $REPO/data, nothing to back up"; exit 0; }

mkdir -p "$DEST"

# Skip an identical snapshot. Without this, an hourly schedule spends its whole
# retention window on copies of a day when nothing happened -- so KEEP counts
# real CHANGES, not elapsed hours.
#
# Hashes the file list with sizes and modification times rather than the
# contents: at this size either would do, and this one stays fast if the photo
# library grows.
fingerprint() {
  find "$REPO/data" -type f -exec stat -f '%N %z %m' {} \; 2>/dev/null | sort | shasum | cut -d' ' -f1
}

CURRENT="$(fingerprint)"
STAMP_FILE="$DEST/.last-fingerprint"

if [ -f "$STAMP_FILE" ] && [ "$CURRENT" = "$(cat "$STAMP_FILE")" ]; then
  exit 0
fi

# Seconds included: two changes inside the same minute collided on the filename
# and the second silently overwrote the first, which quietly turned "keep the
# last 60 changes" into "keep the last 60 minutes that had one".
ARCHIVE="$DEST/data-$(date +%Y-%m-%dT%H%M%S).tgz"

# ponytail: no locking. A flat-file store writes a record with one
# writeFileSync, so a snapshot taken mid-write could in principle catch a
# truncated JSON file -- but the previous snapshot is still intact, which is the
# whole point of keeping several. Revisit if anything automated ever writes
# these records.
tar czf "$ARCHIVE" -C "$REPO" data

printf '%s' "$CURRENT" > "$STAMP_FILE"

# Keep the newest KEEP snapshots. `ls -t` newest-first, skip that many, delete
# the tail.
ls -t "$DEST"/data-*.tgz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done

echo "backed up $(find "$REPO/data" -type f | wc -l | tr -d ' ') files to $ARCHIVE"
