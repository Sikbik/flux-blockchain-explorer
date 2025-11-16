-- Performance Indexes for Production Deployment
-- Created: 2025-11-08
-- These indexes dramatically improve query performance for the explorer frontend

-- =============================================================================
-- FLUXNODE TRANSACTIONS - Required for "Latest Blocks" query
-- =============================================================================
-- Without this index, queries joining blocks with fluxnode_transactions take 50+ seconds
-- With this index, same queries complete in milliseconds
CREATE INDEX IF NOT EXISTS idx_fluxnode_transactions_block_height
  ON fluxnode_transactions(block_height);

COMMENT ON INDEX idx_fluxnode_transactions_block_height IS
  'Speeds up Latest Blocks query that counts FluxNode confirmations per block';

-- =============================================================================
-- TRANSACTIONS - Required for block/transaction joins and coinbase filtering
-- =============================================================================
-- Index for fast block_height lookups and joins
CREATE INDEX IF NOT EXISTS idx_transactions_block_height
  ON transactions(block_height);

-- Partial index for coinbase transactions only (saves space)
-- Used for filtering coinbase transactions efficiently
CREATE INDEX IF NOT EXISTS idx_transactions_is_coinbase
  ON transactions(is_coinbase)
  WHERE is_coinbase = true;

-- Composite index for "Latest Block Rewards" queries
-- DESC order allows fast retrieval of most recent coinbase transactions
CREATE INDEX IF NOT EXISTS idx_transactions_block_height_coinbase
  ON transactions(block_height DESC, is_coinbase)
  WHERE is_coinbase = true;

COMMENT ON INDEX idx_transactions_block_height IS
  'Speeds up block-transaction joins and block lookups';
COMMENT ON INDEX idx_transactions_is_coinbase IS
  'Partial index for fast coinbase transaction filtering';
COMMENT ON INDEX idx_transactions_block_height_coinbase IS
  'Optimizes Latest Block Rewards query (recent coinbase transactions)';

-- =============================================================================
-- ADDRESS SUMMARY - Required for Rich List sorting
-- =============================================================================
-- Without this index, Rich List page takes 4-10 seconds due to sorting 980K rows
-- With this index, Rich List loads in under 1 second
CREATE INDEX IF NOT EXISTS idx_address_summary_balance
  ON address_summary(balance DESC);

COMMENT ON INDEX idx_address_summary_balance IS
  'Speeds up Rich List page by enabling fast sorting by balance';

-- =============================================================================
-- PERFORMANCE IMPACT SUMMARY
-- =============================================================================
-- Latest Blocks:       50+ seconds → ~100ms  (500x faster)
-- Latest Block Rewards: 10 seconds → ~100ms  (100x faster)
-- Rich List:           4-10 seconds → <1s    (4-10x faster)
-- =============================================================================
