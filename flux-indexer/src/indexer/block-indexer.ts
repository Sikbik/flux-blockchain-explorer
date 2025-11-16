/**
 * Block Indexer
 *
 * Indexes blocks, transactions, and UTXOs from Flux blockchain
 */

import { PoolClient } from 'pg';
import { FluxRPCClient } from '../rpc/flux-rpc-client';
import { DatabaseConnection } from '../database/connection';
import { Block, Transaction, SyncError } from '../types';
import { logger } from '../utils/logger';
import { determineFluxNodeTier } from '../parsers/fluxnode-parser';
import { extractFluxNodeTransaction, extractCoinbaseTransaction, extractTransactionFromBlock } from '../parsers/block-parser';

export class BlockIndexer {
  constructor(
    private rpc: FluxRPCClient,
    private db: DatabaseConnection
  ) {}

  private skipAddressSummary = false;
  private readonly RAW_TX_CACHE_LIMIT = 5000;
  private rawTransactionCache = new Map<string, Transaction>();
  private rawTransactionCacheQueue: string[] = [];

  // PostgreSQL bigint maximum value
  private readonly MAX_BIGINT = BigInt('9223372036854775807');

  /**
   * Safely convert BigInt to string with overflow protection
   * Clamps values that exceed PostgreSQL bigint limits
   */
  private safeBigIntToString(value: bigint, context?: string): string {
    if (value > this.MAX_BIGINT) {
      logger.error('BigInt value exceeds PostgreSQL max, clamping to max', {
        value: value.toString(),
        maxValue: this.MAX_BIGINT.toString(),
        context: context || 'unknown',
      });
      return this.MAX_BIGINT.toString();
    }
    if (value < BigInt(0)) {
      logger.warn('Negative BigInt value detected, clamping to 0', {
        value: value.toString(),
        context: context || 'unknown',
      });
      return '0';
    }
    return value.toString();
  }

  setSkipAddressSummary(skip: boolean): void {
    if (this.skipAddressSummary !== skip) {
      logger.debug(`Address summary updates ${skip ? 'disabled' : 'enabled'} for fast sync mode`);
    }
    this.skipAddressSummary = skip;
  }

  /**
   * Index a single block
   */
  async indexBlock(height: number): Promise<void> {
    try {
      const block = await this.rpc.getBlock(height, 2);
      await this.processBlock(block, height);
      logger.debug(`Indexed block ${height} (${block.hash})`);
    } catch (error: any) {
      logger.error(`Failed to index block ${height}`, { error: error.message });
      throw new SyncError(`Block indexing failed at height ${height}`, { error: error.message });
    }
  }

  async indexBlockData(block: Block, expectedHeight?: number): Promise<void> {
    try {
      await this.processBlock(block, expectedHeight);
      const height = block.height ?? expectedHeight;
      logger.debug(`Indexed block ${height} (${block.hash})`);
    } catch (error: any) {
      const height = block.height ?? expectedHeight ?? 'unknown';
      logger.error(`Failed to index block ${height}`, { error: error.message });
      throw new SyncError(`Block indexing failed at height ${height}`, { error: error.message });
    }
  }

  private async processBlock(block: Block, expectedHeight?: number): Promise<void> {
    const blockHeight = block.height ?? expectedHeight;
    if (blockHeight === undefined) {
      throw new SyncError('Block height is undefined', { blockHash: block.hash });
    }

    block.height = blockHeight;

    const transactions = await this.normalizeBlockTransactions(block);

    await this.db.transaction(async (client) => {
      await this.insertBlock(client, block);

      if (transactions.length > 0) {
        await this.indexTransactionsBatch(client, block, transactions);
      }

      // Track shielded pool and supply statistics
      await this.updateSupplyStats(client, blockHeight, transactions);

      if (block.producer) {
        await this.updateProducerStats(client, block);
      }

      await this.updateSyncState(client, blockHeight, block.hash);
    });
  }

  private async normalizeBlockTransactions(block: Block): Promise<Transaction[]> {
    if (!Array.isArray(block.tx) || block.tx.length === 0) {
      return [];
    }

    const normalized: (Transaction | null)[] = new Array(block.tx.length).fill(null);
    const missing: Array<{ txid: string; index: number }> = [];

    block.tx.forEach((tx, index) => {
      if (typeof tx === 'string') {
        const cached = this.rawTransactionCache.get(tx);
        if (cached) {
          normalized[index] = cached;
        } else {
          missing.push({ txid: tx, index });
        }
      } else {
        this.cacheRawTransaction(tx);
        normalized[index] = tx;
      }
    });

    if (missing.length > 0) {
      const uniqueTxids = Array.from(new Set(missing.map(item => item.txid)));
      const fetched = await this.rpc.batchGetRawTransactions(uniqueTxids, true, block.hash);

      uniqueTxids.forEach((txid, idx) => {
        const fetchedTx = fetched[idx];
        if (typeof fetchedTx === 'string') {
          logger.warn('Received raw transaction hex when expecting verbose JSON', { txid });
          return;
        }
        this.cacheRawTransaction(fetchedTx);
      });

      for (const { txid, index } of missing) {
        const raw = this.rawTransactionCache.get(txid);
        if (raw) {
          normalized[index] = raw;
        } else {
          logger.warn('Unable to resolve transaction data during normalization', { txid, block: block.hash });
        }
      }
    }

    return normalized.map((entry, idx) => {
      if (!entry) {
        throw new SyncError('Failed to normalize transaction', { blockHash: block.hash, index: idx });
      }
      return entry;
    });
  }

  private cacheRawTransaction(tx: Transaction): void {
    if (!tx?.txid) {
      return;
    }

    if (this.rawTransactionCache.has(tx.txid)) {
      return;
    }

    this.rawTransactionCache.set(tx.txid, tx);
    this.rawTransactionCacheQueue.push(tx.txid);

    if (this.rawTransactionCacheQueue.length > this.RAW_TX_CACHE_LIMIT) {
      const oldest = this.rawTransactionCacheQueue.shift();
      if (oldest) {
        this.rawTransactionCache.delete(oldest);
      }
    }
  }

  private async populateInputValuesFromRawTransactions(
    client: PoolClient,
    missingByTx: Map<string, number[]>,
    utxoInfoMap: Map<string, { value: bigint; address: string | null }>
  ): Promise<void> {
    const txids = Array.from(missingByTx.keys());
    const uncachedTxids = txids.filter((txid) => !this.rawTransactionCache.has(txid));
    const blockHashMap = new Map<string, string>();

    if (uncachedTxids.length > 0) {
      try {
        const blockRows = await client.query(
          'SELECT txid, block_hash FROM transactions WHERE txid = ANY($1)',
          [uncachedTxids]
        );

        for (const row of blockRows.rows) {
          if (row.block_hash) {
            blockHashMap.set(row.txid, row.block_hash);
          }
        }
      } catch (error: any) {
        logger.warn('Failed to resolve block hashes for previous transactions', {
          txids: uncachedTxids,
          error: error.message,
        });
      }
    }

    if (uncachedTxids.length > 0) {
      try {
        const batchHashes = uncachedTxids.map((txid) => blockHashMap.get(txid));
        const fetched = await this.rpc.batchGetRawTransactions(uncachedTxids, true, batchHashes);
        uncachedTxids.forEach((txid, index) => {
          const result = fetched[index];
          if (typeof result === 'string') {
            logger.warn('Received raw transaction hex when expecting verbose JSON', { txid });
            return;
          }
          this.cacheRawTransaction(result);
        });
      } catch (error: any) {
        logger.warn('Failed to fetch raw transactions during input hydration', { txids: uncachedTxids, error: error.message });
      }
    }

    for (const [txid, vouts] of missingByTx.entries()) {
      let rawTx = this.rawTransactionCache.get(txid);

      if (!rawTx) {
        const blockHash = blockHashMap.get(txid);
        try {
          rawTx = await this.rpc.getRawTransaction(txid, true, blockHash) as Transaction;
          this.cacheRawTransaction(rawTx);
        } catch (error: any) {
          logger.warn('Failed to hydrate input transaction via verbose RPC', {
            txid,
            blockHash,
            error: error.message,
          });
        }
      }

      if (!rawTx) {
        logger.warn('Missing raw transaction data after batch fetch', { txid });
        continue;
      }

      for (const voutIndex of vouts) {
        const referencedOutput = rawTx?.vout?.[voutIndex];
        if (referencedOutput) {
          const value = this.toSatoshis(referencedOutput.value);
          if (value !== null) {
            const address = referencedOutput?.scriptPubKey?.addresses?.[0] || null;
            utxoInfoMap.set(`${txid}:${voutIndex}`, { value, address });
            continue;
          }
        }
        logger.warn('Referenced output missing when backfilling input value', {
          txid,
          vout: voutIndex,
        });
      }
    }
  }

  /**
   * Detect if transaction is fully shielded (no transparent inputs or outputs)
   */
  private isFullyShieldedTransaction(tx: Transaction): boolean {
    // Check for shielded components
    const hasShieldedComponents = !!(
      tx.vShieldedOutput?.length ||
      tx.vShieldedOutput2?.length ||
      tx.vShieldedSpend?.length ||
      tx.vShieldedSpend2?.length ||
      tx.vjoinsplit?.length
    );

    if (!hasShieldedComponents) {
      return false;
    }

    // Check if there are no transparent inputs (excluding coinbase)
    const hasTransparentInputs = tx.vin?.some(input =>
      input.txid && input.vout !== undefined && !input.coinbase
    );

    // Check if there are no transparent outputs
    const hasTransparentOutputs = tx.vout && tx.vout.length > 0;

    // Fully shielded = has shielded components but no transparent ins/outs
    return !hasTransparentInputs && !hasTransparentOutputs;
  }

