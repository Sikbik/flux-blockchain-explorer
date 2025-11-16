/**
 * Sync Engine
 *
 * Manages blockchain synchronization and continuous indexing
 * with automatic performance optimization
 */

import { FluxRPCClient } from '../rpc/flux-rpc-client';
import { DatabaseConnection } from '../database/connection';
import { BlockIndexer } from './block-indexer';
import { DatabaseOptimizer } from '../database/optimizer';
import { logger } from '../utils/logger';
import { SyncError } from '../types';

export interface SyncConfig {
  batchSize: number;
  pollingInterval: number;
  startHeight?: number;
  maxReorgDepth: number;
}

export class SyncEngine {
  private blockIndexer: BlockIndexer;
  private optimizer: DatabaseOptimizer;
  private isRunning = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncTime = Date.now();
  private blocksIndexed = 0;
  private syncInProgress = false;
  private lastOptimizationCheck = 0;
  private consecutiveErrors = 0;
  private daemonReady = false;

  constructor(
    private rpc: FluxRPCClient,
    private db: DatabaseConnection,
    private config: SyncConfig
  ) {
    this.blockIndexer = new BlockIndexer(rpc, db);
    this.optimizer = new DatabaseOptimizer(db);
  }

  /**
   * Start synchronization
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Sync engine already running');
      return;
    }

    logger.info('Starting sync engine...');
    this.isRunning = true;

    // Ensure performance indexes exist on startup
    try {
      await this.optimizer.ensureIndexes();
      logger.info('✅ Performance indexes verified');
    } catch (error: any) {
      logger.warn('Failed to ensure performance indexes (will continue anyway)', { error: error.message });
    }

    // Set up polling interval (will retry if RPC not ready)
    this.syncInterval = setInterval(async () => {
      try {
        await this.sync();
        this.consecutiveErrors = 0; // Reset on success
        if (!this.daemonReady) {
          this.daemonReady = true;
          logger.info('Daemon is ready and responding');
        }
      } catch (error: any) {
        this.consecutiveErrors++;
        // During daemon warmup, log minimally at debug level
        if (this.daemonReady) {
          // Daemon was ready but now failing - log as warning
          logger.warn('Sync error (will retry)', { error: error.message });
        } else if (this.consecutiveErrors === 1) {
          // First warmup message only
          logger.info('Waiting for Flux daemon to respond to RPC calls...');
        } else if (this.consecutiveErrors % 30 === 0) {
          // Every 30 attempts (~2.5 minutes) show we're still waiting
          logger.debug('Still waiting for daemon warmup', { attempts: this.consecutiveErrors });
        }
      }
    }, this.config.pollingInterval);

    logger.info('Sync engine started', {
      pollingInterval: this.config.pollingInterval,
      batchSize: this.config.batchSize,
    });
    logger.info('Waiting for Flux daemon to be ready...');

    // Try initial sync in background (don't block startup)
    this.sync().catch(error => {
      logger.warn('Initial sync failed, will retry', { error: error.message });
    });
  }

  /**
   * Stop synchronization
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping sync engine...');

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.isRunning = false;
    await this.blockIndexer.setSyncingStatus(false);

    logger.info('Sync engine stopped');
  }

  /**
   * Perform synchronization
   */
  private async sync(): Promise<void> {
    if (this.syncInProgress) {
      logger.debug('Sync already in progress, skipping trigger');
      return;
    }

    this.syncInProgress = true;

    try {
      // Get chain info from RPC - use headers as chain height since it represents
      // the actual network height that the daemon is aware of
      const chainInfo = await this.rpc.getBlockchainInfo();
      const chainHeight = chainInfo.headers;

      // Get current indexed height from database
      const syncState = await this.blockIndexer.getSyncState();
      let currentHeight = syncState.currentHeight;

      // Ensure block indexer respects current optimization mode
      this.blockIndexer.setSkipAddressSummary(this.optimizer.isFastSyncEnabled());

      // Use start height from config if specified and higher
      if (this.config.startHeight !== undefined && currentHeight < this.config.startHeight) {
        currentHeight = this.config.startHeight - 1;
      }

      // During daemon initial sync, stay 1000 blocks behind to avoid constant reorgs.
      // Once daemon is caught up (blocks == headers), index all the way to the tip.
      const safetyBuffer = 1000;
      const blocksBehind = chainHeight - currentHeight;
      const daemonIsSyncing = chainInfo.blocks < chainInfo.headers;

      const indexingTarget = daemonIsSyncing && blocksBehind > safetyBuffer
        ? Math.max(0, chainHeight - safetyBuffer)  // Keep buffer during daemon sync
        : chainHeight;  // Chase tip when daemon is synced

      // Update chain height in database (use actual chain height, not buffered)
      await this.blockIndexer.setSyncingStatus(true, chainHeight);

      // Check if we're in sync (compare against buffered height)
      if (currentHeight >= indexingTarget) {
        logger.debug('In sync with buffer', { currentHeight, indexingTarget, actualChainHeight: chainHeight });
        await this.blockIndexer.setSyncingStatus(false, chainHeight);
        return;
      }

      // Check if we need to enable/disable Fast Sync Mode before starting batch
      await this.optimizer.autoOptimize(currentHeight, chainHeight);
      this.blockIndexer.setSkipAddressSummary(this.optimizer.isFastSyncEnabled());

      // Calculate blocks to sync (to buffered target, not latest chain tip)
      const blocksToSync = indexingTarget - currentHeight;
      const batchSize = Math.min(this.config.batchSize, blocksToSync);

      logger.info(`Syncing blocks ${currentHeight + 1} to ${currentHeight + batchSize}`, {
        blocksToSync,
        batchSize,
        progress: `${currentHeight}/${indexingTarget} (buffer: ${safetyBuffer} blocks)`,
        actualChainHeight: chainHeight,
      });

      // Index blocks in batch
      const heightsToFetch: number[] = [];
      for (let height = currentHeight + 1; height <= currentHeight + batchSize; height++) {
        heightsToFetch.push(height);
      }

      const startTime = Date.now();
      const blocks = await this.rpc.batchGetBlocks(heightsToFetch);

      if (blocks.length !== heightsToFetch.length) {
        logger.warn('Mismatch in fetched block count', {
          requested: heightsToFetch.length,
          received: blocks.length,
        });
      }

      const lastHeight = heightsToFetch[heightsToFetch.length - 1] || currentHeight;

      for (let i = 0; i < heightsToFetch.length; i++) {
        const height = heightsToFetch[i];
        const block = blocks[i];

        if (!block) {
          logger.warn('Missing block from batch fetch, refetching individually', { height });
          await this.blockIndexer.indexBlock(height);
        } else {
          await this.blockIndexer.indexBlockData(block, height);
        }

        this.blocksIndexed++;

        if (height % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const processed = height - currentHeight;
          const blocksPerSecond = processed > 0 && elapsed > 0 ? processed / elapsed : 0;
          const remaining = chainHeight - height;
          const eta = blocksPerSecond > 0 ? remaining / blocksPerSecond : Infinity;

          logger.info(`Progress: ${height}/${chainHeight}`, {
            blocksPerSecond: blocksPerSecond.toFixed(2),
            eta: Number.isFinite(eta) ? `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s` : 'unknown',
          });

          // Verify supply accuracy every 10000 blocks
          if (height % 10000 === 0) {
            await this.verifySupplyAccuracy(height);
          }

          await this.optimizer.autoOptimize(height, chainHeight);
          this.blockIndexer.setSkipAddressSummary(this.optimizer.isFastSyncEnabled());
        }
      }

      // Check for reorgs
      if (lastHeight > 0) {
        await this.checkForReorg(lastHeight);
      }

      const syncTime = Date.now() - startTime;
      logger.info(`Batch sync complete`, {
        blocksIndexed: batchSize,
        timeMs: syncTime,
        blocksPerSecond: (batchSize / (syncTime / 1000)).toFixed(2),
      });

      await this.blockIndexer.setSyncingStatus(false, chainHeight);

      // Update metrics
      this.lastSyncTime = Date.now();
      this.blockIndexer.setSkipAddressSummary(this.optimizer.isFastSyncEnabled());

      // If still far behind, immediately continue syncing (don't wait for polling interval)
      const stillBehind = chainHeight - lastHeight > safetyBuffer;
      if (stillBehind) {
        this.syncInProgress = false; // Allow next sync
        setImmediate(() => this.sync().catch(err => logger.warn('Continuous sync error', { error: err.message })));
      }

    } catch (error: any) {
      logger.error('Sync error', { error: error.message, stack: error.stack });
      await this.blockIndexer.setSyncingStatus(false);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Check for blockchain reorganization
   */
  private async checkForReorg(currentHeight: number): Promise<void> {
    try {
      // Get last indexed block hash from database
      const syncState = await this.blockIndexer.getSyncState();
      const dbHash = syncState.lastBlockHash;

      if (!dbHash) return;

      // Get current block hash from RPC
      const rpcHash = await this.rpc.getBlockHash(currentHeight);

      // If hashes match, no reorg
      if (dbHash === rpcHash) {
        return;
      }

      logger.warn('Reorg detected!', {
        height: currentHeight,
        dbHash,
        rpcHash,
      });

      // Find common ancestor
      let commonAncestor = currentHeight - 1;
      let foundCommonAncestor = false;
      for (let i = 1; i <= this.config.maxReorgDepth; i++) {
        const height = currentHeight - i;
        if (height < 0) break;

        const result = await this.db.query(
          'SELECT hash FROM blocks WHERE height = $1',
          [height]
        );

        if (result.rows.length === 0) {
          break;
        }

        const dbBlockHash = result.rows[0].hash;
        const rpcBlockHash = await this.rpc.getBlockHash(height);

        if (dbBlockHash === rpcBlockHash) {
          commonAncestor = height;
          foundCommonAncestor = true;
          break;
        }
      }

      if (!foundCommonAncestor) {
        throw new SyncError('Failed to find common ancestor within max reorg depth', {
          currentHeight,
          maxDepth: this.config.maxReorgDepth,
        });
      }

      logger.info('Reorg common ancestor found', {
        commonAncestor,
        blocksToRollback: currentHeight - commonAncestor,
      });

      // Rollback to common ancestor
      await this.handleReorg(commonAncestor, currentHeight, dbHash, rpcHash);

    } catch (error: any) {
      logger.error('Reorg check failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle blockchain reorganization
   */
  private async handleReorg(
    commonAncestor: number,
    currentHeight: number,
    oldHash: string,
    newHash: string
  ): Promise<void> {
    logger.info('Handling reorg', {
      from: currentHeight,
      to: commonAncestor,
      blocksAffected: currentHeight - commonAncestor,
    });

    await this.db.transaction(async (client) => {
      const affectedAddressRows = await client.query(
        `SELECT DISTINCT address FROM utxos
         WHERE block_height > $1 OR spent_block_height > $1`,
        [commonAncestor]
      );

      const affectedAddresses = new Set<string>();
      for (const row of affectedAddressRows.rows) {
        if (row.address) {
          affectedAddresses.add(row.address);
        }
      }

      // Log reorg event
      await client.query(
        `INSERT INTO reorgs (from_height, to_height, common_ancestor, old_hash, new_hash, blocks_affected)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [currentHeight, commonAncestor, commonAncestor, oldHash, newHash, currentHeight - commonAncestor]
      );

      // Unspend UTXOs that were spent in rolled-back blocks
      await client.query(
        `UPDATE utxos
         SET spent = false,
             spent_txid = NULL,
             spent_block_height = NULL,
             spent_at = NULL
         WHERE spent_block_height > $1`,
        [commonAncestor]
      );

      // Delete UTXOs from rolled-back blocks
      await client.query(
        'DELETE FROM utxos WHERE block_height > $1',
        [commonAncestor]
      );

      // Delete transactions from rolled-back blocks
      await client.query(
        'DELETE FROM transactions WHERE block_height > $1',
        [commonAncestor]
      );

      // Delete rolled-back blocks
      await client.query(
        'DELETE FROM blocks WHERE height > $1',
        [commonAncestor]
      );

      // Update sync state
      const lastValidBlock = await client.query(
        'SELECT hash FROM blocks WHERE height = $1',
        [commonAncestor]
      );

      if (lastValidBlock.rows.length > 0) {
        await client.query(
          `UPDATE sync_state
           SET current_height = $1,
               last_block_hash = $2,
               last_sync_time = NOW()
           WHERE id = 1`,
          [commonAncestor, lastValidBlock.rows[0].hash]
        );
      } else {
        await client.query(
          `UPDATE sync_state
           SET current_height = $1,
               last_block_hash = NULL,
               last_sync_time = NOW()
           WHERE id = 1`,
          [commonAncestor]
        );
      }

      // Recalculate address summaries for affected addresses
      for (const address of affectedAddresses) {
        await client.query('SELECT update_address_summary($1)', [address]);
      }
    });

    logger.info('Reorg handled successfully', {
      rolledBackTo: commonAncestor,
    });
  }

  /**
   * Get sync statistics
   */
  getSyncStats() {
    return {
      isRunning: this.isRunning,
      blocksIndexed: this.blocksIndexed,
      lastSyncTime: new Date(this.lastSyncTime),
      uptimeSeconds: (Date.now() - this.lastSyncTime) / 1000,
    };
  }

  /**
   * Force sync now (bypasses interval)
   */
  async syncNow(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Sync engine not running');
    }
    await this.sync();
  }

  /**
   * Verify supply accuracy against daemon at specific height
   * Compares both transparent and shielded pool values
   */
  private async verifySupplyAccuracy(height: number): Promise<void> {
    try {
      // Get daemon's blockchain info at current height
      const chainInfo = await this.rpc.getBlockchainInfo();

      // Only verify if daemon is at or past this height
      if (chainInfo.blocks < height) {
        logger.debug('Skipping supply verification - daemon not at height yet', {
          daemonHeight: chainInfo.blocks,
          verifyHeight: height
        });
        return;
      }

      // Get indexer's calculated transparent supply
      const result = await this.db.getPool().query(`
        SELECT
          SUM(value)::numeric / 100000000 as transparent_supply,
          COUNT(*) as utxo_count
        FROM utxos
        WHERE spent = false AND block_height <= $1
      `, [height]);

      const indexerTransparent = parseFloat(result.rows[0]?.transparent_supply || '0');
      const utxoCount = parseInt(result.rows[0]?.utxo_count || '0');

      // Get daemon's value pools
      const valuePools = chainInfo.valuePools || [];
      const daemonTransparent = valuePools.find((p: any) => p.id === 'transparent')?.chainValue || 0;
      const daemonSapling = valuePools.find((p: any) => p.id === 'sapling')?.chainValue || 0;
      const daemonSprout = valuePools.find((p: any) => p.id === 'sprout')?.chainValue || 0;
      const daemonShielded = daemonSapling + daemonSprout;

      // Calculate discrepancy
      const transparentDiff = indexerTransparent - daemonTransparent;
      const transparentDiffPercent = daemonTransparent > 0
        ? (Math.abs(transparentDiff) / daemonTransparent * 100).toFixed(4)
        : '0';

      // Get shielded supply from supply_stats table (if exists)
      const shieldedResult = await this.db.getPool().query(`
        SELECT sapling_pool + sprout_pool as shielded_supply
        FROM supply_stats
        WHERE block_height = (
          SELECT MAX(block_height) FROM supply_stats WHERE block_height <= $1
        )
      `, [height]).catch(() => ({ rows: [{ shielded_supply: null }] }));

      const indexerShielded = parseFloat(shieldedResult.rows[0]?.shielded_supply || '0');
      const shieldedDiff = indexerShielded - daemonShielded;

      // Log comparison
      const logLevel = Math.abs(transparentDiff) > 1.0 ? 'warn' : 'info';

      logger[logLevel](`Supply verification at height ${height}`, {
        transparent: {
          indexer: indexerTransparent.toFixed(8),
          daemon: daemonTransparent.toFixed(8),
          difference: transparentDiff.toFixed(8),
          diffPercent: `${transparentDiffPercent}%`,
          utxoCount: utxoCount
        },
        shielded: {
          indexer: indexerShielded.toFixed(8),
          daemon: daemonShielded.toFixed(8),
          difference: shieldedDiff.toFixed(8),
          sapling: daemonSapling.toFixed(8),
          sprout: daemonSprout.toFixed(8)
        },
        total: {
          indexer: (indexerTransparent + indexerShielded).toFixed(8),
          daemon: (daemonTransparent + daemonShielded).toFixed(8)
        }
      });

      // Alert if significant discrepancy (>1 FLUX)
      if (Math.abs(transparentDiff) > 1.0) {
        logger.error('⚠️  SUPPLY DISCREPANCY DETECTED', {
          height,
          transparentDiff: transparentDiff.toFixed(8),
          percentOff: `${transparentDiffPercent}%`,
          message: 'Indexer transparent supply does not match daemon!'
        });
      }

    } catch (error: any) {
      logger.warn('Failed to verify supply accuracy', {
        height,
        error: error.message
      });
    }
  }
}
