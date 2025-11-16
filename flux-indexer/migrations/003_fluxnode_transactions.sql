-- FluxNode Transactions Table
-- Stores FluxNode registration, confirmation, and update transactions
-- These are special transactions (version 3, 5, 6) that don't follow standard UTXO model

CREATE TABLE IF NOT EXISTS fluxnode_transactions (
  -- Primary identification
  txid TEXT PRIMARY KEY,
  block_height INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_time TIMESTAMP NOT NULL,

  -- Transaction metadata
  version INTEGER NOT NULL, -- 3, 5, or 6
  type INTEGER NOT NULL, -- nType field (1=start, 4=confirm, etc.)

  -- Collateral UTXO (for start transactions)
  collateral_hash TEXT, -- The UTXO hash being used as collateral
  collateral_index INTEGER, -- The UTXO output index

  -- FluxNode identity
  ip_address TEXT, -- FluxNode IP address

  -- Cryptographic proof
  public_key TEXT, -- FluxNode public key (33 bytes, hex encoded)
  signature TEXT, -- Transaction signature (varies by type)

  -- P2SH multisig info (for start transactions)
  p2sh_address TEXT, -- The P2SH address created for this FluxNode
  benchmark_tier TEXT, -- CUMULUS, NIMBUS, or STRATUS

  -- Additional data
  extra_data JSONB, -- Any additional parsed data (future-proof)
  raw_hex TEXT NOT NULL, -- Original transaction hex (for re-parsing if needed)

  -- Indexing
  created_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (block_height) REFERENCES blocks(height) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_block_height
  ON fluxnode_transactions(block_height DESC);

CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_type
  ON fluxnode_transactions(type);

CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_collateral
  ON fluxnode_transactions(collateral_hash, collateral_index)
  WHERE collateral_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_pubkey
  ON fluxnode_transactions(public_key)
  WHERE public_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_ip
  ON fluxnode_transactions(ip_address)
  WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fluxnode_txs_p2sh
  ON fluxnode_transactions(p2sh_address)
  WHERE p2sh_address IS NOT NULL;

-- Add FluxNode transaction references to main transactions table
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_fluxnode_tx BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fluxnode_type INTEGER;

CREATE INDEX IF NOT EXISTS idx_transactions_fluxnode
  ON transactions(is_fluxnode_tx)
  WHERE is_fluxnode_tx = TRUE;

COMMENT ON TABLE fluxnode_transactions IS 'Special FluxNode registration, confirmation, and update transactions';
COMMENT ON COLUMN fluxnode_transactions.type IS '1=start, 4=confirm (version determines exact type)';
COMMENT ON COLUMN fluxnode_transactions.benchmark_tier IS 'CUMULUS (2TB/4core), NIMBUS (4TB/8core), STRATUS (8TB/16core)';
COMMENT ON COLUMN fluxnode_transactions.raw_hex IS 'Original hex for re-parsing if parser is updated';
