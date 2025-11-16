-- Migration 009: index for utxos(txid) to speed up address history lookups

CREATE INDEX IF NOT EXISTS idx_utxos_txid
  ON utxos (txid);
