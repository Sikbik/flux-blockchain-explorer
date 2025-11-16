/**
 * Database Performance Optimizer
 *
 * Automatically optimizes PostgreSQL performance during bulk indexing operations.
 * Intelligently switches between "fast sync mode" (bulk loading) and "normal mode" (real-time indexing).
 *
 * Smart Optimization Strategy:
 * - Detects when indexer is far behind chain tip (> 10,000 blocks)
 * - Automatically enables fast sync mode for bulk loading
 * - Automatically disables when caught up (< 1,000 blocks behind)
 * - No manual intervention required!
 *
 * Based on best practices for PostgreSQL bulk data loading.
 */

import { DatabaseConnection } from './connection';
import { logger } from '../utils/logger';

export interface IndexInfo {
  tablename: string;
  indexname: string;
  indexdef: string;
}

export class DatabaseOptimizer {
  private droppedIndexes: IndexInfo[] = [];
  private unloggedTables: string[] = [];
  private isOptimized: boolean = false;
  private summariesDirty: boolean = false;
  private conversionInProgress: boolean = false;

  // Thresholds for automatic optimization
  // Wide hysteresis gap (50k enable, 1k disable) prevents infinite conversion loops
  // Conversion takes ~30 min during which ~60 new blocks are mined
  // Starting at <1k blocks behind ensures we stay well below 50k after conversion
  private readonly BULK_SYNC_THRESHOLD = 50000; // Enable fast mode if > 50k blocks behind
  private readonly NORMAL_SYNC_THRESHOLD = 1000; // Disable fast mode if < 1k blocks behind
  private readonly PRESERVED_INDEXES = new Set<string>([
    'idx_utxo_address_unspent',
    'idx_utxo_address_spent',
    'idx_utxo_spent_txid',
  ]);

  constructor(private db: DatabaseConnection) {}

  /**
   * Enable fast sync mode - optimizes database for bulk loading
   *
   * This mode:
   * - Drops non-essential indexes (keeps primary keys)
   * - Converts tables to UNLOGGED (2-3x faster writes, but not crash-safe)
   * - Disables autovacuum
   * - Increases batch sizes
   */
  async enableFastSyncMode(): Promise<void> {
    if (this.isOptimized) {
      logger.debug('Fast Sync Mode already enabled; skipping enableFastSyncMode');
      return;
    }

    logger.info('🚀 Enabling Fast Sync Mode...');

    try {
      // Step 1: Drop non-primary key indexes
      await this.dropNonPrimaryIndexes();

      // Step 2: Convert tables to UNLOGGED
      await this.convertTablesToUnlogged();

      // Step 3: Disable autovacuum on main tables
      await this.disableAutovacuum();

      logger.info('✅ Fast Sync Mode enabled - indexing performance significantly improved');
      logger.warn('⚠️  WARNING: Database is in UNLOGGED mode - not crash-safe! Run disableFastSyncMode() when done.');
      this.isOptimized = true;
      this.summariesDirty = true;
    } catch (error) {
      logger.error('Failed to enable Fast Sync Mode', { error });
      throw error;
    }
  }

