/**
 * Logger Utility
 *
 * Winston-based logging with console and file output
 */

import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

// Add file transport if LOG_FILE is specified
if (process.env.LOG_FILE) {
  logger.add(
    new winston.transports.File({
      filename: process.env.LOG_FILE,
      format: logFormat,
    })
  );
}

// Add error-only log file for monitoring critical issues during sync
logger.add(
  new winston.transports.File({
    filename: process.env.ERROR_LOG_FILE || '/var/log/indexer-errors.log',
    level: 'error',
    format: logFormat,
  })
);

// Add warning-level log file to catch all parsing warnings and errors
logger.add(
  new winston.transports.File({
    filename: process.env.WARN_LOG_FILE || '/var/log/indexer-warnings.log',
    level: 'warn',
    format: logFormat,
  })
);
