#!/bin/bash
# Apply migration to optimize address summary triggers
# Run this on the server where PostgreSQL is running

set -e

MIGRATION_FILE="$1"

if [ -z "$MIGRATION_FILE" ]; then
  echo "Usage: $0 <migration_file>"
  echo "Example: $0 migrations/002_statement_level_triggers.sql"
  exit 1
fi

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

echo "========================================="
echo "Applying Migration: $MIGRATION_FILE"
echo "========================================="
echo ""

# Read database credentials from environment or use defaults
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-flux_indexer}"
DB_USER="${POSTGRES_USER:-flux}"
DB_PASSWORD="${POSTGRES_PASSWORD:-flux}"

echo "Target Database:"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""

# Apply migration
echo "Applying migration..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
  echo ""
  echo "========================================="
  echo "Migration applied successfully!"
  echo "========================================="
  echo ""
  echo "Verifying triggers..."
  PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT
      trigger_name,
      event_manipulation,
      action_timing,
      action_orientation
    FROM information_schema.triggers
    WHERE event_object_table = 'utxos'
    ORDER BY trigger_name;
  "
else
  echo ""
  echo "========================================="
  echo "Migration FAILED!"
  echo "========================================="
  exit 1
fi
