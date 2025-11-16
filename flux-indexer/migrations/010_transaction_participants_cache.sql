-- Migration 010: Transaction participants cache
-- Stores deduplicated input/output addresses per transaction so the
-- address history endpoint no longer has to aggregate UTXOs at read time.

CREATE TABLE IF NOT EXISTS transaction_participants (
  txid TEXT PRIMARY KEY,
  input_addresses TEXT[] NOT NULL DEFAULT '{}',
  input_count INTEGER NOT NULL DEFAULT 0,
  output_addresses TEXT[] NOT NULL DEFAULT '{}',
  output_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transaction_participants_txid
  ON transaction_participants (txid);

-- Backfill from existing UTXO data. This can take several minutes on a full
-- mainnet dataset but only runs once during deployment.
WITH output_agg AS (
  SELECT
    txid,
    ARRAY_AGG(DISTINCT address) FILTER (
      WHERE address IS NOT NULL AND address <> 'SHIELDED_OR_NONSTANDARD'
    ) AS output_addresses
  FROM utxos
  GROUP BY txid
),
input_agg AS (
  SELECT
    spent_txid AS txid,
    ARRAY_AGG(DISTINCT address) FILTER (
      WHERE address IS NOT NULL AND address <> 'SHIELDED_OR_NONSTANDARD'
    ) AS input_addresses
  FROM utxos
  WHERE spent_txid IS NOT NULL
  GROUP BY spent_txid
)
INSERT INTO transaction_participants (txid, input_addresses, input_count, output_addresses, output_count)
SELECT
  COALESCE(o.txid, i.txid) AS txid,
  COALESCE(i.input_addresses, ARRAY[]::TEXT[]) AS input_addresses,
  COALESCE(array_length(i.input_addresses, 1), 0) AS input_count,
  COALESCE(o.output_addresses, ARRAY[]::TEXT[]) AS output_addresses,
  COALESCE(array_length(o.output_addresses, 1), 0) AS output_count
FROM output_agg o
FULL OUTER JOIN input_agg i ON o.txid = i.txid
ON CONFLICT (txid) DO UPDATE SET
  input_addresses = EXCLUDED.input_addresses,
  input_count = EXCLUDED.input_count,
  output_addresses = EXCLUDED.output_addresses,
  output_count = EXCLUDED.output_count;

ANALYZE transaction_participants;