  /**
   * Disable fast sync mode - restores database to normal operation
   *
   * This mode:
   * - Rebuilds all dropped indexes
   * - Converts tables back to LOGGED
   * - Re-enables autovacuum
   * - Runs VACUUM ANALYZE
   */
  async disableFastSyncMode(): Promise<void> {
    if (!this.isOptimized && this.droppedIndexes.length === 0) {
      logger.debug('Fast Sync Mode not active; skipping disableFastSyncMode');
      return;
    }

    // Prevent concurrent conversion attempts
    if (this.conversionInProgress) {
      logger.debug('Conversion already in progress; skipping duplicate disableFastSyncMode call');
      return;
    }

    this.conversionInProgress = true;
    logger.info('🔄 Disabling Fast Sync Mode and restoring normal operation...');

    try {
      // Step 1: Convert tables back to LOGGED
      await this.convertTablesToLogged();

      // Step 1b: Rebuild address summaries if they were skipped during fast sync
      if (this.summariesDirty) {
        await this.rebuildAddressSummary();
        this.summariesDirty = false;
      }

      // Step 2: Rebuild indexes
      await this.rebuildDroppedIndexes();

      // Step 3: Re-enable autovacuum
      await this.enableAutovacuum();

      // Step 4: Run VACUUM ANALYZE to update statistics
      await this.vacuumAnalyze();

      logger.info('✅ Fast Sync Mode disabled - database restored to normal operation');
      this.isOptimized = false;
      this.conversionInProgress = false;
    } catch (error) {
      logger.error('Failed to disable Fast Sync Mode', { error });
      this.conversionInProgress = false; // Reset flag even on error
      throw error;
    }
  }

  /**
   * Drop all non-primary key indexes
   * Keeps primary keys and unique constraints for data integrity
   */
  private async dropNonPrimaryIndexes(): Promise<void> {
    logger.info('Dropping non-primary key indexes...');

    // Get all indexes except primary keys and unique constraints
    const result = await this.db.query(`
      SELECT
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
        AND indexdef NOT LIKE '%UNIQUE%'
      ORDER BY tablename, indexname
    `);

    const allIndexes = result.rows as IndexInfo[];
    const droppable = allIndexes.filter(index => !this.PRESERVED_INDEXES.has(index.indexname));
    const preserved = allIndexes.length - droppable.length;

    this.droppedIndexes = droppable;

    for (const index of droppable) {
      logger.debug(`Dropping index: ${index.indexname}`);
      await this.db.query(`DROP INDEX IF EXISTS ${index.indexname}`);
    }

    if (preserved > 0) {
      logger.info(`🔒 Preserved ${preserved} critical indexes needed during fast sync`);
    }

    logger.info(`✅ Dropped ${this.droppedIndexes.length} indexes`);
  }

  /**
   * Rebuild all previously dropped indexes
   */
  private async rebuildDroppedIndexes(): Promise<void> {
    logger.info(`Rebuilding ${this.droppedIndexes.length} indexes...`);

    for (const index of this.droppedIndexes) {
      logger.debug(`Creating index: ${index.indexname}`);

      // Use CREATE INDEX CONCURRENTLY to allow reads during index creation
      // Replace CREATE INDEX with CREATE INDEX CONCURRENTLY
      const concurrentIndexDef = index.indexdef.replace(
        'CREATE INDEX',
        'CREATE INDEX CONCURRENTLY'
      );

      try {
        await this.db.query(concurrentIndexDef);
      } catch (error) {
        logger.warn(`Failed to create index ${index.indexname} concurrently, trying without CONCURRENTLY`, { error });
        // Fallback to non-concurrent if concurrent fails
        await this.db.query(index.indexdef);
      }
    }

    // Ensure critical performance indexes are created
    await this.ensurePerformanceIndexes();

    logger.info('✅ All indexes rebuilt');
    this.droppedIndexes = [];
  }

  /**
   * Ensure critical performance indexes exist
   * These indexes are required for good query performance in production
   */
  private async ensurePerformanceIndexes(): Promise<void> {
    logger.info('Ensuring critical performance indexes exist...');

    const performanceIndexes = [
      {
        name: 'idx_transactions_block_height',
        table: 'transactions',
        definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_block_height ON transactions(block_height)',
      },
      {
        name: 'idx_fluxnode_transactions_block_height',
        table: 'fluxnode_transactions',
        definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fluxnode_transactions_block_height ON fluxnode_transactions(block_height)',
      },
      {
        name: 'idx_address_summary_balance',
        table: 'address_summary',
        definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_address_summary_balance ON address_summary(balance DESC)',
      },
      {
        name: 'idx_address_transactions_address_height_txid',
        table: 'address_transactions',
        definition: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_address_transactions_address_height_txid ON address_transactions(address, block_height DESC, txid DESC)',
      },
    ];

    for (const index of performanceIndexes) {
      try {
        // Check if index already exists
        const checkResult = await this.db.query(`
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = '${index.table}'
            AND indexname = '${index.name}'
        `);

        if (checkResult.rows.length === 0) {
          logger.info(`Creating performance index: ${index.name}...`);
          await this.db.query(index.definition);
          logger.info(`✅ Created index: ${index.name}`);
        } else {
          logger.debug(`Index ${index.name} already exists`);
        }
      } catch (error) {
        logger.warn(`Failed to create performance index ${index.name}`, { error });
      }
    }
  }

