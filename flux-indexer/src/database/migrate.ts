/**
 * Database Migration Script
 *
 * Sets up the PostgreSQL database schema for FluxIndexer
 */

import fs from 'fs';
import path from 'path';
import { DatabaseConnection } from './connection';
import { logger } from '../utils/logger';

const BASE_SCHEMA_MIGRATION = 'base_schema';
const SCHEMA_LOCK_KEY = { key1: 0x1234abcd, key2: 0x00fedcba }; // advisory lock keys

async function applyBaseSchema(db: DatabaseConnection, schema: string): Promise<void> {
  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      SCHEMA_LOCK_KEY.key1,
      SCHEMA_LOCK_KEY.key2,
    ]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const forceReset = process.env.DB_RESET === 'true';

    if (!forceReset) {
      const result = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
        [BASE_SCHEMA_MIGRATION]
      );

      if (result.rowCount && result.rowCount > 0) {
        logger.info('Database schema already applied; skipping base migration');
        return;
      }
    } else {
      logger.warn('DB_RESET=true detected - rebuilding schema');
    }

    await client.query(schema);

    await client.query(
      `INSERT INTO schema_migrations (name, applied_at)
       VALUES ($1, NOW())
       ON CONFLICT (name) DO UPDATE SET applied_at = EXCLUDED.applied_at`,
      [BASE_SCHEMA_MIGRATION]
    );
  });
}

async function applyMigration(db: DatabaseConnection, name: string, sql: string): Promise<void> {
  await db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      SCHEMA_LOCK_KEY.key1,
      SCHEMA_LOCK_KEY.key2,
    ]);

    const result = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
      [name]
    );

    if (result.rowCount && result.rowCount > 0) {
      logger.debug(`Migration ${name} already applied; skipping`);
      return;
    }

    logger.info(`Applying migration: ${name}`);
    await client.query(sql);

    await client.query(
      `INSERT INTO schema_migrations (name, applied_at)
       VALUES ($1, NOW())`,
      [name]
    );

    logger.info(`Migration ${name} applied successfully`);
  });
}

export async function runMigration(db: DatabaseConnection): Promise<void> {
  logger.info('Starting database migration...');

  try {
    // Apply base schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await applyBaseSchema(db, schema);

    // Apply additional migrations from migrations directory
    const migrationsDir = path.join(__dirname, '../../migrations');

    if (fs.existsSync(migrationsDir)) {
      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Apply in alphabetical order (001_, 002_, etc.)

      for (const file of migrationFiles) {
        const migrationName = file.replace('.sql', '');
        const migrationPath = path.join(migrationsDir, file);
        const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

        await applyMigration(db, migrationName, migrationSql);
      }
    } else {
      logger.debug('No migrations directory found, skipping additional migrations');
    }

    logger.info('Database migration completed successfully');
  } catch (error: any) {
    logger.error('Database migration failed', { error: error.message });
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  const db = new DatabaseConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'fluxindexer',
    user: process.env.DB_USER || 'flux',
    password: process.env.DB_PASSWORD || '',
  });

  db.connect()
    .then(() => runMigration(db))
    .then(() => db.close())
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed', { error: error.message });
      process.exit(1);
    });
}
