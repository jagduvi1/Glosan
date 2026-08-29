#!/usr/bin/env bash
#
# Nightly backup of Glosan's irreplaceable data to a restic repository
# (a Hetzner Storage Box over SFTP): a gzipped mongodump of the `glosan`
# database. restic encrypts, deduplicates and applies retention.
#
# Unlike Cellarion, Glosan stores nothing on disk outside MongoDB — the
# backend mounts no volumes — so the dump is the whole backup.
#
# Usage:  ./backup.sh            (reads ./backup.env)
#         BACKUP_ENV=/path/env ./backup.sh
# Run it from systemd on the VM host — see docs/backup.md.
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
  echo "[backup] Missing config: $ENV_FILE — copy backup.env.example and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $ENV_FILE}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD in $ENV_FILE}"
export RESTIC_REPOSITORY RESTIC_PASSWORD

MONGO_CONTAINER="${MONGO_CONTAINER:-glosan-mongo}"
MONGO_DB="${MONGO_DB:-glosan}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${KEEP_MONTHLY:-6}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

log() { echo "[backup] $(date -Is) $*"; }
ping_fail() {
  [ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL%/}/fail" >/dev/null 2>&1 || true
}

STAGE="$(mktemp -d)"
trap 'ping_fail' ERR
trap 'rm -rf "$STAGE"' EXIT

log "dumping MongoDB '$MONGO_DB' from $MONGO_CONTAINER…"
mkdir -p "$STAGE/mongo"
docker exec "$MONGO_CONTAINER" mongodump --db "$MONGO_DB" --archive --gzip > "$STAGE/mongo/$MONGO_DB.archive.gz"

# A mongodump of an empty/missing database still exits 0 and writes a tiny
# archive. Refuse to upload that — it would silently rotate away good
# snapshots over the retention window.
DUMP_BYTES=$(stat -c %s "$STAGE/mongo/$MONGO_DB.archive.gz")
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-1024}"
if [ "$DUMP_BYTES" -lt "$MIN_DUMP_BYTES" ]; then
  log "ERROR: dump is only ${DUMP_BYTES}B (< ${MIN_DUMP_BYTES}B) — refusing to back up a possibly empty database"
  exit 1
fi
log "dump is ${DUMP_BYTES} bytes"

log "ensuring restic repository exists…"
restic snapshots >/dev/null 2>&1 || restic init

log "uploading encrypted snapshot to $RESTIC_REPOSITORY…"
restic backup --tag glosan --host glosan "$STAGE"

log "pruning (keep ${KEEP_DAILY}d / ${KEEP_WEEKLY}w / ${KEEP_MONTHLY}m)…"
restic forget --tag glosan --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --prune

# Optional second, off-provider copy (e.g. Backblaze B2) so a Hetzner-account
# level loss can't wipe everything. Enable by setting B2_* in backup.env.
if [ -n "${B2_RESTIC_REPOSITORY:-}" ]; then
  export B2_ACCOUNT_ID="${B2_ACCOUNT_ID:-}" B2_ACCOUNT_KEY="${B2_ACCOUNT_KEY:-}"
  log "copying snapshots to off-provider repo $B2_RESTIC_REPOSITORY…"
  restic -r "$B2_RESTIC_REPOSITORY" snapshots >/dev/null 2>&1 \
    || restic -r "$B2_RESTIC_REPOSITORY" init --copy-chunker-params --from-repo "$RESTIC_REPOSITORY"
  restic -r "$B2_RESTIC_REPOSITORY" copy --from-repo "$RESTIC_REPOSITORY" --tag glosan
  restic -r "$B2_RESTIC_REPOSITORY" forget --tag glosan --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --prune
fi

log "backup complete."
[ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 --retry 3 "${HEALTHCHECK_URL%/}" >/dev/null 2>&1 || true
