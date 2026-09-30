#!/usr/bin/env bash
#
# Restore DRILL — proves a snapshot can actually be restored, without touching
# production: restores it into a throwaway MongoDB container (no network,
# capped memory), then lists every collection next to the live database's
# (read-only counts). Everything it creates is removed on exit.
#
# Usage:  ./drill.sh [snapshotID|latest]
# Run it once a month, and after changing anything in the backup setup.
# (restore.sh is the real, destructive restore.)
#
set -euo pipefail

# restic is installed as a static binary in ~/bin (see docs/backup.md).
export PATH="$HOME/bin:$PATH"
command -v restic >/dev/null || {
  echo "restic not found on PATH ($PATH) — see docs/backup.md" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ENV_FILE="${BACKUP_ENV:-$SCRIPT_DIR/backup.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[drill] Missing config: $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $ENV_FILE}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD in $ENV_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD

MONGO_CONTAINER="${MONGO_CONTAINER:-glosan-mongo}"
MONGO_DB="${MONGO_DB:-glosan}"
SNAPSHOT="${1:-latest}"
DRILL=glosan-restore-drill

DEST="$(mktemp -d)"
FROM_BACKUP="$(mktemp)"
LIVE="$(mktemp)"
cleanup() {
  docker rm -f "$DRILL" >/dev/null 2>&1 || true
  rm -rf "$DEST" "$FROM_BACKUP" "$LIVE"
}
trap cleanup EXIT

restic snapshots --compact "$SNAPSHOT"
restic restore "$SNAPSHOT" --target "$DEST" --quiet
ARCHIVE="$(find "$DEST" -name "$MONGO_DB.archive.gz" | head -1)"
[ -n "$ARCHIVE" ] || { echo "[drill] mongo archive not found in snapshot" >&2; exit 1; }
echo "[drill] fetched a $(du -h "$ARCHIVE" | cut -f1) archive"

# Same image as production, but no network and capped memory, so it can never
# compete with the live database for RAM. A leftover from an aborted run goes first.
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$MONGO_CONTAINER")"
docker rm -f "$DRILL" >/dev/null 2>&1 || true
docker run -d --name "$DRILL" --network none --memory 512m "$IMAGE" --wiredTigerCacheSizeGB 0.25 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$DRILL" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$DRILL" mongorestore --archive --gzip --quiet < "$ARCHIVE"
echo "[drill] restored into a throwaway $IMAGE"

COUNT='db.getCollectionNames().sort().forEach((c) =>
  print(c + " " + db.getCollection(c).countDocuments({}) + "/" + db.getCollection(c).getIndexes().length));'
docker exec "$DRILL" mongosh --quiet "$MONGO_DB" --eval "$COUNT" | sort > "$FROM_BACKUP"
docker exec "$MONGO_CONTAINER" mongosh --quiet "$MONGO_DB" --eval "$COUNT" | sort > "$LIVE"

echo "[drill] collection                 backup docs/indexes | live now"
join -a1 -a2 -e '-' -o 0,1.2,2.2 "$FROM_BACKUP" "$LIVE" |
  awk '{ printf "  %-26s %20s | %s%s\n", $1, $2, $3, ($2 == $3 ? "" : "   (differs)") }'

docker exec "$DRILL" mongosh --quiet "$MONGO_DB" --eval '
const users = db.users.countDocuments({});
if (users === 0) { print("[drill] FAILED: the backup has no users"); quit(1); }
const newest = db.users.find({}, { createdAt: 1 }).sort({ createdAt: -1 }).limit(1).next();
print("[drill] " + users + " users (" + db.users.countDocuments({ roles: "admin" }) + " admin), newest created "
  + (newest.createdAt ? newest.createdAt.toISOString() : "?"));
print("[drill] " + db.glos.distinct("list").length + " of " + db.gloslists.countDocuments({}) + " lists have words");'

echo "[drill] OK — the snapshot restores. Differences above are changes made after it was taken."