  private toSatoshis(value: number | string | undefined): bigint | null {
    if (value === undefined || value === null) {
      return null;
    }

    let numericValue: number;

    if (typeof value === 'number') {
      numericValue = value;
    } else {
      numericValue = Number(value);
    }

    if (!Number.isFinite(numericValue)) {
      return null;
    }

    // Flux/Zcash can have -1 for shielded outputs
    // Clamp negative values to 0 to avoid bigint overflow
    const clampedValue = numericValue < 0 ? 0 : numericValue;

    return BigInt(Math.round(clampedValue * 1e8));
  }

  /**
   * Insert block into database
   */
  private async insertBlock(client: PoolClient, block: Block): Promise<void> {
    const query = `
      INSERT INTO blocks (
        height, hash, prev_hash, merkle_root, timestamp, bits, nonce,
        version, size, tx_count, producer, producer_reward, difficulty, chainwork
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (height) DO UPDATE SET
        hash = EXCLUDED.hash,
        prev_hash = EXCLUDED.prev_hash,
        merkle_root = EXCLUDED.merkle_root,
        timestamp = EXCLUDED.timestamp,
        bits = EXCLUDED.bits,
        nonce = EXCLUDED.nonce,
        version = EXCLUDED.version,
        size = EXCLUDED.size,
        tx_count = EXCLUDED.tx_count,
        producer = EXCLUDED.producer,
        producer_reward = EXCLUDED.producer_reward,
        difficulty = EXCLUDED.difficulty,
        chainwork = EXCLUDED.chainwork
    `;

    const values = [
      block.height,
      block.hash,
      block.previousblockhash || null,
      block.merkleroot,
      block.time,
      block.bits ? String(block.bits) : null,  // Ensure TEXT
      block.nonce !== null && block.nonce !== undefined ? String(block.nonce) : null,  // Store nonce as TEXT
      block.version,
      block.size,
      Array.isArray(block.tx) ? block.tx.length : 0,
      block.producer || null,
      block.producerReward ? BigInt(Math.round(block.producerReward * 1e8)) : null,
      block.difficulty,
      block.chainwork ? String(block.chainwork) : null,  // Ensure TEXT
    ];

    await client.query(query, values);
  }

  /**
   * Index all transactions in a block using batch operations (OPTIMIZED)
   */
  private async indexTransactionsBatch(
    client: PoolClient,
    block: Block,
    transactions: Transaction[]
  ): Promise<void> {
    if (transactions.length === 0) return;

    if (block.height === undefined) {
      throw new SyncError('Block height missing during transaction batch indexing', { blockHash: block.hash });
    }

    type InputRef = { txid: string; vout: number };

    const txValues: any[][] = [];
    const utxosToCreate: any[][] = [];
    const utxosToSpend: any[][] = [];
    const utxoInfoMap = new Map<string, { value: bigint; address: string | null }>();
    const txAddressTotals = new Map<string, Map<string, { received: bigint; sent: bigint }>>();
    const txParticipants = new Map<string, { inputs: Set<string>; outputs: Set<string> }>();
    const txMap = new Map<string, Transaction>();
    const txidsMissingDetails: string[] = [];

    const txPreparations: Array<{
      tx: Transaction;
      isCoinbase: boolean;
      inputs: InputRef[];
      outputTotal: bigint;
    }> = [];

    const inputRefKeys = new Set<string>();
    let fluxnodeCount = 0;
    const fluxnodeTransactions: Transaction[] = [];

    // First pass: separate FluxNode transactions from regular transactions
    for (const tx of transactions) {
      // Handle FluxNode confirmations and other special transactions
      // FluxNode confirmations have empty vin/vout arrays (version 5, nType 4)
      // FluxNode start transactions are version 6
      if (!Array.isArray(tx.vin) || !Array.isArray(tx.vout)) {
        // Check if this is a FluxNode transaction (confirmations v3/v5, starts v6)
        const isFluxNodeTransaction = tx.version === 3 || tx.version === 5 || tx.version === 6;

        if (isFluxNodeTransaction) {
          fluxnodeTransactions.push(tx);
          fluxnodeCount++;
          continue;
        }

        // Unknown transaction type - log for investigation
        logger.warn('Transaction has invalid vin/vout structure, skipping', {
          txid: tx.txid,
          hasVin: !!tx.vin,
          hasVout: !!tx.vout,
          vinType: typeof tx.vin,
          voutType: typeof tx.vout,
          version: tx.version,
          size: tx.size,
          blockHeight: block.height,
        });
        continue;
      }

      const isCoinbase = tx.vin.length > 0 && !!tx.vin[0].coinbase;
      const inputs: InputRef[] = [];
      const participantEntry = { inputs: new Set<string>(), outputs: new Set<string>() };
      txParticipants.set(tx.txid, participantEntry);

      for (const input of tx.vin) {
        if (input.coinbase) continue;
        if (input.txid && input.vout !== undefined) {
          const ref: InputRef = { txid: input.txid, vout: input.vout };
          inputs.push(ref);
          inputRefKeys.add(`${ref.txid}:${ref.vout}`);
          utxosToSpend.push([ref.txid, ref.vout, tx.txid, block.height]);
        }
      }

      let outputTotal = tx.vout.reduce((sum, output) => {
        const sat = this.toSatoshis(output.value);
        return sat !== null ? sum + sat : sum;
      }, BigInt(0));

      // Clamp outputTotal to PostgreSQL bigint max
      const MAX_BIGINT = BigInt('9223372036854775807');
      if (outputTotal > MAX_BIGINT) {
        logger.error('Prep outputTotal exceeds PostgreSQL bigint max, clamping', {
          txid: tx.txid,
          outputTotal: outputTotal.toString(),
          outputTotalFlux: (Number(outputTotal) / 1e8).toFixed(2),
          clampedTo: MAX_BIGINT.toString(),
          outputCount: tx.vout.length,
        });
        outputTotal = MAX_BIGINT;
      }

      for (const output of tx.vout) {
        const address = output.scriptPubKey?.addresses?.[0];
        const value = this.toSatoshis(output.value);

        if (value !== null) {
          // For outputs without addresses (shielded/OP_RETURN), use a placeholder address
          const utxoAddress = address || 'SHIELDED_OR_NONSTANDARD';

          utxosToCreate.push([
            tx.txid,
            output.n,
            utxoAddress,
            this.safeBigIntToString(value, `utxo:${tx.txid}:${output.n}`),
            output.scriptPubKey.hex || '',
            output.scriptPubKey.type || 'unknown',
            block.height,
          ]);

          // Address delta tracking handled later; nothing else needed here
        }
      }

      txMap.set(tx.txid, tx);
      if (
        !tx.hex ||
        tx.hex.length === 0 ||
        typeof tx.size !== 'number' ||
        tx.size <= 0 ||
        typeof tx.vsize !== 'number' ||
        tx.vsize <= 0
      ) {
        txidsMissingDetails.push(tx.txid);
      }

      txPreparations.push({
        tx,
        isCoinbase,
        inputs,
        outputTotal,
      });
    }

    const inputKeys = Array.from(inputRefKeys);

    if (txidsMissingDetails.length > 0) {
      const uniqueMissing = Array.from(new Set(txidsMissingDetails));

      // OPTIMIZATION: With txindex=0, fetching raw block hex once and extracting all transactions
      // is faster than individual or batch getrawtransaction calls (which fall back to scanning anyway)
      try {
        // Fetch raw block hex once for all missing transactions
        const rawBlockHex = await this.rpc.getBlock(block.hash, 0) as unknown as string;

        for (const missingTxid of uniqueMissing) {
          const target = txMap.get(missingTxid);
          if (!target) continue;

          const txHex = extractTransactionFromBlock(rawBlockHex, missingTxid, block.height);

          if (txHex && txHex.length > 0) {
            target.hex = txHex;
            const computedSize = Math.floor(txHex.length / 2);
            target.size = computedSize;
            target.vsize = computedSize;
          } else {
            logger.warn('Transaction not found in block hex', {
              txid: missingTxid,
              block: block.hash
            });
          }
        }
      } catch (blockError: any) {
        logger.error('Failed to fetch and extract transactions from block hex', {
          block: block.hash,
          error: blockError.message,
          missingCount: uniqueMissing.length
        });
        // Fatal error - can't proceed without transaction data
        throw blockError;
      }
    }

    if (inputKeys.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < inputKeys.length; i += chunkSize) {
        const chunk = inputKeys.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;

        const params: Array<string | number> = [];
        const placeholders = chunk.map((key, idx) => {
          const [txid, voutStr] = key.split(':');
          params.push(txid, Number(voutStr));
          const base = idx * 2;
          return `($${base + 1}, $${base + 2})`;
        }).join(', ');

        if (!placeholders) continue;

        const result = await client.query(
          `SELECT txid, vout, value, address FROM utxos WHERE (txid, vout) IN (${placeholders})`,
          params
        );

        for (const row of result.rows) {
          const normalizedAddress = row.address && row.address !== 'SHIELDED_OR_NONSTANDARD'
            ? row.address
            : null;

          // Validate UTXO value before converting to BigInt to prevent overflow
          // Max valid value is PostgreSQL bigint max: 9,223,372,036,854,775,807 satoshis (~92B FLUX)
          const rawValue = row.value;
          const MAX_BIGINT = BigInt('9223372036854775807');
          let value: bigint;

          try {
            value = BigInt(rawValue);
            if (value < BigInt(0) || value > MAX_BIGINT) {
              logger.warn('Invalid UTXO value detected, clamping to 0', {
                txid: row.txid,
                vout: row.vout,
                value: rawValue.toString(),
              });
              value = BigInt(0);
            }
          } catch (e) {
            logger.warn('Failed to convert UTXO value to BigInt, using 0', {
              txid: row.txid,
              vout: row.vout,
              value: rawValue,
              error: e instanceof Error ? e.message : String(e),
            });
            value = BigInt(0);
          }

          utxoInfoMap.set(`${row.txid}:${row.vout}`, {
            value,
            address: normalizedAddress,
          });
        }
      }
    }

