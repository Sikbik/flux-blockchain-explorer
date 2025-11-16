/**
 * API Error Handling Utilities
 *
 * Provides utilities for handling and formatting API errors
 * in a user-friendly way.
 */

import { FluxAPIError } from "./client";

/**
 * Error types for better error handling
 */
export enum ErrorType {
  NETWORK_ERROR = "NETWORK_ERROR",
  NOT_FOUND = "NOT_FOUND",
  INVALID_REQUEST = "INVALID_REQUEST",
  SERVER_ERROR = "SERVER_ERROR",
  TIMEOUT = "TIMEOUT",
  UNKNOWN = "UNKNOWN",
}

/**
 * Structured error response
 */
export interface ErrorResponse {
  type: ErrorType;
  message: string;
  statusCode?: number;
  canRetry: boolean;
}

/**
 * Determine error type from error object
 */
function getErrorType(error: unknown): ErrorType {
  if (error instanceof FluxAPIError) {
    const statusCode = error.statusCode;

    if (!statusCode) {
      return ErrorType.NETWORK_ERROR;
    }

    if (statusCode === 404) {
      return ErrorType.NOT_FOUND;
    }

    if (statusCode >= 400 && statusCode < 500) {
      return ErrorType.INVALID_REQUEST;
    }

    if (statusCode >= 500) {
      return ErrorType.SERVER_ERROR;
    }
  }

  if (error instanceof Error) {
    if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
      return ErrorType.TIMEOUT;
    }

    if (
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("ECONNREFUSED")
    ) {
      return ErrorType.NETWORK_ERROR;
    }
  }

  return ErrorType.UNKNOWN;
}

/**
 * Get user-friendly error message
 */
function getUserMessage(type: ErrorType, originalMessage?: string): string {
  switch (type) {
    case ErrorType.NETWORK_ERROR:
      return "Unable to connect to the server. Please check your internet connection.";

    case ErrorType.NOT_FOUND:
      return "The requested resource was not found.";

    case ErrorType.INVALID_REQUEST:
      return "Invalid request. Please check your input and try again.";

    case ErrorType.SERVER_ERROR:
      return "Server error. Please try again later.";

    case ErrorType.TIMEOUT:
      return "Request timed out. Please try again.";

    case ErrorType.UNKNOWN:
    default:
      return originalMessage || "An unexpected error occurred. Please try again.";
  }
}

/**
 * Check if error is retryable
 */
function canRetry(type: ErrorType): boolean {
  return [
    ErrorType.NETWORK_ERROR,
    ErrorType.SERVER_ERROR,
    ErrorType.TIMEOUT,
  ].includes(type);
}

/**
 * Parse error into structured format
 *
 * @param error - Error object from API or network
 * @returns Structured error response
 *
 * @example
 * ```tsx
 * const { error } = useBlock(hash);
 *
 * if (error) {
 *   const errorResponse = parseError(error);
 *   console.log(errorResponse.message);
 *
 *   if (errorResponse.canRetry) {
 *     // Show retry button
 *   }
 * }
 * ```
 */
export function parseError(error: unknown): ErrorResponse {
  const type = getErrorType(error);
  const message = getUserMessage(
    type,
    error instanceof Error ? error.message : undefined
  );

  const statusCode =
    error instanceof FluxAPIError ? error.statusCode : undefined;

  return {
    type,
    message,
    statusCode,
    canRetry: canRetry(type),
  };
}

/**
 * Format error for display
 *
 * @param error - Error object
 * @param context - Additional context (e.g., "block", "transaction")
 * @returns Formatted error message
 *
 * @example
 * ```tsx
 * const { error } = useTransaction(txid);
 *
 * if (error) {
 *   const message = formatError(error, 'transaction');
 *   toast.error(message);
 * }
 * ```
 */
export function formatError(error: unknown, context?: string): string {
  const errorResponse = parseError(error);

  if (context) {
    return `Failed to load ${context}: ${errorResponse.message}`;
  }

  return errorResponse.message;
}

/**
 * Check if error is a specific type
 */
export function isErrorType(error: unknown, type: ErrorType): boolean {
  return getErrorType(error) === type;
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  return isErrorType(error, ErrorType.NETWORK_ERROR);
}

/**
 * Check if error is a not found error
 */
export function isNotFoundError(error: unknown): boolean {
  return isErrorType(error, ErrorType.NOT_FOUND);
}
