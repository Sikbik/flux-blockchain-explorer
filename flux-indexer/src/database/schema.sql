-- FluxIndexer Database Schema
-- PostgreSQL 15+ with TimescaleDB
-- Optimized for Flux blockchain with time-series compression

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Drop existing tables (for clean migrations)
DROP TABLE IF EXISTS reorgs CASCADE;
DROP TABLE IF EXISTS sync_state CASCADE;
DROP TABLE IF EXISTS producers CASCADE;
DROP TABLE IF EXISTS address_summary CASCADE;
DROP TABLE IF EXISTS fluxnode_transactions CASCADE;
DROP TABLE IF EXISTS address_transactions CASCADE;
DROP TABLE IF EXISTS transaction_participants CASCADE;
DROP TABLE IF EXISTS supply_stats CASCADE;
DROP TABLE IF EXISTS utxos CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS blocks CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;

-- ============================================================================
-- HYPERTABLES (Time-series optimized tables)
-- ============================================================================

-- Blocks table (hypertable partitioned by height)
CREATE TABLE blocks (
  height INTEGER NOT NULL,
  hash TEXT UNIQUE NOT NULL,
  prev_hash TEXT,
  merkle_root TEXT,
  timestamp INTEGER NOT NULL,
  bits TEXT,
  nonce TEXT,
  version INTEGER,
  size INTEGER,
  tx_count INTEGER DEFAULT 0,
  producer TEXT,
  producer_reward BIGINT,
  difficulty DECIMAL(20, 8),
  chainwork TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (height)
);

-- Convert blocks to hypertable (100k blocks per chunk)
SELECT create_hypertable('blocks', by_range('height', 100000));

CREATE INDEX idx_blocks_hash ON blocks(hash);
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp DESC);
CREATE INDEX idx_blocks_producer ON blocks(producer) WHERE producer IS NOT NULL;

-- Transactions table (hypertable partitioned by block_height)
CREATE TABLE transactions (
  txid TEXT NOT NULL,
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
  is_fluxnode_tx BOOLEAN DEFAULT false,
  fluxnode_type INTEGER,
  hex TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (block_height, txid)
);

-- Convert transactions to hypertable (100k blocks per chunk)
SELECT create_hypertable('transactions', by_range('block_height', 100000));

CREATE UNIQUE INDEX idx_tx_txid ON transactions(txid);
CREATE INDEX idx_tx_block_hash ON transactions(block_hash);
CREATE INDEX idx_tx_timestamp ON transactions(timestamp DESC);
CREATE INDEX idx_tx_coinbase ON transactions(is_coinbase) WHERE is_coinbase = true;
CREATE INDEX idx_tx_fluxnode ON transactions(is_fluxnode_tx) WHERE is_fluxnode_tx = true;

-- Address transactions cache (hypertable partitioned by block_height)
CREATE TABLE address_transactions (
  address TEXT NOT NULL,
  txid TEXT NOT NULL,
  block_height INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  block_hash TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent')),
  received_value BIGINT NOT NULL DEFAULT 0,
  sent_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (block_height, address, txid)
);

-- Convert address_transactions to hypertable (100k blocks per chunk)
SELECT create_hypertable('address_transactions', by_range('block_height', 100000));

CREATE INDEX idx_address_tx_address ON address_transactions(address, block_height DESC, txid DESC);
CREATE INDEX idx_address_tx_lookup ON address_transactions(txid);

-- FluxNode transactions (hypertable partitioned by block_height)
-- Stores FluxNode registration, confirmation, and update transactions
CREATE TABLE fluxnode_transactions (
  txid TEXT NOT NULL,
  block_height INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL,
  type INTEGER NOT NULL,
  collateral_hash TEXT,
  collateral_index INTEGER,
  ip_address TEXT,
  public_key TEXT,
  signature TEXT,
  p2sh_address TEXT,
  benchmark_tier TEXT,
  extra_data JSONB,
  raw_hex TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (block_height, txid)
);