    // Fallback to RPC for any missing inputs (should be rare)
    const missingKeys = inputKeys.filter((key) => !utxoInfoMap.has(key));
    if (missingKeys.length > 0) {
      const missingByTx = new Map<string, number[]>();

      for (const key of missingKeys) {
        const [txid, voutStr] = key.split(':');
        const vout = Number(voutStr);
        const list = missingByTx.get(txid) || [];
        list.push(vout);
        missingByTx.set(txid, list);
      }

      await this.populateInputValuesFromRawTransactions(client, missingByTx, utxoInfoMap);
    }

    // Fetch raw block hex for parsing JoinSplits in v2/v4 transactions
    // This is necessary because getBlock with verbosity 2 doesn't include vjoinsplit data
    const needsRawBlockForFees = transactions.some(tx => tx.version === 2 || tx.version === 4);
    let rawBlockHexForFees: string | null = null;
    const parsedJoinSplitsMap = new Map<string, Array<{ vpub_old: bigint; vpub_new: bigint }>>();
    const parsedValueBalanceMap = new Map<string, bigint>();

    if (needsRawBlockForFees) {
      try {
        rawBlockHexForFees = await this.rpc.getBlock(block.hash, 0) as unknown as string;

        // Parse JoinSplits for all v2/v4 transactions
        const { parseTransactionShieldedData, extractTransactionFromBlock } = await import('../parsers/block-parser');

        for (const tx of transactions) {
          if (tx.version === 2 || tx.version === 4) {
            try {
              let txHex: string | undefined | null = tx.hex;

              if (!txHex && rawBlockHexForFees) {
                txHex = extractTransactionFromBlock(rawBlockHexForFees, tx.txid, block.height);
              }

              if (txHex) {
                const parsed = parseTransactionShieldedData(txHex);

                if (parsed.vjoinsplit && parsed.vjoinsplit.length > 0) {
                  parsedJoinSplitsMap.set(tx.txid, parsed.vjoinsplit);
                }

                if (parsed.valueBalance !== undefined) {
                  parsedValueBalanceMap.set(tx.txid, parsed.valueBalance);
                }
              }
            } catch (error) {
              logger.warn('Failed to parse JoinSplits for fee calculation', {
                txid: tx.txid,
                error: (error as Error).message,
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch raw block hex for fee calculation', {
          blockHeight: block.height,
          blockHash: block.hash,
          error: (error as Error).message,
        });
      }
    }

    for (const prep of txPreparations) {
      // Skip UTXO and address processing for fully shielded transactions
      if (prep.tx.is_shielded) {
        // Still need to add transaction to txValues for database insertion
        const computedSize = prep.tx.size || 0;
        const computedVSize = prep.tx.vsize || computedSize;

        txValues.push([
          prep.tx.txid,
          block.height,
          block.hash,
          block.time,
          prep.tx.version || 0,
          prep.tx.locktime || 0,
          computedSize,
          computedVSize,
          0,  // input_count
          0,  // output_count
          '0',  // input_total
          '0',  // output_total
          '0',  // fee
          false,  // is_coinbase
          null,  // hex
        ]);

        continue;  // Skip UTXO processing for fully shielded
      }

      let inputTotal = BigInt(0);
      const MAX_BIGINT = BigInt('9223372036854775807');
      const seenInputs = new Set<string>(); // Track duplicate inputs

      const txTotalsForTx =
        txAddressTotals.get(prep.tx.txid) || new Map<string, { received: bigint; sent: bigint }>();

      for (const ref of prep.inputs) {
        const key = `${ref.txid}:${ref.vout}`;

        // Detect duplicate inputs
        if (seenInputs.has(key)) {
          logger.error('DUPLICATE INPUT DETECTED', {
            txid: prep.tx.txid,
            duplicateInput: key,
            blockHeight: block.height,
          });
          continue; // Skip duplicate
        }
        seenInputs.add(key);

        const info = utxoInfoMap.get(key);
        if (info && info.value !== undefined) {
          const newInputTotal = inputTotal + info.value;

          // Check for inputTotal overflow
          if (newInputTotal > MAX_BIGINT || newInputTotal < inputTotal) {
            logger.error('Transaction inputTotal overflow detected', {
              txid: prep.tx.txid,
              currentTotal: inputTotal.toString(),
              addingValue: info.value.toString(),
              wouldBe: newInputTotal.toString(),
              blockHeight: block.height,
            });
            inputTotal = MAX_BIGINT; // Clamp to max
          } else {
            inputTotal = newInputTotal;
          }
          if (info.address) {
            const existing = txTotalsForTx.get(info.address) || { received: BigInt(0), sent: BigInt(0) };
            const newSent = existing.sent + info.value;

            // Check for overflow (if result is less than either operand, we overflowed)
            const MAX_BIGINT = BigInt('9223372036854775807');
            if (newSent > MAX_BIGINT || newSent < existing.sent) {
              logger.error('Address sent value overflow detected, clamping', {
                address: info.address,
                txid: prep.tx.txid,
                existingSent: existing.sent.toString(),
                addingValue: info.value.toString(),
                wouldBe: newSent.toString(),
                blockHeight: block.height,
              });
              existing.sent = MAX_BIGINT;  // Clamp to max
            } else {
              existing.sent = newSent;
            }

            txTotalsForTx.set(info.address, existing);
            txParticipants.get(prep.tx.txid)!.inputs.add(info.address);
          }
        } else {
          logger.warn('Missing input value during transaction indexing', {
            txid: prep.tx.txid,
            inputTxid: ref.txid,
            vout: ref.vout,
          });
        }
      }

      for (const output of prep.tx.vout) {
        const value = this.toSatoshis(output.value);
        if (value === null) continue;

        const address = output.scriptPubKey?.addresses?.[0] || null;
        if (address) {
          const existing = txTotalsForTx.get(address) || { received: BigInt(0), sent: BigInt(0) };
          const newReceived = existing.received + value;

          // Check for overflow
          const MAX_BIGINT = BigInt('9223372036854775807');
          if (newReceived > MAX_BIGINT || newReceived < existing.received) {
            logger.error('Address received value overflow detected, clamping', {
              address,
              txid: prep.tx.txid,
              existingReceived: existing.received.toString(),
              addingValue: value.toString(),
              wouldBe: newReceived.toString(),
              blockHeight: block.height,
            });
            existing.received = MAX_BIGINT;  // Clamp to max
          } else {
            existing.received = newReceived;
          }

          txTotalsForTx.set(address, existing);
          txParticipants.get(prep.tx.txid)!.outputs.add(address);
        }
      }

      if (txTotalsForTx.size > 0) {
        txAddressTotals.set(prep.tx.txid, txTotalsForTx);
      }

      const rawHex = prep.tx.hex || null;
      const computedSize = prep.tx.size ?? (rawHex ? Math.floor(rawHex.length / 2) : 0);
      const computedVSize = prep.tx.vsize ?? computedSize;

      // Calculate fee correctly for shielded transactions
      // For shielded transactions: fee = inputs - outputs + shieldedPoolChange
      // where shieldedPoolChange accounts for coins moving between transparent and shielded pools
      let shieldedPoolChange = BigInt(0);

      // V4 Sapling transactions with valueBalance - use parsed data
      const parsedValueBalance = parsedValueBalanceMap.get(prep.tx.txid);
      if (prep.tx.version === 4 && parsedValueBalance !== undefined) {
        // Parsed valueBalance is already in satoshis (bigint)
        // Positive valueBalance = value leaving shielded pool (entering transparent)
        // Negative valueBalance = value entering shielded pool (leaving transparent)
        // For fee calculation: we ADD valueBalance because it represents net flow OUT of shielded pool
        shieldedPoolChange = parsedValueBalance;
      } else if (prep.tx.version === 4 && prep.tx.valueBalance !== undefined) {
        // Fallback to RPC data if parsing failed (valueBalance is in FLUX, convert to satoshis)
        shieldedPoolChange = BigInt(Math.round(prep.tx.valueBalance * 1e8));
      }

      // V2/V4 transactions with JoinSplits (Sprout) - use parsed data
      const parsedJoinSplits = parsedJoinSplitsMap.get(prep.tx.txid);
      if (parsedJoinSplits && parsedJoinSplits.length > 0) {
        // Use parsed JoinSplits (already in satoshis as bigint)
        let joinSplitChange = BigInt(0);
        for (const joinSplit of parsedJoinSplits) {
          // vpub_old = value leaving shielded pool, vpub_new = value entering shielded pool
          joinSplitChange += joinSplit.vpub_old - joinSplit.vpub_new;
        }
        shieldedPoolChange += joinSplitChange;
      } else if ((prep.tx.version === 2 || prep.tx.version === 4) && prep.tx.vjoinsplit && Array.isArray(prep.tx.vjoinsplit)) {
        // Fallback to RPC data if parsing failed (values are in FLUX, convert to satoshis)
        let joinSplitChange = BigInt(0);
        for (const joinSplit of prep.tx.vjoinsplit) {
          const vpubOld = BigInt(Math.round((joinSplit.vpub_old || 0) * 1e8));
          const vpubNew = BigInt(Math.round((joinSplit.vpub_new || 0) * 1e8));
          joinSplitChange += vpubOld - vpubNew;
        }
        shieldedPoolChange += joinSplitChange;
      }

      // Correct fee formula: fee = inputs - outputs - shieldedPoolChange
      // We SUBTRACT shieldedPoolChange because:
      // - When shielding: vpub_old - vpub_new is negative, subtracting it adds to fee (cancels out the shielded amount)
      // - When deshielding: vpub_old - vpub_new is positive, subtracting it reduces fee (cancels out the deshielded amount)
      const fee = prep.isCoinbase ? BigInt(0) : inputTotal - prep.outputTotal - shieldedPoolChange;
      const safeFee = !prep.isCoinbase && fee < BigInt(0) ? BigInt(0) : fee;

      txValues.push([
        prep.tx.txid,
        block.height,
        block.hash,
        block.time,
        prep.tx.version,
        prep.tx.locktime,
        computedSize,
        computedVSize,
        prep.tx.vin.length,
        prep.tx.vout.length,
        this.safeBigIntToString(inputTotal, `tx:${prep.tx.txid}:inputTotal`),
        this.safeBigIntToString(prep.outputTotal, `tx:${prep.tx.txid}:outputTotal`),
        this.safeBigIntToString(safeFee, `tx:${prep.tx.txid}:fee`),
        prep.isCoinbase,
        rawHex,
      ]);
    }

    // 1. Batch insert all transactions
    if (txValues.length > 0) {
      const placeholders = txValues.map((_, i) => {
        const offset = i * 15;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`;
      }).join(', ');

      const txQuery = `
        INSERT INTO transactions (
          txid, block_height, block_hash, timestamp, version, locktime,
          size, vsize, input_count, output_count, input_total, output_total,
          fee, is_coinbase, hex
        ) VALUES ${placeholders}
        ON CONFLICT (txid) DO UPDATE SET
          block_height = EXCLUDED.block_height,
          block_hash = EXCLUDED.block_hash,
          timestamp = EXCLUDED.timestamp
      `;

      await client.query(txQuery, txValues.flat());
    }

    // 2. Prepare temp table for spent UTXOs (create and populate BEFORE creating new UTXOs)
    // This fixes same-block create-and-spend bug: UTXOs created and spent in the same block
    // must be created first, then marked as spent.
    if (utxosToSpend.length > 0) {
      // Drop and recreate to ensure PRIMARY KEY is always present
      await client.query('DROP TABLE IF EXISTS temp_spent_utxos');
      await client.query('CREATE TEMP TABLE temp_spent_utxos (txid TEXT, vout INT, spent_txid TEXT, spent_block_height INT, PRIMARY KEY (txid, vout)) ON COMMIT DROP');

      // PostgreSQL has a parameter limit of 32767 (int16 max), and each spent UTXO has 4 fields
      // To be safe, chunk at 8000 UTXOs per query (8000 * 4 = 32000 parameters < 32767 limit)
      const spendChunkSize = 8000;

      for (let i = 0; i < utxosToSpend.length; i += spendChunkSize) {
        const chunk = utxosToSpend.slice(i, i + spendChunkSize);
        const flatValues = chunk.flat();

        const spendPlaceholders = chunk.map((_, idx) => {
          const offset = idx * 4;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        }).join(', ');

        await client.query(`INSERT INTO temp_spent_utxos (txid, vout, spent_txid, spent_block_height) VALUES ${spendPlaceholders} ON CONFLICT (txid, vout) DO UPDATE SET spent_txid = EXCLUDED.spent_txid, spent_block_height = EXCLUDED.spent_block_height`, flatValues);
      }
    }

    // 3. Batch insert new UTXOs BEFORE marking as spent (fixes same-block create-and-spend bug)
    if (utxosToCreate.length > 0) {
      // PostgreSQL has a parameter limit of 32767 (int16 max), and each UTXO has 7 fields
      // To be safe, chunk at 4500 UTXOs per query (4500 * 7 = 31500 parameters < 32767 limit)
      const utxoChunkSize = 4500;

      for (let i = 0; i < utxosToCreate.length; i += utxoChunkSize) {
        const chunk = utxosToCreate.slice(i, i + utxoChunkSize);

        const utxoPlaceholders = chunk.map((_, idx) => {
          const offset = idx * 7;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, false)`;
        }).join(', ');

        const utxoQuery = `
          INSERT INTO utxos (
            txid, vout, address, value, script_pubkey, script_type, block_height, spent
          ) VALUES ${utxoPlaceholders}
          ON CONFLICT (txid, vout) DO UPDATE SET
            address = EXCLUDED.address,
            value = EXCLUDED.value,
            script_pubkey = EXCLUDED.script_pubkey,
            script_type = EXCLUDED.script_type,
            block_height = EXCLUDED.block_height,
            spent = EXCLUDED.spent
        `;

        await client.query(utxoQuery, chunk.flat());
      }
    }

    // 4. NOW mark UTXOs as spent (after they've been created in step 3)
    if (utxosToSpend.length > 0) {
      await client.query(`
        UPDATE utxos
        SET spent = true,
            spent_txid = temp.spent_txid,
            spent_block_height = temp.spent_block_height,
            spent_at = NOW()
        FROM temp_spent_utxos temp
        WHERE utxos.txid = temp.txid AND utxos.vout = temp.vout
      `);
    }

    // 5. Refresh address transaction cache with correct net flows
    await this.updateAddressTransactionsCache(client, block, txAddressTotals);
    await this.updateTransactionParticipants(client, txParticipants);

    // 6. Batch process FluxNode transactions (if any)
    if (fluxnodeTransactions.length > 0) {
      await this.indexFluxNodeTransactionsBatch(client, block, fluxnodeTransactions);

      logger.info('Indexed block with FluxNode transactions', {
        height: block.height,
        totalTxs: transactions.length,
        fluxnodeTxs: fluxnodeCount
      });
    }
  }

  /**
   * Index a transaction
   */
  private async indexTransaction(
    client: PoolClient,
    tx: Transaction,
    block: Block,
    txIndex: number
  ): Promise<void> {
    // Defensive check: ensure tx.vin and tx.vout are arrays
    if (!Array.isArray(tx.vin) || !Array.isArray(tx.vout)) {
      logger.error('Transaction has invalid vin/vout structure, cannot index', {
        txid: tx.txid,
        hasVin: !!tx.vin,
        hasVout: !!tx.vout,
        vinType: typeof tx.vin,
        voutType: typeof tx.vout,
        blockHeight: block.height,
      });
      throw new SyncError('Transaction has invalid vin/vout structure', { txid: tx.txid });
    }

    const MAX_BIGINT = BigInt('9223372036854775807');
    let inputTotal = BigInt(0);

    if (tx.vin.length > 0 && !tx.vin[0].coinbase) {
      for (const input of tx.vin) {
        if (!input.txid || input.vout === undefined) continue;

        let value: bigint | null = null;

        const result = await client.query(
          'SELECT value FROM utxos WHERE txid = $1 AND vout = $2',
          [input.txid, input.vout]
        );

        if (result.rows.length > 0) {
          value = BigInt(result.rows[0].value);
        } else {
          try {
            const rawTx = await this.rpc.getRawTransaction(input.txid, true) as Transaction;
            const referencedOutput = rawTx?.vout?.[input.vout];
            if (referencedOutput && typeof referencedOutput.value === 'number') {
              // Clamp negative values (e.g., -1 for shielded outputs) to avoid bigint overflow
              const clampedValue = referencedOutput.value < 0 ? 0 : referencedOutput.value;
              value = BigInt(Math.round(clampedValue * 1e8));
            }
          } catch (error: any) {
            logger.warn('Failed to hydrate input value while indexing transaction', {
              txid: tx.txid,
              inputTxid: input.txid,
              vout: input.vout,
              error: error.message,
            });
          }
        }

        if (value !== null) {
          inputTotal += value;
        }
      }
    }

    let outputTotal = tx.vout.reduce((sum, output) => {
      if (typeof output.value !== 'number') {
        return sum;
      }
      // Clamp negative values (e.g., -1 for shielded outputs) to 0
      const clampedValue = output.value < 0 ? 0 : output.value;
      return sum + BigInt(Math.round(clampedValue * 1e8));
    }, BigInt(0));

    // Clamp outputTotal to PostgreSQL bigint max
    if (outputTotal > MAX_BIGINT) {
      logger.error('Transaction outputTotal exceeds PostgreSQL bigint max, clamping', {
        txid: tx.txid,
        outputTotal: outputTotal.toString(),
        outputTotalFlux: (Number(outputTotal) / 1e8).toFixed(2),
        clampedTo: MAX_BIGINT.toString(),
        blockHeight: block.height,
        outputCount: tx.vout.length,
      });
      outputTotal = MAX_BIGINT;
    }

    const isCoinbase = tx.vin.length > 0 && !!tx.vin[0].coinbase;

    // Calculate fee correctly for shielded transactions
    // For shielded transactions: fee = inputs - outputs + shieldedPoolChange
    // where shieldedPoolChange accounts for coins moving between transparent and shielded pools
    let shieldedPoolChange = BigInt(0);

    // Parse shielded data from hex for v2/v4 transactions (RPC doesn't include vjoinsplit)
    if (tx.version === 2 || tx.version === 4) {
      try {
        const { parseTransactionShieldedData } = await import('../parsers/block-parser');
        let txHex = tx.hex;

        // Try to get transaction hex if not available
        if (!txHex) {
          try {
            const txData = await this.rpc.getRawTransaction(tx.txid, true);
            txHex = (txData as any).hex;
          } catch (error) {
            logger.warn('Failed to fetch transaction hex for fee calculation', {
              txid: tx.txid,
              error: (error as Error).message,
            });
          }
        }

        if (txHex) {
          const parsed = parseTransactionShieldedData(txHex);

          // V4 Sapling valueBalance
          if (tx.version === 4 && parsed.valueBalance !== undefined) {
            shieldedPoolChange = parsed.valueBalance;
          }

          // V2/V4 JoinSplits
          if (parsed.vjoinsplit && parsed.vjoinsplit.length > 0) {
            let joinSplitChange = BigInt(0);
            for (const joinSplit of parsed.vjoinsplit) {
              joinSplitChange += joinSplit.vpub_old - joinSplit.vpub_new;
            }
            shieldedPoolChange += joinSplitChange;
          }
        }
      } catch (error) {
        logger.warn('Failed to parse shielded data for fee calculation', {
          txid: tx.txid,
          error: (error as Error).message,
        });

        // Fallback to RPC data if parsing fails
        if (tx.version === 4 && tx.valueBalance !== undefined) {
          shieldedPoolChange = BigInt(Math.round(tx.valueBalance * 1e8));
        }

        if ((tx.version === 2 || tx.version === 4) && tx.vjoinsplit && Array.isArray(tx.vjoinsplit)) {
          let joinSplitChange = BigInt(0);
          for (const joinSplit of tx.vjoinsplit) {
            const vpubOld = BigInt(Math.round((joinSplit.vpub_old || 0) * 1e8));
            const vpubNew = BigInt(Math.round((joinSplit.vpub_new || 0) * 1e8));
            joinSplitChange += vpubOld - vpubNew;
          }
          shieldedPoolChange += joinSplitChange;
        }
      }
    }

    // Correct fee formula: fee = inputs - outputs - shieldedPoolChange
    // We SUBTRACT shieldedPoolChange because:
    // - When shielding: vpub_old - vpub_new is negative, subtracting it adds to fee (cancels out the shielded amount)
    // - When deshielding: vpub_old - vpub_new is positive, subtracting it reduces fee (cancels out the deshielded amount)
    const fee = isCoinbase ? BigInt(0) : inputTotal - outputTotal - shieldedPoolChange;
    const safeFee = !isCoinbase && fee < BigInt(0) ? BigInt(0) : fee;

    // Insert transaction
    const txQuery = `
      INSERT INTO transactions (
        txid, block_height, block_hash, timestamp, version, locktime,
        size, vsize, input_count, output_count, input_total, output_total,
        fee, is_coinbase, hex
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (txid) DO UPDATE SET
        block_height = EXCLUDED.block_height,
        block_hash = EXCLUDED.block_hash,
        timestamp = EXCLUDED.timestamp
    `;

    const txValues = [
      tx.txid,
      block.height,
      block.hash,
      block.time,
      tx.version,
      tx.locktime,
      tx.size,
      tx.vsize || tx.size,
      tx.vin.length,
      tx.vout.length,
      this.safeBigIntToString(inputTotal, `tx:${tx.txid}:inputTotal`),
      this.safeBigIntToString(outputTotal, `tx:${tx.txid}:outputTotal`),
      this.safeBigIntToString(safeFee, `tx:${tx.txid}:fee`),
      isCoinbase,
      tx.hex || null,
    ];

    await client.query(txQuery, txValues);

    // Process inputs (spend UTXOs)
    for (const input of tx.vin) {
      if (input.coinbase) continue; // Skip coinbase inputs

      if (input.txid && input.vout !== undefined) {
        await this.spendUTXO(client, input.txid, input.vout, tx.txid, block.height);
      }
    }

    // Process outputs (create UTXOs)
    for (const output of tx.vout) {
      await this.createUTXO(client, tx.txid, output, block.height);
    }
  }

  /**
   * Create a new UTXO
   */
  private async createUTXO(
    client: PoolClient,
    txid: string,
    output: any,
    blockHeight: number
  ): Promise<void> {
    const address = output.scriptPubKey?.addresses?.[0];
    // For outputs without addresses (shielded/OP_RETURN), use a placeholder address
    const utxoAddress = address || 'SHIELDED_OR_NONSTANDARD';

    // Flux/Zcash can have -1 for shielded outputs or invalid values
    // Clamp negative values to 0 to avoid bigint overflow
    const rawValue = output.value || 0;
    const clampedValue = rawValue < 0 ? 0 : rawValue;
    const value = BigInt(Math.round(clampedValue * 1e8));

    const query = `
      INSERT INTO utxos (
        txid, vout, address, value, script_pubkey, script_type, block_height, spent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false)
      ON CONFLICT (txid, vout) DO UPDATE SET
        address = EXCLUDED.address,
        value = EXCLUDED.value,
        script_pubkey = EXCLUDED.script_pubkey,
        script_type = EXCLUDED.script_type,
        block_height = EXCLUDED.block_height,
        spent = EXCLUDED.spent
    `;

    const values = [
      txid,
      output.n,
      utxoAddress,
      this.safeBigIntToString(value, `utxo:${txid}:${output.n}`),
      output.scriptPubKey?.hex || '',
      output.scriptPubKey?.type || 'unknown',
      blockHeight,
    ];

    await client.query(query, values);

    // Only update address summary for real addresses, not shielded placeholders
    if (address && !this.skipAddressSummary) {
      await this.updateAddressSummary(client, address);
    }
  }

  /**
   * Mark a UTXO as spent
   */
  private async spendUTXO(
    client: PoolClient,
    txid: string,
    vout: number,
    spentTxid: string,
    spentBlockHeight: number
  ): Promise<void> {
    const query = `
      UPDATE utxos
      SET spent = true,
          spent_txid = $3,
          spent_block_height = $4,
          spent_at = NOW()
      WHERE txid = $1 AND vout = $2
      RETURNING address
    `;

    const result = await client.query(query, [txid, vout, spentTxid, spentBlockHeight]);

    // Update address summary if UTXO was found
    if (result.rows.length > 0 && !this.skipAddressSummary) {
      const address = result.rows[0].address;
      await this.updateAddressSummary(client, address);
    }
  }

  /**
   * Index FluxNode transaction (version 3, 5, or 6)
   */
  private async indexFluxNodeTransaction(
    client: PoolClient,
    tx: Transaction,
    block: Block
  ): Promise<void> {
    try {
      const txAny = tx as any;

      // Check if daemon provided FluxNode-specific fields
      const hasDaemonParsedFields = txAny.nType !== undefined;

      logger.debug('Indexing FluxNode transaction', {
        txid: tx.txid,
        version: tx.version,
        hasDaemonFields: hasDaemonParsedFields,
        nType: txAny.nType,
        ip: txAny.ip
      });

      // Get hex for storage and potential parsing
      let txHex: string | null = tx.hex || null;

      if (!txHex) {
        // Try to extract from raw block
        const rawBlockHex = await this.rpc.getBlock(block.hash, 0) as unknown as string;
        txHex = extractFluxNodeTransaction(rawBlockHex, tx.txid, block.height);

        if (!txHex) {
          logger.error('Could not get hex for FluxNode transaction, skipping', {
            txid: tx.txid
          });
          return;
        }
      }

      // If daemon didn't parse the fields, parse them ourselves from hex
      if (!hasDaemonParsedFields && txHex) {
        logger.debug('Daemon did not parse FluxNode fields, parsing from hex', {
          txid: tx.txid
        });

        const { parseFluxNodeTransaction } = await import('../parsers/fluxnode-parser');
        const parsedData = parseFluxNodeTransaction(txHex);

        if (parsedData) {
          // Merge parsed data into tx object
          txAny.nType = parsedData.type;
          txAny.collateralOutputHash = parsedData.collateralHash;
          txAny.collateralOutputIndex = parsedData.collateralIndex;
          txAny.ip = parsedData.ipAddress;
          txAny.zelnodePubKey = parsedData.publicKey;
          txAny.sig = parsedData.signature;
          txAny.benchmarkTier = parsedData.benchmarkTier;

          logger.debug('Successfully parsed FluxNode transaction from hex', {
            txid: tx.txid,
            nType: parsedData.type
          });
        } else {
          logger.error('Failed to parse FluxNode transaction from hex', {
            txid: tx.txid
          });
          return;
        }
      }

      // Determine benchmark tier from collateral for start transactions
      let benchmarkTier: string | null = txAny.benchmarkTier || null;

      if (!benchmarkTier && txAny.collateralOutputHash && txAny.collateralOutputIndex !== undefined) {
        // Look up collateral UTXO to get amount
        const utxoResult = await client.query(
          'SELECT value FROM utxos WHERE txid = $1 AND vout = $2',
          [txAny.collateralOutputHash, txAny.collateralOutputIndex]
        );

        if (utxoResult.rows.length > 0) {
          const collateralAmount = BigInt(utxoResult.rows[0].value);
          benchmarkTier = determineFluxNodeTier(collateralAmount);
        }
      }

      // Insert into fluxnode_transactions table
      await client.query(
        `INSERT INTO fluxnode_transactions (
          txid, block_height, block_hash, block_time, version, type,
          collateral_hash, collateral_index, ip_address, public_key, signature,
          p2sh_address, benchmark_tier, extra_data, raw_hex
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (txid) DO UPDATE SET
          block_height = EXCLUDED.block_height,
          block_hash = EXCLUDED.block_hash,
          block_time = EXCLUDED.block_time,
          version = EXCLUDED.version,
          type = EXCLUDED.type,
          collateral_hash = EXCLUDED.collateral_hash,
          collateral_index = EXCLUDED.collateral_index,
          ip_address = EXCLUDED.ip_address,
          public_key = EXCLUDED.public_key,
          signature = EXCLUDED.signature,
          p2sh_address = EXCLUDED.p2sh_address,
          benchmark_tier = EXCLUDED.benchmark_tier,
          extra_data = EXCLUDED.extra_data,
          raw_hex = EXCLUDED.raw_hex`,
        [
          tx.txid,
          block.height,
          block.hash,
          new Date(block.time * 1000),
          tx.version,
          txAny.nType ?? null,
          txAny.collateralOutputHash || null,
          txAny.collateralOutputIndex ?? null,
          txAny.ip || null,
          txAny.zelnodePubKey || txAny.fluxnodePubKey || null,
          txAny.sig || null,
          txAny.redeemScript || null,
          benchmarkTier,
          JSON.stringify({
            sigTime: txAny.sigTime,
            benchmarkSigTime: txAny.benchmarkSigTime,
            updateType: txAny.updateType,
            nFluxNodeTxVersion: txAny.nFluxNodeTxVersion
          }),
          txHex || '',
        ]
      );

      // Also insert a basic entry in transactions table for consistency
      await client.query(
        `INSERT INTO transactions (
          txid, block_height, block_hash, timestamp, version, locktime,
          size, vsize, input_count, output_count, input_total, output_total,
          fee, is_coinbase, hex, is_fluxnode_tx, fluxnode_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (txid) DO UPDATE SET
          is_fluxnode_tx = TRUE,
          fluxnode_type = EXCLUDED.fluxnode_type,
          hex = EXCLUDED.hex`,
        [
          tx.txid,
          block.height,
          block.hash,
          block.time, // INTEGER unix timestamp, not Date object!
          tx.version,
          tx.locktime || 0,
          tx.size || (txHex ? txHex.length / 2 : 0),
          tx.vsize || (txHex ? txHex.length / 2 : 0),
          0, // No standard inputs
          0, // No standard outputs
          '0',
          '0',
          '0',
          false,
          txHex || '',
          true, // is_fluxnode_tx
          txAny.nType ?? null,
        ]
      );

      logger.debug('Successfully indexed FluxNode transaction', {
        txid: tx.txid,
        version: tx.version,
        nType: txAny.nType,
        tier: benchmarkTier,
        ip: txAny.ip
      });
    } catch (error: any) {
      logger.error('Failed to index FluxNode transaction', {
        txid: tx.txid,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Batch index FluxNode transactions (OPTIMIZED)
   * This method processes multiple FluxNode transactions efficiently by:
   * 1. Batching RPC calls for verbose transaction data
   * 2. Fetching raw block hex only once (not per transaction)
   * 3. Batching collateral UTXO lookups
   * 4. Batching database inserts
   */
  private async indexFluxNodeTransactionsBatch(
    client: PoolClient,
    block: Block,
    fluxnodeTxs: Transaction[]
  ): Promise<void> {
    if (fluxnodeTxs.length === 0) return;

    const { parseFluxNodeTransaction } = await import('../parsers/fluxnode-parser');

    // OPTIMIZATION: With txindex=0, fetching raw block hex and parsing is faster than batch RPC
    // Skip batch RPC entirely and go straight to hex-based parsing

    // Step 1: Get raw block hex once for all FluxNode transactions
    let rawBlockHex: string | null = null;

    try {
      rawBlockHex = await this.rpc.getBlock(block.hash, 0) as unknown as string;
    } catch (error: any) {
      logger.error('Failed to fetch raw block hex for FluxNode extraction', {
        block: block.hash,
        height: block.height,
        error: error.message
      });
      // Fatal error - can't parse FluxNode transactions without block hex
      throw error;
    }

    // Step 2: Extract and parse all FluxNode transactions from block hex
    for (const tx of fluxnodeTxs) {
      const txAny = tx as any;

      // Extract hex from block if missing
      if (!tx.hex) {
        tx.hex = extractFluxNodeTransaction(rawBlockHex, tx.txid, block.height) || undefined;

        if (!tx.hex) {
          logger.warn('Failed to extract FluxNode transaction from block hex', {
            txid: tx.txid,
            blockHeight: block.height,
            blockHash: block.hash
          });
          continue;
        }
      }

      // Parse FluxNode fields from hex
      if (txAny.nType === undefined) {
        const parsedData = parseFluxNodeTransaction(tx.hex);
        if (parsedData) {
          txAny.nType = parsedData.type;
          txAny.collateralOutputHash = parsedData.collateralHash;
          txAny.collateralOutputIndex = parsedData.collateralIndex;
          txAny.ip = parsedData.ipAddress;
          txAny.zelnodePubKey = parsedData.publicKey;
          txAny.sig = parsedData.signature;
          txAny.benchmarkTier = parsedData.benchmarkTier;
        } else {
          logger.warn('Failed to parse FluxNode data from hex', {
            txid: tx.txid,
            blockHeight: block.height
          });
        }
      }
    }

    // Step 3: Batch lookup collateral UTXOs for tier determination
    const collateralRefs: Array<{ txid: string; vout: number; fluxnodeTxid: string }> = [];

    for (const tx of fluxnodeTxs) {
      const txAny = tx as any;
      if (!txAny.benchmarkTier && txAny.collateralOutputHash && txAny.collateralOutputIndex !== undefined) {
        collateralRefs.push({
          txid: txAny.collateralOutputHash,
          vout: txAny.collateralOutputIndex,
          fluxnodeTxid: tx.txid
        });
      }
    }

    const tierMap = new Map<string, string>();

    if (collateralRefs.length > 0) {
      // Batch query for all collateral UTXOs
      const params: Array<string | number> = [];
      const placeholders = collateralRefs.map((ref, idx) => {
        params.push(ref.txid, ref.vout);
        const base = idx * 2;
        return `($${base + 1}, $${base + 2})`;
      }).join(', ');

      const utxoResult = await client.query(
        `SELECT txid, vout, value FROM utxos WHERE (txid, vout) IN (${placeholders})`,
        params
      );

      // Create map of collateral -> tier
      for (const row of utxoResult.rows) {
        const collateralAmount = BigInt(row.value);
        const tier = determineFluxNodeTier(collateralAmount);
        tierMap.set(`${row.txid}:${row.vout}`, tier);
      }
    }

    // Step 4: Prepare batch insert data
    const fluxnodeTxValues: any[][] = [];
    const regularTxValues: any[][] = [];

    for (const tx of fluxnodeTxs) {
      const txAny = tx as any;
      const txHex = tx.hex || '';

      // Determine tier from map or existing value
      let benchmarkTier: string | null = txAny.benchmarkTier || null;
      if (!benchmarkTier && txAny.collateralOutputHash && txAny.collateralOutputIndex !== undefined) {
        benchmarkTier = tierMap.get(`${txAny.collateralOutputHash}:${txAny.collateralOutputIndex}`) || null;
      }

      // FluxNode transactions table
      fluxnodeTxValues.push([
        tx.txid,
        block.height,
        block.hash,
        new Date(block.time * 1000),
        tx.version,
        txAny.nType ?? null,
        txAny.collateralOutputHash || null,
        txAny.collateralOutputIndex ?? null,
        txAny.ip || null,
        txAny.zelnodePubKey || txAny.fluxnodePubKey || null,
        txAny.sig || null,
        txAny.redeemScript || null,
        benchmarkTier,
        JSON.stringify({
          sigTime: txAny.sigTime,
          benchmarkSigTime: txAny.benchmarkSigTime,
          updateType: txAny.updateType,
          nFluxNodeTxVersion: txAny.nFluxNodeTxVersion
        }),
        txHex,
      ]);

      // Regular transactions table
      regularTxValues.push([
        tx.txid,
        block.height,
        block.hash,
        block.time,
        tx.version,
        tx.locktime || 0,
        tx.size || (txHex ? txHex.length / 2 : 0),
        tx.vsize || (txHex ? txHex.length / 2 : 0),
        0, // input_count
        0, // output_count
        '0', // input_total
        '0', // output_total
        '0', // fee
        false, // is_coinbase
        txHex,
        true, // is_fluxnode_tx
        txAny.nType ?? null,
      ]);
    }

    // Step 5: Batch insert into fluxnode_transactions table
    if (fluxnodeTxValues.length > 0) {
      const placeholders = fluxnodeTxValues.map((_, i) => {
        const offset = i * 15;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15})`;
      }).join(', ');

      await client.query(
        `INSERT INTO fluxnode_transactions (
          txid, block_height, block_hash, block_time, version, type,
          collateral_hash, collateral_index, ip_address, public_key, signature,
          p2sh_address, benchmark_tier, extra_data, raw_hex
        ) VALUES ${placeholders}
        ON CONFLICT (txid) DO UPDATE SET
          block_height = EXCLUDED.block_height,
          block_hash = EXCLUDED.block_hash,
          block_time = EXCLUDED.block_time,
          version = EXCLUDED.version,
          type = EXCLUDED.type,
          collateral_hash = EXCLUDED.collateral_hash,
          collateral_index = EXCLUDED.collateral_index,
          ip_address = EXCLUDED.ip_address,
          public_key = EXCLUDED.public_key,
          signature = EXCLUDED.signature,
          p2sh_address = EXCLUDED.p2sh_address,
          benchmark_tier = EXCLUDED.benchmark_tier,
          extra_data = EXCLUDED.extra_data,
          raw_hex = EXCLUDED.raw_hex`,
        fluxnodeTxValues.flat()
      );
    }

    // Step 6: Batch insert into transactions table
    if (regularTxValues.length > 0) {
      const placeholders = regularTxValues.map((_, i) => {
        const offset = i * 17;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17})`;
      }).join(', ');

      await client.query(
        `INSERT INTO transactions (
          txid, block_height, block_hash, timestamp, version, locktime,
          size, vsize, input_count, output_count, input_total, output_total,
          fee, is_coinbase, hex, is_fluxnode_tx, fluxnode_type
        ) VALUES ${placeholders}
        ON CONFLICT (txid) DO UPDATE SET
          is_fluxnode_tx = TRUE,
          fluxnode_type = EXCLUDED.fluxnode_type,
          hex = EXCLUDED.hex`,
        regularTxValues.flat()
      );
    }

    logger.debug('Batch indexed FluxNode transactions', {
      count: fluxnodeTxs.length,
      blockHeight: block.height
    });
  }

  /**
   * Update address summary statistics
   */
  private async updateAddressSummary(client: PoolClient, address: string): Promise<void> {
    await client.query('SELECT update_address_summary($1)', [address]);
  }

  /**
   * Refresh the address_transactions cache for the provided txids using net values.
   */
  private async updateAddressTransactionsCache(
    client: PoolClient,
    block: Block,
    addressTotals: Map<string, Map<string, { received: bigint; sent: bigint }>>
  ): Promise<void> {
    if (addressTotals.size === 0) return;

    const entries: Array<{
      txid: string;
      address: string;
      received: bigint;
      sent: bigint;
    }> = [];

    for (const [txid, totalsMap] of addressTotals.entries()) {
      for (const [address, totals] of totalsMap.entries()) {
        if (totals.received === BigInt(0) && totals.sent === BigInt(0)) continue;
        entries.push({ txid, address, received: totals.received, sent: totals.sent });
      }
    }

    if (entries.length === 0) return;

    // PostgreSQL has a parameter limit of 32767 (int16 max), and each entry has 8 fields
    // To be safe, chunk at 4000 entries per query (4000 * 8 = 32000 parameters < 32767 limit)
    const chunkSize = 4000;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);

      const params: Array<string | number> = [];
      const MAX_BIGINT = BigInt('9223372036854775807');
      const WARN_THRESHOLD = MAX_BIGINT / BigInt(2); // Warn if over half of max

      const placeholders = chunk.map((entry, index) => {
        const base = index * 8;
        const direction = entry.received >= entry.sent ? 'received' : 'sent';

        // Clamp values to PostgreSQL bigint max before inserting
        let clampedReceived = entry.received;
        let clampedSent = entry.sent;

        // Log suspiciously large values (even if under max)
        if (entry.received > WARN_THRESHOLD || entry.sent > WARN_THRESHOLD) {
          logger.warn('Large address transaction value detected', {
            address: entry.address,
            txid: entry.txid,
            received: entry.received.toString(),
            sent: entry.sent.toString(),
            receivedFlux: (Number(entry.received) / 1e8).toFixed(2),
            sentFlux: (Number(entry.sent) / 1e8).toFixed(2),
            blockHeight: block.height,
          });
        }

        if (entry.received > MAX_BIGINT) {
          logger.error('Clamping address received value before database insert', {
            address: entry.address,
            txid: entry.txid,
            received: entry.received.toString(),
            clampedTo: MAX_BIGINT.toString(),
            blockHeight: block.height,
          });
          clampedReceived = MAX_BIGINT;
        }

        if (entry.sent > MAX_BIGINT) {
          logger.error('Clamping address sent value before database insert', {
            address: entry.address,
            txid: entry.txid,
            sent: entry.sent.toString(),
            clampedTo: MAX_BIGINT.toString(),
            blockHeight: block.height,
          });
          clampedSent = MAX_BIGINT;
        }

        params.push(
          entry.address,
          entry.txid,
          block.height,
          block.time,
          block.hash,
          direction,
          clampedReceived.toString(),
          clampedSent.toString()
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      }).join(', ');

      const sql = `
        INSERT INTO address_transactions (
          address,
          txid,
          block_height,
          timestamp,
          block_hash,
          direction,
          received_value,
          sent_value
        ) VALUES ${placeholders}
        ON CONFLICT (address, txid) DO UPDATE SET
          block_height   = EXCLUDED.block_height,
          timestamp      = EXCLUDED.timestamp,
          block_hash     = EXCLUDED.block_hash,
          direction      = EXCLUDED.direction,
          received_value = EXCLUDED.received_value,
          sent_value     = EXCLUDED.sent_value;
      `;

      await client.query(sql, params);
    }
  }

  /**
   * Upsert deduplicated input/output address sets for each transaction.
   */
  private async updateTransactionParticipants(
    client: PoolClient,
    participants: Map<string, { inputs: Set<string>; outputs: Set<string> }>
  ): Promise<void> {
    if (participants.size === 0) return;

    const entries = Array.from(participants.entries());
    const chunkSize = 500;
    const addressLimit = 64;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const params: Array<any> = [];
      const placeholders = chunk.map((entry, index) => {
        const base = index * 5;
        const inputs = Array.from(entry[1].inputs);
        const outputs = Array.from(entry[1].outputs);
        params.push(
          entry[0],
          inputs.slice(0, addressLimit),
          inputs.length,
          outputs.slice(0, addressLimit),
          outputs.length
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      }).join(', ');

      if (!placeholders) continue;

      await client.query(
        `
          INSERT INTO transaction_participants (txid, input_addresses, input_count, output_addresses, output_count)
          VALUES ${placeholders}
          ON CONFLICT (txid) DO UPDATE SET
            input_addresses = EXCLUDED.input_addresses,
            input_count = EXCLUDED.input_count,
            output_addresses = EXCLUDED.output_addresses,
            output_count = EXCLUDED.output_count
        `,
        params
      );
    }
  }

  /**
   * Update FluxNode producer statistics
   */
  private async updateProducerStats(client: PoolClient, block: Block): Promise<void> {
    if (!block.producer) return;

    const reward = block.producerReward ? BigInt(Math.floor(block.producerReward * 1e8)) : BigInt(0);

    const query = `
      INSERT INTO producers (
        fluxnode, blocks_produced, first_block, last_block, total_rewards, updated_at
      ) VALUES ($1, 1, $2, $2, $3, NOW())
      ON CONFLICT (fluxnode) DO UPDATE SET
        blocks_produced = producers.blocks_produced + 1,
        last_block = $2,
        total_rewards = producers.total_rewards + $3,
        updated_at = NOW()
    `;

    await client.query(query, [block.producer, block.height, reward.toString()]);
  }

  /**
   * Update sync state
   */
  private async updateSyncState(client: PoolClient, height: number, hash: string): Promise<void> {
    const query = `
      UPDATE sync_state
      SET current_height = $1,
          last_block_hash = $2,
          last_sync_time = NOW()
      WHERE id = 1
    `;

    await client.query(query, [height, hash]);
  }

  /**
   * Get current sync state
   */
  async getSyncState(): Promise<{
    currentHeight: number;
    chainHeight: number;
    lastBlockHash: string | null;
    isSyncing: boolean;
  }> {
    const result = await this.db.query(`
      SELECT current_height, chain_height, last_block_hash, is_syncing
      FROM sync_state
      WHERE id = 1
    `);

    const row = result.rows[0];
    return {
      currentHeight: row?.current_height || 0,
      chainHeight: row?.chain_height || 0,
      lastBlockHash: row?.last_block_hash || null,
      isSyncing: row?.is_syncing || false,
    };
  }

  /**
   * Set syncing status
   */
  async setSyncingStatus(isSyncing: boolean, chainHeight?: number): Promise<void> {
    const query = chainHeight !== undefined
      ? 'UPDATE sync_state SET is_syncing = $1, chain_height = $2 WHERE id = 1'
      : 'UPDATE sync_state SET is_syncing = $1 WHERE id = 1';

    const params = chainHeight !== undefined ? [isSyncing, chainHeight] : [isSyncing];
    await this.db.query(query, params);
  }

  /**
   * Calculate and store shielded pool statistics for a block
   */
  private async updateSupplyStats(
    client: PoolClient,
    blockHeight: number,
    transactions: Transaction[]
  ): Promise<void> {
    let shieldedPoolChange = BigInt(0);

    // Fetch raw block hex if we have any v2 or v4 transactions that need parsing
    // This is necessary because getBlock with verbosity 2 doesn't include tx.hex
    const needsRawBlock = transactions.some(tx => tx.version === 2 || tx.version === 4);
    let rawBlockHex: string | null = null;

    if (needsRawBlock) {
      try {
        // Get block hash from first transaction's blockhash, or query from DB
        const blockHashQuery = await client.query('SELECT hash FROM blocks WHERE height = $1', [blockHeight]);
        const blockHash = blockHashQuery.rows[0]?.hash;

        if (blockHash) {
          rawBlockHex = await this.rpc.getBlock(blockHash, 0) as unknown as string;
        }
      } catch (error) {
        logger.warn('Failed to fetch raw block hex for shielded pool calculation', {
          blockHeight,
          error: (error as Error).message,
        });
      }
    }

    // Calculate shielded pool changes from this block's transactions
    for (const tx of transactions) {
      // Check if we need to parse shielded data from hex
      let parsedVpubs: Array<{ vpub_old: bigint; vpub_new: bigint }> | undefined;
      let parsedValueBalance: bigint | undefined;

      // Always parse from hex to maintain satoshi-level precision
      // RPC returns float values which lose precision when converted to/from satoshis
      if ((tx.version === 2 || tx.version === 4)) {
        try {
          const { parseTransactionShieldedData, extractTransactionFromBlock } = await import('../parsers/block-parser');

          // Get transaction hex - either from tx.hex or extract from raw block
          let txHex: string | undefined = tx.hex;
          if (!txHex && rawBlockHex) {
            const extracted = extractTransactionFromBlock(rawBlockHex, tx.txid, blockHeight);
            txHex = extracted || undefined;
          }

          if (txHex) {
            const shieldedData = parseTransactionShieldedData(txHex);
            parsedVpubs = shieldedData.vjoinsplit;
            parsedValueBalance = shieldedData.valueBalance;
          }
        } catch (error) {
          logger.warn('Failed to parse shielded data from transaction hex', {
            txid: tx.txid,
            blockHeight,
            error: (error as Error).message,
          });
        }
      }

      // V2 and V4 transactions with JoinSplits (Sprout shielded operations)
      // V4 transactions can contain BOTH JoinSplits (Sprout) AND valueBalance (Sapling)
      if (tx.version === 2 || tx.version === 4) {
        // CRITICAL: Prefer RPC data over parsed data
        // The hex parser can misread large FluxNode transactions and produce garbage JoinSplits
        let joinsplits: any[] | undefined = tx.vjoinsplit;
        let usingParsedData = false;

        // Only use parsed data if RPC didn't provide JoinSplit data
        if ((!joinsplits || joinsplits.length === 0) && parsedVpubs && parsedVpubs.length > 0) {
          joinsplits = parsedVpubs as any[];
          usingParsedData = true;
        }

        if (joinsplits && Array.isArray(joinsplits)) {
          let txJoinSplitChange = BigInt(0);
          let hasInsaneValue = false;

          for (let jsIndex = 0; jsIndex < joinsplits.length; jsIndex++) {
            const joinSplit = joinsplits[jsIndex];
            // vpub_old: value entering shielded pool (from transparent)
            // vpub_new: value exiting shielded pool (to transparent)
            // Handle both bigint (from parser) and number (from RPC) types
            const vpubOld: bigint = typeof joinSplit.vpub_old === 'bigint'
              ? joinSplit.vpub_old
              : BigInt(Math.round((joinSplit.vpub_old || 0) * 1e8));
            const vpubNew: bigint = typeof joinSplit.vpub_new === 'bigint'
              ? joinSplit.vpub_new
              : BigInt(Math.round((joinSplit.vpub_new || 0) * 1e8));

            // SANITY CHECK: Prevent bogus parser values in JoinSplits
            // Maximum theoretical Flux supply is ~1 billion FLUX = 1e17 satoshis
            // Any vpub value larger than this is a parser error
            const MAX_REASONABLE_VALUE = BigInt(1_000_000_000) * BigInt(100_000_000); // 1B FLUX in satoshis
            const absVpubOld = vpubOld < BigInt(0) ? -vpubOld : vpubOld;
            const absVpubNew = vpubNew < BigInt(0) ? -vpubNew : vpubNew;

            if (absVpubOld > MAX_REASONABLE_VALUE || absVpubNew > MAX_REASONABLE_VALUE) {
              if (jsIndex === 0) {
                // Only log once per transaction to avoid spam
                logger.error('Hex parser produced insane JoinSplit values - discarding ALL parsed JoinSplits for this tx', {
                  txid: tx.txid,
                  blockHeight,
                  firstBadVpubOld: vpubOld.toString(),
                  firstBadVpubNew: vpubNew.toString(),
                  usingParsedData,
                  hasRPCData: tx.vjoinsplit !== undefined && tx.vjoinsplit.length > 0,
                  totalJoinSplits: joinsplits.length,
                });
              }
              hasInsaneValue = true;
              break; // Stop processing - all JoinSplits from this parse are suspect
            }

            txJoinSplitChange += vpubOld - vpubNew;
          }

          // Only apply JoinSplit changes if they passed sanity check
          if (!hasInsaneValue) {
            shieldedPoolChange += txJoinSplitChange;
          } else if (usingParsedData) {
            // Parser produced garbage - treat transaction as having no JoinSplits
            logger.warn('Ignoring parsed JoinSplits due to insane values - transaction treated as no JoinSplits', {
              txid: tx.txid,
              blockHeight,
              parsedJoinSplitCount: joinsplits.length,
            });
          }
        }
      }

      // V4 Sapling transactions with valueBalance - use parsed or existing data
      if (tx.version === 4) {
        const vBalance = tx.valueBalance ?? parsedValueBalance;
        if (vBalance !== undefined) {
          // Standard Zcash/Flux Sapling semantics:
          // Positive valueBalance = value leaving shielded pool (pool decreases)
          // Negative valueBalance = value entering shielded pool (pool increases)
          // So we SUBTRACT valueBalance from pool change
          //
          // Handle both bigint (from parser) and number (from RPC) types
          const valueBalanceSatoshis = typeof vBalance === 'bigint'
            ? vBalance
            : BigInt(Math.round(vBalance * 1e8));

          // SANITY CHECK: Prevent bogus parser values from corrupting shielded pool
          // Maximum theoretical Flux supply is ~1 billion FLUX = 1e17 satoshis
          // Any valueBalance larger than this is a parser error
          const MAX_REASONABLE_VALUE = BigInt(1_000_000_000) * BigInt(100_000_000); // 1B FLUX in satoshis
          const absValue = valueBalanceSatoshis < BigInt(0) ? -valueBalanceSatoshis : valueBalanceSatoshis;

          if (absValue > MAX_REASONABLE_VALUE) {
            logger.error('FOUND IT! Insane valueBalance detected from parser, skipping', {
              txid: tx.txid,
              blockHeight,
              valueBalanceSatoshis: valueBalanceSatoshis.toString(),
              valueBalanceFlux: (Number(valueBalanceSatoshis) / 1e8).toFixed(2),
              parsedFromHex: parsedValueBalance !== undefined,
              fromRPC: tx.valueBalance !== undefined,
            });
            // Skip this insane value - don't apply it to shielded pool
            continue;
          }

          // SUBTRACT valueBalance (standard Zcash semantics)
          shieldedPoolChange -= valueBalanceSatoshis;
        }
      }
    }

    // Get previous shielded pool value
    const prevQuery = `
      SELECT shielded_pool
      FROM supply_stats
      WHERE block_height < $1
      ORDER BY block_height DESC
      LIMIT 1
    `;
    const prevResult = await client.query(prevQuery, [blockHeight]);
    const prevShieldedPool = prevResult.rows[0]?.shielded_pool
      ? BigInt(prevResult.rows[0].shielded_pool)
      : BigInt(0);

    // Calculate new shielded pool
    const newShieldedPool = prevShieldedPool + shieldedPoolChange;

    // Insert supply stats for this block
    // Note: transparent_supply and total_supply are calculated on-demand by the API
    // to avoid expensive SUM queries on every block during indexing
    const insertQuery = `
      INSERT INTO supply_stats (
        block_height, transparent_supply, shielded_pool, total_supply, updated_at
      ) VALUES ($1, 0, $2, 0, NOW())
      ON CONFLICT (block_height) DO UPDATE SET
        shielded_pool = EXCLUDED.shielded_pool,
        updated_at = NOW()
    `;

    await client.query(insertQuery, [
      blockHeight,
      newShieldedPool.toString(),
    ]);

    // Log significant shielded pool changes
    if (shieldedPoolChange !== BigInt(0)) {
      logger.debug('Shielded pool change detected', {
        blockHeight,
        change: shieldedPoolChange.toString(),
        newTotal: newShieldedPool.toString(),
      });
    }
  }
}
