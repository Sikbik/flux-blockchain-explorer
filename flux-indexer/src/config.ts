/**
 * Configuration
 *
 * Loads and validates configuration from environment variables
 */

import dotenv from 'dotenv';
import { IndexerConfig } from './types';

// Load environment variables
dotenv.config();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const num = parseInt(value);
  if (isNaN(num)) {
    throw new Error(`Invalid number for environment variable ${key}: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

export const config: IndexerConfig = {
  rpc: {
    url: getEnv('FLUX_RPC_URL', 'http://localhost:16124'),
    username: process.env.FLUX_RPC_USER,
    password: process.env.FLUX_RPC_PASSWORD,
    timeout: getEnvNumber('FLUX_RPC_TIMEOUT', 30000),
  },
  database: {
    host: getEnv('DB_HOST', 'localhost'),
    port: getEnvNumber('DB_PORT', 5432),
    database: getEnv('DB_NAME', 'fluxindexer'),
    user: getEnv('DB_USER', 'flux'),
    password: getEnv('DB_PASSWORD', ''),
    max: getEnvNumber('DB_POOL_MAX', 100), // Increased to 100 to handle high concurrent load (1000+ users)
    idleTimeoutMillis: getEnvNumber('DB_IDLE_TIMEOUT', 30000),
    connectionTimeoutMillis: getEnvNumber('DB_CONNECTION_TIMEOUT', 30000), // Increased to 30s to handle temporary load spikes
  },
  indexer: {
    batchSize: getEnvNumber('INDEXER_BATCH_SIZE', 100),
    pollingInterval: getEnvNumber('INDEXER_POLLING_INTERVAL', 5000), // 5 seconds
    startHeight: process.env.INDEXER_START_HEIGHT
      ? parseInt(process.env.INDEXER_START_HEIGHT)
      : undefined,
    enableReorgHandling: getEnvBoolean('INDEXER_ENABLE_REORG', true),
    maxReorgDepth: getEnvNumber('INDEXER_MAX_REORG_DEPTH', 100),
  },
  api: {
    port: getEnvNumber('API_PORT', 3002),
    host: getEnv('API_HOST', '0.0.0.0'),
    corsEnabled: getEnvBoolean('API_CORS_ENABLED', true),
  },
};
