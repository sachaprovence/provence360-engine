#!/usr/bin/env bash
# v1.0 — brief §16: a real, runnable pg_dump-based backup. See
# docs/BACKUP_RESTORE.md for the full runbook this script is one step of.
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/dbname" ./scripts/backup-db.sh [output-dir]
#
# Produces one custom-format (-Fc) dump file, timestamped, in output-dir
# (default: ./backups). Custom format because it's the one that supports
# pg_restore's --jobs (parallel restore) and selective table restore — a
# plain-SQL dump doesn't.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required (the schema-owning role — the same one migrations use)." >&2
  exit 1
fi

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$OUTPUT_DIR/provence360-${TIMESTAMP}.dump"

echo "Backing up to: $OUTPUT_FILE"
pg_dump --format=custom --no-owner --no-privileges --file="$OUTPUT_FILE" "$DATABASE_URL"

echo "Verifying the dump is readable (pg_restore --list, no data touched)..."
pg_restore --list "$OUTPUT_FILE" > /dev/null

SIZE="$(du -h "$OUTPUT_FILE" | cut -f1)"
echo "Backup complete: $OUTPUT_FILE ($SIZE)"
