-- Incremental Address Summary Updates via Triggers
-- This makes address balance updates 100x faster by using deltas instead of full recalculation

-- Drop existing function that does full recalculation
DROP FUNCTION IF EXISTS update_address_summary(TEXT);

-- Create function to handle UTXO creation (increment balances)
CREATE OR REPLACE FUNCTION increment_address_summary()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update address summary with incremental changes
  INSERT INTO address_summary (
    address, balance, tx_count, received_total, sent_total,
    unspent_count, first_seen, last_activity, updated_at
  ) VALUES (
    NEW.address,
    NEW.value,  -- Initial balance
    1,          -- One transaction
    NEW.value,  -- Received total
    0,          -- Nothing sent yet
    1,          -- One unspent UTXO
    NEW.block_height,  -- First seen
    NEW.block_height,  -- Last activity
    NOW()
  )
  ON CONFLICT (address) DO UPDATE SET
    balance = address_summary.balance + NEW.value,
    tx_count = address_summary.tx_count + 1,
    received_total = address_summary.received_total + NEW.value,
    unspent_count = address_summary.unspent_count + 1,
    last_activity = GREATEST(address_summary.last_activity, NEW.block_height),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to handle UTXO spending (decrement balances)
CREATE OR REPLACE FUNCTION decrement_address_summary()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if UTXO is being marked as spent
  IF NEW.spent = true AND OLD.spent = false THEN
    UPDATE address_summary SET
      balance = balance - OLD.value,
      sent_total = sent_total + OLD.value,
      unspent_count = unspent_count - 1,
      last_activity = GREATEST(last_activity, NEW.spent_block_height),
      updated_at = NOW()
    WHERE address = OLD.address;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS utxo_insert_update_summary ON utxos;
DROP TRIGGER IF EXISTS utxo_update_update_summary ON utxos;

-- Create trigger for UTXO insertions (new UTXOs created)
CREATE TRIGGER utxo_insert_update_summary
  AFTER INSERT ON utxos
  FOR EACH ROW
  WHEN (NEW.address != 'SHIELDED_OR_NONSTANDARD')
  EXECUTE FUNCTION increment_address_summary();

-- Create trigger for UTXO updates (UTXOs being spent)
CREATE TRIGGER utxo_update_update_summary
  AFTER UPDATE OF spent ON utxos
  FOR EACH ROW
  WHEN (OLD.address != 'SHIELDED_OR_NONSTANDARD')
  EXECUTE FUNCTION decrement_address_summary();

-- Add index to speed up address summary lookups
CREATE INDEX IF NOT EXISTS idx_address_summary_updated
  ON address_summary(updated_at DESC);

COMMENT ON FUNCTION increment_address_summary() IS 'Incrementally updates address summary when UTXO is created';
COMMENT ON FUNCTION decrement_address_summary() IS 'Incrementally updates address summary when UTXO is spent';
