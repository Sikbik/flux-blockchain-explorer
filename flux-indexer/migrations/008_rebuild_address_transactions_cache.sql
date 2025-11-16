-- Migration 008: rebuild address_transactions cache with correct net values
BEGIN;

-- Remove the previous row-level trigger that incremented values per UTXO
DROP TRIGGER IF EXISTS utxo_update_address_transactions ON utxos;
DROP FUNCTION IF EXISTS update_address_transactions();

-- Clear existing cached rows (they will be rebuilt below)
TRUNCATE address_transactions;

WITH outputs AS (
  SELECT
    txid,
    address,
    SUM(value)::bigint AS received_value
  FROM utxos
  WHERE address IS NOT NULL
    AND address <> 'SHIELDED_OR_NONSTANDARD'
  GROUP BY txid, address
),
inputs AS (
  SELECT
    spent_txid AS txid,
    address,
    SUM(value)::bigint AS sent_value
  FROM utxos
  WHERE spent_txid IS NOT NULL
    AND address IS NOT NULL
    AND address <> 'SHIELDED_OR_NONSTANDARD'
  GROUP BY spent_txid, address
),
combined AS (
  SELECT
    COALESCE(o.txid, i.txid) AS txid,
    COALESCE(o.address, i.address) AS address,
    COALESCE(o.received_value, 0)::bigint AS received_value,
    COALESCE(i.sent_value, 0)::bigint AS sent_value
  FROM outputs o
  FULL OUTER JOIN inputs i
    ON o.txid = i.txid AND o.address = i.address
),
filtered AS (
  SELECT *
  FROM combined
  WHERE received_value > 0 OR sent_value > 0
)
INSERT INTO address_transactions (
  address,
  txid,
  block_height,
  timestamp,
  block_hash,
  direction,
  received_value,
  sent_value
)
SELECT
  f.address,
  f.txid,
  t.block_height,
  t.timestamp,
  t.block_hash,
  CASE WHEN f.received_value >= f.sent_value THEN 'received' ELSE 'sent' END,
  f.received_value,
  f.sent_value
FROM filtered f
JOIN transactions t ON t.txid = f.txid
ON CONFLICT (address, txid) DO UPDATE SET
  block_height   = EXCLUDED.block_height,
  timestamp      = EXCLUDED.timestamp,
  block_hash     = EXCLUDED.block_hash,
  direction      = EXCLUDED.direction,
  received_value = EXCLUDED.received_value,
  sent_value     = EXCLUDED.sent_value;

ANALYZE address_transactions;

COMMIT;
