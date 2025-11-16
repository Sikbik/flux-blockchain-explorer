-- Migration 011: Add support for fully shielded transactions
-- Adds is_shielded column to track transactions with no transparent components
-- These are Sapling/JoinSplit transactions where all inputs and outputs are shielded

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_shielded BOOLEAN DEFAULT FALSE;

-- Index for querying shielded transactions
CREATE INDEX IF NOT EXISTS idx_transactions_shielded
  ON transactions(is_shielded)
  WHERE is_shielded = TRUE;

-- Update statistics
ANALYZE transactions;

COMMENT ON COLUMN transactions.is_shielded IS 'True if transaction has no transparent inputs or outputs (fully shielded Sapling/JoinSplit)';