-- Convert fluxnode_transactions to hypertable (100k blocks per chunk)
SELECT create_hypertable('fluxnode_transactions', by_range('block_height', 100000));

CREATE UNIQUE INDEX idx_fluxnode_tx_txid ON fluxnode_transactions(txid);
CREATE INDEX idx_fluxnode_tx_type ON fluxnode_transactions(type);
CREATE INDEX idx_fluxnode_tx_collateral ON fluxnode_transactions(collateral_hash, collateral_index) WHERE collateral_hash IS NOT NULL;
CREATE INDEX idx_fluxnode_tx_pubkey ON fluxnode_transactions(public_key) WHERE public_key IS NOT NULL;
CREATE INDEX idx_fluxnode_tx_ip ON fluxnode_transactions(ip_address) WHERE ip_address IS NOT NULL;
CREATE INDEX idx_fluxnode_tx_p2sh ON fluxnode_transactions(p2sh_address) WHERE p2sh_address IS NOT NULL;

-- Supply statistics (hypertable partitioned by block_height)
CREATE TABLE supply_stats (
  block_height INTEGER NOT NULL,
  transparent_supply BIGINT NOT NULL DEFAULT 0,
  shielded_pool BIGINT NOT NULL DEFAULT 0,
  total_supply BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (block_height)
);

-- Convert supply_stats to hypertable (100k blocks per chunk)
SELECT create_hypertable('supply_stats', by_range('block_height', 100000));

-- Transaction participants cache (stores deduplicated input/output addresses per transaction)
-- Regular table - keyed by txid, not time-series
CREATE TABLE transaction_participants (
  txid TEXT PRIMARY KEY,
  input_addresses TEXT[] NOT NULL DEFAULT '{}',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_addresses TEXT[] NOT NULL DEFAULT '{}',
  output_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tx_participants_txid ON transaction_participants(txid);

-- ============================================================================
-- REGULAR TABLES (Not time-series, need current state queries)
-- ============================================================================

-- UTXOs (Unspent Transaction Outputs) - Regular table for current state queries
CREATE TABLE utxos (
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  address TEXT NOT NULL,
  value BIGINT NOT NULL,
  script_pubkey TEXT,
  script_type TEXT,
  block_height INTEGER NOT NULL,
  spent BOOLEAN DEFAULT false,
  spent_txid TEXT,
  spent_block_height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  spent_at TIMESTAMPTZ,
  PRIMARY KEY (txid, vout)
);

CREATE INDEX idx_utxo_address_unspent ON utxos(address) WHERE spent = false;
CREATE INDEX idx_utxo_address_spent ON utxos(address, spent);
CREATE INDEX idx_utxo_spent ON utxos(spent, block_height);
CREATE INDEX idx_utxo_block_height ON utxos(block_height);
CREATE INDEX idx_utxo_spent_txid ON utxos(spent_txid) WHERE spent_txid IS NOT NULL;
CREATE INDEX idx_utxo_txid ON utxos(txid);

-- Address summary (for quick balance lookups) - Regular table, keyed by address
CREATE TABLE address_summary (
  address TEXT PRIMARY KEY,
  balance BIGINT NOT NULL DEFAULT 0,
  tx_count INTEGER NOT NULL DEFAULT 0,
  received_total BIGINT NOT NULL DEFAULT 0,
  sent_total BIGINT NOT NULL DEFAULT 0,
  unspent_count INTEGER NOT NULL DEFAULT 0,
  unconfirmed_balance BIGINT NOT NULL DEFAULT 0,
  first_seen INTEGER,
  last_activity INTEGER,
  cumulus_count INTEGER NOT NULL DEFAULT 0,
  nimbus_count INTEGER NOT NULL DEFAULT 0,
  stratus_count INTEGER NOT NULL DEFAULT 0,
  fluxnode_last_sync TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_address_balance ON address_summary(balance DESC);
CREATE INDEX idx_address_activity ON address_summary(last_activity DESC);
CREATE INDEX idx_address_tx_count ON address_summary(tx_count DESC);
CREATE INDEX idx_address_fluxnodes ON address_summary((cumulus_count + nimbus_count + stratus_count) DESC)
  WHERE (cumulus_count + nimbus_count + stratus_count) > 0;

-- FluxNode producers (PoN specific) - Regular table
CREATE TABLE producers (
  fluxnode TEXT PRIMARY KEY,
  blocks_produced INTEGER DEFAULT 0,
  first_block INTEGER,
  last_block INTEGER,
  total_rewards BIGINT DEFAULT 0,
  avg_block_time DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_producer_blocks ON producers(blocks_produced DESC);
CREATE INDEX idx_producer_last_block ON producers(last_block DESC);

-- Sync state (single row table tracking indexer progress)
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_height INTEGER NOT NULL DEFAULT 0,
  chain_height INTEGER NOT NULL DEFAULT 0,
  sync_percentage DECIMAL(5,2) DEFAULT 0,
  last_block_hash TEXT,
  last_sync_time TIMESTAMPTZ,
  is_syncing BOOLEAN DEFAULT false,
  sync_start_time TIMESTAMPTZ,
  blocks_per_second DECIMAL(10, 2),
  estimated_completion TIMESTAMPTZ
);

-- Initialize sync state (start from -1 so first sync fetches block 0)
INSERT INTO sync_state (id, current_height, chain_height) VALUES (1, -1, 0)
ON CONFLICT (id) DO NOTHING;

-- Reorg history (track chain reorganizations) - Regular table
CREATE TABLE reorgs (
  id SERIAL PRIMARY KEY,
  from_height INTEGER NOT NULL,
  to_height INTEGER NOT NULL,
  common_ancestor INTEGER NOT NULL,
  old_hash TEXT,
  new_hash TEXT,
  blocks_affected INTEGER,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reorg_occurred_at ON reorgs(occurred_at DESC);

-- Schema migrations tracking
CREATE TABLE schema_migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- COMPRESSION POLICIES (Auto-compress old data)
-- ============================================================================

-- Enable compression on hypertables
ALTER TABLE blocks SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'height DESC'
);

ALTER TABLE transactions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'block_hash',
  timescaledb.compress_orderby = 'block_height DESC, txid'
);

ALTER TABLE address_transactions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'address',
  timescaledb.compress_orderby = 'block_height DESC, txid'
);

