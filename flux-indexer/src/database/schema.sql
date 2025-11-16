-- FluxIndexer Database Schema
-- PostgreSQL 15+
-- Optimized for Flux PoN (Proof of Node) blockchain

-- Drop existing tables (for clean migrations)
DROP TABLE IF EXISTS reorgs CASCADE;
DROP TABLE IF EXISTS sync_state CASCADE;
DROP TABLE IF EXISTS producers CASCADE;
DROP TABLE IF EXISTS address_summary CASCADE;
DROP TABLE IF EXISTS utxos CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS blocks CASCADE;

-- Blocks table
CREATE TABLE blocks (
  height INTEGER PRIMARY KEY,
  hash TEXT UNIQUE NOT NULL,
  prev_hash TEXT,
  merkle_root TEXT,
  timestamp INTEGER NOT NULL,
  bits TEXT,
  nonce TEXT,  -- Changed to TEXT to handle very large nonce values
  version INTEGER,
  size INTEGER,
  tx_count INTEGER DEFAULT 0,
  producer TEXT,  -- FluxNode IP/ID that produced this block (PoN)
  producer_reward BIGINT,
  difficulty DECIMAL(20, 8),
  chainwork TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_blocks_hash ON blocks(hash);
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX idx_blocks_producer ON blocks(producer) WHERE producer IS NOT NULL;
CREATE INDEX idx_blocks_prev_hash ON blocks(prev_hash);

-- Transactions table
CREATE TABLE transactions (
  txid TEXT PRIMARY KEY,
  block_height INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  timestamp INTEGER,
  version INTEGER,
  locktime BIGINT,
  size INTEGER,
  vsize INTEGER,
  input_count INTEGER DEFAULT 0,
  output_count INTEGER DEFAULT 0,
  input_total BIGINT DEFAULT 0,
  output_total BIGINT DEFAULT 0,
  fee BIGINT DEFAULT 0,
  is_coinbase BOOLEAN DEFAULT false,
  hex TEXT,  -- Raw transaction hex (optional, for full data)
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (block_height) REFERENCES blocks(height) ON DELETE CASCADE
);

CREATE INDEX idx_tx_block_height ON transactions(block_height);
CREATE INDEX idx_tx_block_hash ON transactions(block_hash);
CREATE INDEX idx_tx_timestamp ON transactions(timestamp DESC);
CREATE INDEX idx_tx_coinbase ON transactions(is_coinbase) WHERE is_coinbase = true;
CREATE INDEX idx_tx_block_height_coinbase_txid ON transactions(block_height, is_coinbase, txid);

-- UTXOs (Unspent Transaction Outputs)
CREATE TABLE utxos (
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  address TEXT NOT NULL,
  value BIGINT NOT NULL,
  script_pubkey TEXT,
  script_type TEXT,  -- pubkeyhash, scripthash, etc.
  block_height INTEGER NOT NULL,
  spent BOOLEAN DEFAULT false,
  spent_txid TEXT,
  spent_block_height INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  spent_at TIMESTAMP,
  PRIMARY KEY (txid, vout)
);

-- Critical indexes for address queries
CREATE INDEX idx_utxo_address_unspent ON utxos(address) WHERE spent = false;
CREATE INDEX idx_utxo_address_spent ON utxos(address, spent);
CREATE INDEX idx_utxo_spent ON utxos(spent, block_height);
CREATE INDEX idx_utxo_block_height ON utxos(block_height);
CREATE INDEX idx_utxo_spent_txid ON utxos(spent_txid) WHERE spent_txid IS NOT NULL;

-- Address summary (for quick balance lookups)
CREATE TABLE address_summary (
  address TEXT PRIMARY KEY,
  balance BIGINT NOT NULL DEFAULT 0,
  tx_count INTEGER NOT NULL DEFAULT 0,
  received_total BIGINT NOT NULL DEFAULT 0,
  sent_total BIGINT NOT NULL DEFAULT 0,
  unspent_count INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER,
  last_activity INTEGER,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_address_balance ON address_summary(balance DESC);
CREATE INDEX idx_address_activity ON address_summary(last_activity DESC);
CREATE INDEX idx_address_tx_count ON address_summary(tx_count DESC);

-- FluxNode producers (PoN specific)
CREATE TABLE producers (
  fluxnode TEXT PRIMARY KEY,  -- IP or unique identifier
  blocks_produced INTEGER DEFAULT 0,
  first_block INTEGER,
  last_block INTEGER,
  total_rewards BIGINT DEFAULT 0,
  avg_block_time DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_producer_blocks ON producers(blocks_produced DESC);
CREATE INDEX idx_producer_last_block ON producers(last_block DESC);
CREATE INDEX idx_producer_total_rewards ON producers(total_rewards DESC);

-- Sync state (single row table tracking indexer progress)
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Only one row
  current_height INTEGER NOT NULL DEFAULT 0,
  chain_height INTEGER NOT NULL DEFAULT 0,
  sync_percentage DECIMAL(5,2) DEFAULT 0,
  last_block_hash TEXT,
  last_sync_time TIMESTAMP,
  is_syncing BOOLEAN DEFAULT false,
  sync_start_time TIMESTAMP,
  blocks_per_second DECIMAL(10, 2),
  estimated_completion TIMESTAMP
);

-- Initialize sync state
-- Start from -1 so first sync fetches block 0 (genesis)
INSERT INTO sync_state (id, current_height, chain_height) VALUES (1, -1, 0)
ON CONFLICT (id) DO NOTHING;

-- Reorg history (track chain reorganizations)
CREATE TABLE reorgs (
  id SERIAL PRIMARY KEY,
  from_height INTEGER NOT NULL,
  to_height INTEGER NOT NULL,
  common_ancestor INTEGER NOT NULL,
  old_hash TEXT,
  new_hash TEXT,
  blocks_affected INTEGER,
  occurred_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_reorg_from_height ON reorgs(from_height);
CREATE INDEX idx_reorg_occurred_at ON reorgs(occurred_at DESC);

-- Supply statistics (track shielded pool and total supply)
-- Note: No foreign key to allow Fast Sync Mode (UNLOGGED tables optimization)
CREATE TABLE IF NOT EXISTS supply_stats (
  block_height INTEGER PRIMARY KEY,
  transparent_supply BIGINT NOT NULL DEFAULT 0,
  shielded_pool BIGINT NOT NULL DEFAULT 0,
  total_supply BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_block_height ON supply_stats(block_height DESC);

-- Helper function to calculate address balance
CREATE OR REPLACE FUNCTION calculate_address_balance(addr TEXT)
RETURNS BIGINT AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(value) FROM utxos WHERE address = addr AND spent = false),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Helper function to update address summary
CREATE OR REPLACE FUNCTION update_address_summary(addr TEXT)
RETURNS VOID AS $$
DECLARE
  summary_data RECORD;
BEGIN
  -- Single query to calculate all statistics at once (7x faster than 7 separate queries)
  SELECT
    COALESCE(SUM(CASE WHEN spent = false THEN value ELSE 0 END), 0) as balance,
    COALESCE(SUM(value), 0) as received,
    COALESCE(SUM(CASE WHEN spent = true THEN value ELSE 0 END), 0) as sent,
    COUNT(DISTINCT txid) as tx_count,
    COUNT(CASE WHEN spent = false THEN 1 END) as unspent_count,
    MIN(block_height) as first_seen,
    MAX(GREATEST(block_height, COALESCE(spent_block_height, 0))) as last_activity
  INTO summary_data
  FROM utxos
  WHERE address = addr;

  -- Upsert address summary
  INSERT INTO address_summary (
    address, balance, tx_count, received_total, sent_total,
    unspent_count, first_seen, last_activity, updated_at
  ) VALUES (
    addr,
    summary_data.balance,
    summary_data.tx_count,
    summary_data.received,
    summary_data.sent,
    summary_data.unspent_count,
    summary_data.first_seen,
    summary_data.last_activity,
    NOW()
  )
  ON CONFLICT (address) DO UPDATE SET
    balance = EXCLUDED.balance,
    tx_count = EXCLUDED.tx_count,
    received_total = EXCLUDED.received_total,
    sent_total = EXCLUDED.sent_total,
    unspent_count = EXCLUDED.unspent_count,
    first_seen = EXCLUDED.first_seen,
    last_activity = EXCLUDED.last_activity,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE blocks IS 'Indexed blockchain blocks';
COMMENT ON TABLE transactions IS 'All blockchain transactions';
COMMENT ON TABLE utxos IS 'Unspent and spent transaction outputs (UTXO set)';
COMMENT ON TABLE address_summary IS 'Cached address balances and statistics';
COMMENT ON TABLE producers IS 'FluxNode block producers (PoN consensus)';
COMMENT ON TABLE sync_state IS 'Indexer synchronization state';
COMMENT ON TABLE reorgs IS 'Blockchain reorganization history';

COMMENT ON COLUMN blocks.producer IS 'FluxNode that produced this block (PoN)';
COMMENT ON COLUMN blocks.producer_reward IS 'Block reward paid to producer';
COMMENT ON COLUMN utxos.spent IS 'Whether this UTXO has been spent';
COMMENT ON COLUMN utxos.spent_txid IS 'Transaction ID that spent this UTXO';