  /**
   * Convert tables to UNLOGGED for faster writes
   * UNLOGGED tables skip WAL (Write-Ahead Log) which is 2-3x faster
   * WARNING: UNLOGGED tables are not crash-safe and will be truncated on crash
   */
  private async convertTablesToUnlogged(): Promise<void> {
    // PostgreSQL requires: tables WITH foreign keys must be UNLOGGED before tables they reference
    // FK constraints: transactions.block_height → blocks.height, fluxnode_transactions.block_height → blocks.height
    // So transactions and fluxnode_transactions must be converted BEFORE blocks
    const tables = [
      'transactions',            // Has FK to blocks - convert first
      'fluxnode_transactions',   // Has FK to blocks - convert first
      'blocks',                  // Referenced by above FKs - convert after
      'utxos',                   // No FK constraints
      'address_summary',         // No FK constraints
      'producers',               // No FK constraints
      'address_transactions',    // No FK constraints
      'transaction_participants',// No FK constraints
      'supply_stats'             // No FK constraints (removed for Fast Sync compatibility)
    ];

    logger.info('Converting tables to UNLOGGED...');

    for (const table of tables) {
      logger.debug(`Converting ${table} to UNLOGGED`);
      await this.db.query(`ALTER TABLE ${table} SET UNLOGGED`);
      this.unloggedTables.push(table);
    }

    logger.info(`✅ Converted ${tables.length} tables to UNLOGGED`);
  }

  /**
   * Convert tables back to LOGGED for crash safety
   * Must be done in reverse order (parents first) to avoid foreign key constraint errors
   */
  private async convertTablesToLogged(): Promise<void> {
    logger.info('Converting tables back to LOGGED...');

    // Convert in reverse order: parents first (blocks), then children (transactions, utxos)
    // This avoids: "could not change table X to logged because it references unlogged table Y"
    const reversedTables = [...this.unloggedTables].reverse();

    for (const table of reversedTables) {
      logger.debug(`Converting ${table} to LOGGED`);
      await this.db.query(`ALTER TABLE ${table} SET LOGGED`);
    }

    logger.info(`✅ Converted ${this.unloggedTables.length} tables to LOGGED`);
    this.unloggedTables = [];
  }

  /**
   * Disable autovacuum on main tables during bulk load
   */
  private async disableAutovacuum(): Promise<void> {
    const tables = ['blocks', 'transactions', 'utxos', 'address_summary', 'producers'];

    logger.info('Disabling autovacuum...');

    for (const table of tables) {
      await this.db.query(`ALTER TABLE ${table} SET (autovacuum_enabled = false)`);
    }

    logger.info('✅ Autovacuum disabled');
  }

  /**
   * Re-enable autovacuum
   */
  private async enableAutovacuum(): Promise<void> {
    const tables = ['blocks', 'transactions', 'utxos', 'address_summary', 'producers'];

    logger.info('Re-enabling autovacuum...');

    for (const table of tables) {
      await this.db.query(`ALTER TABLE ${table} SET (autovacuum_enabled = true)`);
    }

    logger.info('✅ Autovacuum re-enabled');
  }

