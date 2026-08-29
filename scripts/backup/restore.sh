#!/usr/bin/env bash
#
# Restore Glosan's MongoDB from a restic snapshot.
# DESTRUCTIVE: replaces the current database (mongorestore --drop).
#
# Usage:  ./restore.sh [snapshotID|latest]
# Run a DRILL of this periodically — an untested backup is not a backup.
#
set -euo pipefail

# restic is installed as a static binary in ~/bin (see docs/backup.md). systemd
# runs services with a minimal PATH that does not include it, and a
# non-interactive shell never sources ~/.bashrc — so put it on PATH here rather
# than depending on however this script happened to be invoked.
export PATH="$HOME/bin:$PATH"
command -v restic >/dev/null || {
  echo "restic not found on PATH ($PATH) — see docs/backup.md" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${BACKUP_ENV:-$SCRIPT_DIR/backup.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "[restore] Missing config: $ENV_FILE" >&2
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

echo "About to RESTORE snapshot '$SNAPSHOT' from $RESTIC_REPOSITORY."
echo "This DROPS and reloads the '$MONGO_DB' database."
read -rp "Type 'restore' to proceed: " confirm
[ "$confirm" = "restore" ] || { echo "Aborted."; exit 1; }

DEST="$(mktemp -d)"
trap 'rm -rf "$DEST"' EXIT

echo "[restore] fetching snapshot $SNAPSHOT…"
restic restore "$SNAPSHOT" --target "$DEST"

ARCHIVE="$(find "$DEST" -name "$MONGO_DB.archive.gz" | head -1)"
[ -n "$ARCHIVE" ] || { echo "[restore] mongo archive not found in snapshot" >&2; exit 1; }

echo "[restore] restoring MongoDB (drop + reload)…"
docker exec -i "$MONGO_CONTAINER" mongorestore --archive --gzip --drop < "$ARCHIVE"

echo "[restore] done. Restart the backend so it reconnects cleanly:"
echo "  docker compose -f docker-compose.prod.yml restart backend"
