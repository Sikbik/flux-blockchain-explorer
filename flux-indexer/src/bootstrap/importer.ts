/**
 * PostgreSQL Bootstrap Importer
 *
 * Handles automatic download and import of database bootstrap files
 * Runs once on first startup if POSTGRES_BOOTSTRAP_URL is set
 */

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

export class BootstrapImporter {
  private pool: Pool;
  private bootstrapUrl: string;
  private bootstrapMarkerFile = '/tmp/.bootstrap_imported';

  constructor(pool: Pool, bootstrapUrl?: string) {
    this.pool = pool;
    this.bootstrapUrl = bootstrapUrl || process.env.POSTGRES_BOOTSTRAP_URL || '';
  }

  /**
   * Check if bootstrap import is needed and execute if required
   */
  async checkAndImport(): Promise<boolean> {
    // No bootstrap URL configured
    if (!this.bootstrapUrl) {
      logger.info('No POSTGRES_BOOTSTRAP_URL configured, skipping bootstrap');
      return false;
    }

    // Check if already imported
    if (fs.existsSync(this.bootstrapMarkerFile)) {
      logger.info('Bootstrap already imported (marker file exists)');
      return false;
    }

    // Check if database already has data
    const hasData = await this.checkDatabaseHasData();
    if (hasData) {
      logger.info('Database already contains data, skipping bootstrap');
      // Create marker to avoid checking again
      fs.writeFileSync(this.bootstrapMarkerFile, 'imported');
      return false;
    }

    // Import bootstrap
    logger.info('Starting bootstrap import process...');
    await this.importBootstrap();

    // Create marker file
    fs.writeFileSync(this.bootstrapMarkerFile, 'imported');
    logger.info('Bootstrap import completed successfully');

    return true;
  }

  /**
   * Check if database has any blocks
   */
  private async checkDatabaseHasData(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT COUNT(*) as count FROM blocks LIMIT 1');
      const count = parseInt(result.rows[0]?.count || '0');
      return count > 0;
    } catch (error) {
      // Table doesn't exist yet
      return false;
    }
  }

  /**
   * Download and import bootstrap file
   */
  private async importBootstrap(): Promise<void> {
    const tempFile = '/tmp/bootstrap.dump.gz';
    const extractedFile = '/tmp/bootstrap.dump';

    try {
      logger.info('========================================');
      logger.info('PostgreSQL Bootstrap Import');
      logger.info('========================================');
      logger.info(`Bootstrap URL: ${this.bootstrapUrl}`);

      // Download bootstrap
      logger.info('Downloading bootstrap file...');
      await this.downloadFile(this.bootstrapUrl, tempFile);
      const stats = fs.statSync(tempFile);
      logger.info(`Download complete. File size: ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`);

      // Decompress if needed
      if (tempFile.endsWith('.gz')) {
        logger.info('Decompressing bootstrap file...');
        await execAsync(`gunzip -c ${tempFile} > ${extractedFile}`);
        const extractedStats = fs.statSync(extractedFile);
        logger.info(`Decompression complete. File size: ${(extractedStats.size / 1024 / 1024 / 1024).toFixed(2)} GB`);
        fs.unlinkSync(tempFile); // Remove compressed file
      }

      // Import into database
      logger.info('Importing bootstrap into database...');
      logger.info('This may take 10-20 minutes...');

      const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'fluxindexer',
        user: process.env.DB_USER || 'fluxindexer',
        password: process.env.DB_PASSWORD || 'password',
      };

      const pgRestoreCmd = `PGPASSWORD="${dbConfig.password}" pg_restore -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -v --clean --if-exists ${extractedFile}`;

      await execAsync(pgRestoreCmd);

      logger.info('Bootstrap import completed!');

      // Clean up
      if (fs.existsSync(extractedFile)) {
        fs.unlinkSync(extractedFile);
      }
      logger.info('Cleaned up temporary files');

      logger.info('========================================');
      logger.info('Bootstrap Import Successful');
      logger.info('========================================');

    } catch (error: any) {
      logger.error('Bootstrap import failed', { error: error.message });

      // Clean up on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (fs.existsSync(extractedFile)) {
        fs.unlinkSync(extractedFile);
      }

      throw error;
    }
  }

  /**
   * Download file from URL
   */
  private downloadFile(url: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destination);
      const client = url.startsWith('https') ? https : http;

      client.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(destination);
            this.downloadFile(redirectUrl, destination).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlinkSync(destination);
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlinkSync(destination);
        reject(err);
      });
    });
  }
}