  /**
   * Run VACUUM ANALYZE to update table statistics and reclaim space
   */
  private async vacuumAnalyze(): Promise<void> {
    const tables = ['blocks', 'transactions', 'utxos', 'address_summary', 'producers'];

    logger.info('Running VACUUM ANALYZE...');

    for (const table of tables) {
      logger.debug(`VACUUM ANALYZE ${table}`);
      await this.db.query(`VACUUM ANALYZE ${table}`);
    }

    logger.info('✅ VACUUM ANALYZE complete');
  }

  /**
   * Automatically optimize based on sync status
   *
   * Call this periodically (e.g., every 100 blocks) to let the optimizer
   * automatically enable/disable fast sync mode based on how far behind the indexer is.
   *
   * @param currentHeight Current indexed block height
   * @param chainHeight Current chain tip height
   */
  async autoOptimize(currentHeight: number, chainHeight: number): Promise<void> {
    const blocksBehind = chainHeight - currentHeight;

    // Enable fast sync mode if we're far behind
    if (!this.isOptimized && blocksBehind > this.BULK_SYNC_THRESHOLD) {
      logger.info(`📊 Indexer is ${blocksBehind.toLocaleString()} blocks behind - enabling Fast Sync Mode`);
      await this.enableFastSyncMode();
      this.isOptimized = true;
    }

    // Disable fast sync mode if we've caught up
    if (this.isOptimized && blocksBehind < this.NORMAL_SYNC_THRESHOLD) {
      logger.info(`🎯 Indexer is only ${blocksBehind.toLocaleString()} blocks behind - disabling Fast Sync Mode`);
      await this.disableFastSyncMode();
      this.isOptimized = false;
    }
  }

  /**
   * Get current optimization status
   */
  async getStatus(): Promise<{
    fastSyncMode: boolean;
    isOptimized: boolean;
    droppedIndexes: number;
    unloggedTables: number;
  }> {
    // Check if any tables are unlogged
    const result = await this.db.query(`
      SELECT tablename, relpersistence
      FROM pg_tables
      JOIN pg_class ON pg_tables.tablename = pg_class.relname
      WHERE schemaname = 'public'
        AND tablename IN ('blocks', 'transactions', 'utxos', 'address_summary', 'producers')
        AND relpersistence = 'u'
    `);

    const fastSyncMode = result.rows.length > 0;

    return {
      fastSyncMode,
      isOptimized: this.isOptimized,
      droppedIndexes: this.droppedIndexes.length,
      unloggedTables: result.rows.length,
    };
  }

  isFastSyncEnabled(): boolean {
    return this.isOptimized;
  }

  /**
   * Public method to ensure performance indexes exist on startup
   * This should be called after initialization to ensure all critical indexes are present
   */
  async ensureIndexes(): Promise<void> {
    await this.ensurePerformanceIndexes();
  }

  private async rebuildAddressSummary(): Promise<void> {
    logger.info('Rebuilding address_summary table from UTXO data...');

    await this.db.query('TRUNCATE address_summary');

    await this.db.query(`
      INSERT INTO address_summary (
        address,
        balance,
        tx_count,
        received_total,
        sent_total,
        unspent_count,
        first_seen,
        last_activity,
        updated_at
      )
      SELECT
        address,
        SUM(CASE WHEN spent = false THEN value ELSE 0 END) AS balance,
        COUNT(DISTINCT txid) AS tx_count,
        SUM(value) AS received_total,
        SUM(CASE WHEN spent THEN value ELSE 0 END) AS sent_total,
        SUM(CASE WHEN spent = false THEN 1 ELSE 0 END) AS unspent_count,
        MIN(block_height) AS first_seen,
        MAX(GREATEST(block_height, COALESCE(spent_block_height, 0))) AS last_activity,
        NOW() AS updated_at
      FROM utxos
      GROUP BY address
    `);

    logger.info('✅ address_summary rebuild complete');
  }
}
