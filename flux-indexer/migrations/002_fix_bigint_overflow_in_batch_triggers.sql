-- Fix BigInt Overflow in Batch Address Summary Triggers
-- Adds LEAST() clamping to prevent overflow when accumulated values exceed bigint max

-- Drop and recreate the batch increment trigger with overflow protection
CREATE OR REPLACE FUNCTION batch_increment_address_summary()
RETURNS TRIGGER AS $$
DECLARE
  max_bigint CONSTANT BIGINT := 9223372036854775807;
BEGIN
  -- Aggregate all new UTXOs by address and update summaries in one operation
  INSERT INTO address_summary (
    address, balance, tx_count, received_total, sent_total,
    unspent_count, first_seen, last_activity, updated_at
  )
  SELECT
    NEW_UTXOS.address,
    SUM(NEW_UTXOS.value) as balance,
    COUNT(DISTINCT NEW_UTXOS.txid) as tx_count,
    SUM(NEW_UTXOS.value) as received_total,
    0 as sent_total,
    COUNT(*) as unspent_count,
    MIN(NEW_UTXOS.block_height) as first_seen,
    MAX(NEW_UTXOS.block_height) as last_activity,
    NOW() as updated_at
  FROM (
    SELECT address, value, txid, block_height
    FROM NEW_TABLE
    WHERE address != 'SHIELDED_OR_NONSTANDARD'
  ) NEW_UTXOS
  GROUP BY NEW_UTXOS.address
  ON CONFLICT (address) DO UPDATE SET
    -- Clamp balance to prevent overflow
    balance = LEAST(
      address_summary.balance + EXCLUDED.balance,
      max_bigint
    ),
    tx_count = address_summary.tx_count + EXCLUDED.tx_count,
    -- Clamp received_total to prevent overflow
    received_total = LEAST(
      address_summary.received_total + EXCLUDED.received_total,
      max_bigint
    ),
    unspent_count = address_summary.unspent_count + EXCLUDED.unspent_count,
    last_activity = GREATEST(address_summary.last_activity, EXCLUDED.last_activity),
    updated_at = NOW();

  RETURN NULL; -- Statement-level triggers ignore return value
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate the batch decrement trigger with overflow protection
CREATE OR REPLACE FUNCTION batch_decrement_address_summary()
RETURNS TRIGGER AS $$
DECLARE
  max_bigint CONSTANT BIGINT := 9223372036854775807;
BEGIN
  -- Only process UTXOs that transitioned from unspent to spent
  WITH spent_utxos AS (
    SELECT
      old_utxos.address,
      old_utxos.value,
      new_utxos.spent_block_height
    FROM OLD_TABLE AS old_utxos
    INNER JOIN NEW_TABLE AS new_utxos
      ON old_utxos.txid = new_utxos.txid AND old_utxos.vout = new_utxos.vout
    WHERE new_utxos.spent = true
      AND old_utxos.spent = false
      AND old_utxos.address != 'SHIELDED_OR_NONSTANDARD'
  )
  UPDATE address_summary
  SET
    -- Clamp balance to prevent underflow (use GREATEST to ensure >= 0)
    balance = GREATEST(
      address_summary.balance - agg.total_value,
      0
    ),
    -- Clamp sent_total to prevent overflow
    sent_total = LEAST(
      address_summary.sent_total + agg.total_value,
      max_bigint
    ),
    -- Clamp unspent_count to prevent underflow
    unspent_count = GREATEST(
      address_summary.unspent_count - agg.utxo_count,
      0
    ),
    last_activity = GREATEST(address_summary.last_activity, agg.max_spent_height),
    updated_at = NOW()
  FROM (
    SELECT
      address,
      SUM(value) as total_value,
      COUNT(*) as utxo_count,
      MAX(spent_block_height) as max_spent_height
    FROM spent_utxos
    GROUP BY address
  ) agg
  WHERE address_summary.address = agg.address;

  RETURN NULL; -- Statement-level triggers ignore return value
END;
$$ LANGUAGE plpgsql;

-- Update comments
COMMENT ON FUNCTION batch_increment_address_summary() IS 'Statement-level trigger: batches all UTXO inserts per transaction with overflow protection';
COMMENT ON FUNCTION batch_decrement_address_summary() IS 'Statement-level trigger: batches all UTXO spends per transaction with overflow protection';
