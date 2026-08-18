#!/usr/bin/env bash
# v1.0 — brief §16: restores a pg_dump custom-format backup. See
# docs/BACKUP_RESTORE.md for the full runbook.
#
# DESTRUCTIVE. Deliberately has no default target and no default dump file
# — both must be passed explicitly — and requires typing the target
# database's own name back as confirmation, so a copy-pasted command from
# a different context (a staging runbook, a stale shell history entry)
# can't silently restore over the wrong database.
#
# Usage:
#   ./scripts/restore-db.sh \
#     --target-url="postgresql://user:pass@host:5432/dbname" \
#     --dump=./backups/provence360-20260101T000000Z.dump \
#     --confirm=dbname

set -euo pipefail

TARGET_URL=""
DUMP_FILE=""
CONFIRM_NAME=""

for arg in "$@"; do
  case "$arg" in
    --target-url=*) TARGET_URL="${arg#--target-url=}" ;;
    --dump=*) DUMP_FILE="${arg#--dump=}" ;;
    --confirm=*) CONFIRM_NAME="${arg#--confirm=}" ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_URL" || -z "$DUMP_FILE" || -z "$CONFIRM_NAME" ]]; then
  echo "Usage: $0 --target-url=postgresql://... --dump=path/to/file.dump --confirm=<database-name>" >&2
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Dump file not found: $DUMP_FILE" >&2
  exit 1
fi

# Extract the database name from the target URL's own path component —
# never trusted from a separate, independently-typed argument alone.
TARGET_DB_NAME="$(basename "${TARGET_URL#*://*/}")"
TARGET_DB_NAME="${TARGET_DB_NAME%%\?*}"

if [[ "$CONFIRM_NAME" != "$TARGET_DB_NAME" ]]; then
  echo "Refusing to proceed: --confirm=\"$CONFIRM_NAME\" does not match the target URL's own database name (\"$TARGET_DB_NAME\")." >&2
  echo "This is deliberate — type the exact target database name to proceed." >&2
  exit 1
fi

echo "About to restore into: $TARGET_DB_NAME"
echo "  from: $DUMP_FILE"
echo "This will DROP AND RECREATE every object the dump contains in that database."
read -r -p "Type the database name again to proceed: " FINAL_CONFIRM
if [[ "$FINAL_CONFIRM" != "$TARGET_DB_NAME" ]]; then
  echo "Confirmation did not match — aborted, nothing was touched." >&2
  exit 1
fi

echo "Restoring..."
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_URL" "$DUMP_FILE"

echo "Restore complete. Verify with:"
echo "  psql \"$TARGET_URL\" -c 'select count(*) from tenants;'"
