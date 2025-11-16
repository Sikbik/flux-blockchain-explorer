-- Migration 007: Address Transactions Cache
-- Creates a materialized table for fast address transaction lookups
-- This eliminates the need for expensive UNION queries on the utxos table

-- Create address_transactions table to cache transaction summaries per address
CREATE TABLE IF NOT EXISTS address_transactions (
  address TEXT NOT NULL,
  txid TEXT NOT NULL,
  block_height INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  block_hash TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('received', 'sent')),
  received_value BIGINT NOT NULL DEFAULT 0,
  sent_value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (address, txid)
);

-- Indexes for fast pagination and lookups
CREATE INDEX idx_address_tx_pagination ON address_transactions (address, block_height DESC, txid DESC);
CREATE INDEX idx_address_tx_lookup ON address_transactions (txid);

-- Populate from existing UTXOs
-- This will take a while on initial run but only needs to happen once
INSERT INTO address_transactions (address, txid, block_height, timestamp, block_hash, direction, received_value, sent_value)
SELECT
  agg.address,
  agg.txid,
  agg.block_height,
  COALESCE(t.timestamp, 0) as timestamp,
  t.block_hash,
  CASE
    WHEN agg.received_value >= COALESCE(agg.sent_value, 0) THEN 'received'
    ELSE 'sent'
  END as direction,
  COALESCE(agg.received_value, 0) as received_value,
  COALESCE(agg.sent_value, 0) as sent_value
FROM (
  SELECT
    address,
    txid,
    block_height,
    SUM(CASE WHEN NOT spent OR spent_txid IS NULL THEN value ELSE 0 END) as received_value,
    SUM(CASE WHEN spent_txid = txid THEN value ELSE 0 END) as sent_value
  FROM (
    -- Received transactions
    SELECT
      address,
      txid,
      block_height,
      value,
      spent,
      spent_txid
    FROM utxos
    WHERE txid IS NOT NULL

    UNION ALL

    -- Sent transactions
    SELECT
      address,
      spent_txid as txid,
      spent_block_height as block_height,
      value,
      spent,
      spent_txid
    FROM utxos
    WHERE spent_txid IS NOT NULL
  ) combined
  GROUP BY address, txid, block_height
  HAVING SUM(CASE WHEN NOT spent OR spent_txid IS NULL THEN value ELSE 0 END) > 0
      OR SUM(CASE WHEN spent_txid = txid THEN value ELSE 0 END) > 0
) agg
LEFT JOIN transactions t ON t.txid = agg.txid
ON CONFLICT (address, txid) DO UPDATE SET
  block_height = EXCLUDED.block_height,
  timestamp = EXCLUDED.timestamp,
  block_hash = EXCLUDED.block_hash,
  direction = EXCLUDED.direction,
  received_value = EXCLUDED.received_value,
  sent_value = EXCLUDED.sent_value;

-- Create trigger function to maintain address_transactions on UTXO changes
CREATE OR REPLACE FUNCTION update_address_transactions()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle received transactions
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
    ON CONFLICT (address, txid) DO UPDATE SET
      received_value = address_transactions.received_value + EXCLUDED.received_value,
      direction = CASE
        WHEN address_transactions.received_value + EXCLUDED.received_value >= address_transactions.sent_value THEN 'received'
        ELSE 'sent'
      END;

    -- Handle spent transactions if this UTXO is already spent
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
      ON CONFLICT (address, txid) DO UPDATE SET
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
    ON CONFLICT (address, txid) DO UPDATE SET
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
DROP TRIGGER IF EXISTS utxo_update_address_transactions ON utxos;
CREATE TRIGGER utxo_update_address_transactions
  AFTER INSERT OR UPDATE ON utxos
  FOR EACH ROW
  EXECUTE FUNCTION update_address_transactions();

-- Analyze tables for query optimization
ANALYZE address_transactions;
