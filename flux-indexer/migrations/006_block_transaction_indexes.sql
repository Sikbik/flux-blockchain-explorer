-- Performance indexes for block transaction queries

CREATE INDEX IF NOT EXISTS idx_transactions_block_height_coinbase_txid
  ON transactions (block_height, is_coinbase, txid);
