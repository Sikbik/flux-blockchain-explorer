-- Recalculate supply_stats from scratch
-- This script should be run after deploying the shielded pool calculation fix

BEGIN;

-- Backup existing supply_stats
CREATE TABLE IF NOT EXISTS supply_stats_backup AS
SELECT * FROM supply_stats;

-- Truncate supply_stats to force recalculation
TRUNCATE supply_stats;

COMMIT;

-- The indexer will automatically rebuild supply_stats as it re-indexes blocks
-- You can monitor progress with:
-- SELECT MAX(block_height) FROM supply_stats;