ALTER TABLE fluxnode_transactions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'type, benchmark_tier',
  timescaledb.compress_orderby = 'block_height DESC, txid'
);

ALTER TABLE supply_stats SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'block_height DESC'
);

-- Add compression policies (compress chunks older than 100k blocks from current tip)
-- These will be adjusted after initial sync completes
SELECT add_compression_policy('blocks', compress_after => 100000::integer);
SELECT add_compression_policy('transactions', compress_after => 100000::integer);
SELECT add_compression_policy('address_transactions', compress_after => 100000::integer);
SELECT add_compression_policy('fluxnode_transactions', compress_after => 100000::integer);
SELECT add_compression_policy('supply_stats', compress_after => 100000::integer);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Helper function to calculate address balance from UTXOs
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
  actual_tx_count BIGINT;
BEGIN
  -- Calculate UTXO-based statistics
  SELECT
    COALESCE(SUM(CASE WHEN spent = false THEN value ELSE 0 END), 0) as balance,
    COALESCE(SUM(value), 0) as received,
    COALESCE(SUM(CASE WHEN spent = true THEN value ELSE 0 END), 0) as sent,
    COUNT(CASE WHEN spent = false THEN 1 END) as unspent_count,
    MIN(block_height) as first_seen,
    MAX(GREATEST(block_height, COALESCE(spent_block_height, 0))) as last_activity
  INTO summary_data
  FROM utxos
  WHERE address = addr;

  -- Get actual transaction count from address_transactions
  SELECT COUNT(*)
  INTO actual_tx_count
  FROM address_transactions
  WHERE address = addr;

  -- Upsert address summary
  INSERT INTO address_summary (
    address, balance, tx_count, received_total, sent_total,
    unspent_count, first_seen, last_activity, updated_at
  ) VALUES (
    addr,
    summary_data.balance,
    actual_tx_count,
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

-- ============================================================================
-- TRIGGERS (Maintain caches automatically)
-- ============================================================================

-- Trigger function to maintain address_transactions on UTXO changes
CREATE OR REPLACE FUNCTION update_address_transactions()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle received transactions (INSERT)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO address_transactions (address, txid, block_height, timestamp, block_hash, direction, received_value, sent_value)
    SELECT
      NEW.address,
      NEW.txid,
      NEW.block_height,
      COALESCE(t.timestamp, 0),
      t.block_hash,
      'received',
      NEW.value,
      0
    FROM transactions t
    WHERE t.txid = NEW.txid
    ON CONFLICT (block_height, address, txid) DO UPDATE SET
      received_value = address_transactions.received_value + EXCLUDED.received_value,
      direction = CASE
        WHEN address_transactions.received_value + EXCLUDED.received_value >= address_transactions.sent_value THEN 'received'
        ELSE 'sent'
      END;

    -- Handle if UTXO is already spent on insert
    IF NEW.spent AND NEW.spent_txid IS NOT NULL THEN
      INSERT INTO address_transactions (address, txid, block_height, timestamp, block_hash, direction, received_value, sent_value)
      SELECT
        NEW.address,
        NEW.spent_txid,
        NEW.spent_block_height,
        COALESCE(t.timestamp, 0),
        t.block_hash,
        'sent',
        0,
        NEW.value
      FROM transactions t
      WHERE t.txid = NEW.spent_txid
      ON CONFLICT (block_height, address, txid) DO UPDATE SET
        sent_value = address_transactions.sent_value + EXCLUDED.sent_value,
        direction = CASE
          WHEN address_transactions.received_value >= address_transactions.sent_value + EXCLUDED.sent_value THEN 'received'
          ELSE 'sent'
        END;
    END IF;
  END IF;

  -- Handle UTXO spending (UPDATE)
  IF TG_OP = 'UPDATE' AND NEW.spent AND NOT OLD.spent AND NEW.spent_txid IS NOT NULL THEN
    INSERT INTO address_transactions (address, txid, block_height, timestamp, block_hash, direction, received_value, sent_value)
    SELECT
      NEW.address,
      NEW.spent_txid,
      NEW.spent_block_height,
      COALESCE(t.timestamp, 0),
      t.block_hash,
      'sent',
      0,
      NEW.value
    FROM transactions t
    WHERE t.txid = NEW.spent_txid
    ON CONFLICT (block_height, address, txid) DO UPDATE SET
      sent_value = address_transactions.sent_value + EXCLUDED.sent_value,
      direction = CASE
        WHEN address_transactions.received_value >= address_transactions.sent_value + EXCLUDED.sent_value THEN 'received'
        ELSE 'sent'
      END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to utxos table
CREATE TRIGGER utxo_update_address_transactions
  AFTER INSERT OR UPDATE ON utxos
  FOR EACH ROW
  EXECUTE FUNCTION update_address_transactions();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE blocks IS 'Indexed blockchain blocks (TimescaleDB hypertable)';
COMMENT ON TABLE transactions IS 'All blockchain transactions (TimescaleDB hypertable)';
COMMENT ON TABLE address_transactions IS 'Address transaction history cache (TimescaleDB hypertable)';
COMMENT ON TABLE fluxnode_transactions IS 'FluxNode-related transactions (TimescaleDB hypertable)';
COMMENT ON TABLE supply_stats IS 'Per-block supply statistics (TimescaleDB hypertable)';
COMMENT ON TABLE utxos IS 'Unspent and spent transaction outputs (regular table for current state)';
COMMENT ON TABLE address_summary IS 'Cached address balances and statistics';
COMMENT ON TABLE producers IS 'FluxNode block producers (PoN consensus)';
COMMENT ON TABLE sync_state IS 'Indexer synchronization state';
