/**
 * FluxNode Transaction Parser
 *
 * Parses special FluxNode transactions (version 3, 5, 6) from raw hex
 * These transactions don't follow standard UTXO model and contain FluxNode registration/confirmation data
 */

import { logger } from '../utils/logger';

export interface FluxNodeTransaction {
  version: number;
  type: number; // nType field
  collateralHash?: string;
  collateralIndex?: number;
  ipAddress?: string;
  publicKey?: string;
  signature?: string;
  p2shAddress?: string;
  benchmarkTier?: 'CUMULUS' | 'NIMBUS' | 'STRATUS';
  extraData?: {
    nFluxTxVersion?: number;
    collateralPubkey?: string;
    redeemScript?: string;
    sigTime?: number;
    benchmarkSig?: string;
    usingDelegates?: boolean;
    delegateCount?: number;
    delegateKeys?: string[];
    [key: string]: any;
  };
}

/**
 * Parse a FluxNode transaction from raw hex
 */
export function parseFluxNodeTransaction(hex: string): FluxNodeTransaction | null {
  try {
    const buffer = Buffer.from(hex, 'hex');
    let offset = 0;

    // Read version (4 bytes, little-endian)
    const version = buffer.readUInt32LE(offset);
    offset += 4;

    // Version must be 3, 5, or 6 for FluxNode transactions
    if (version !== 3 && version !== 5 && version !== 6) {
      logger.debug('Ignoring non-FluxNode transaction', { version, hexPreview: hex.slice(0, 20) });
      return null;
    }

    // Read nType (1 byte)
    const type = buffer.readUInt8(offset);
    offset += 1;

    const result: FluxNodeTransaction = {
      version,
      type,
    };

    // Parse based on transaction type
    if (type === 2) {
      // FluxNode Start Transaction (version 5 or 6, type 2)
      return parseFluxNodeStart(buffer, offset, result);
    } else if (type === 4) {
      // FluxNode Confirmation Transaction (version 5 or 6, type 4)
      return parseFluxNodeConfirmation(buffer, offset, result);
    } else if (version === 3) {
      // Legacy FluxNode transaction
      return parseFluxNodeLegacy(buffer, offset, result);
    }

    return result;
  } catch (error: any) {
    logger.error('Failed to parse FluxNode transaction', {
      error: error.message,
      hex: hex.slice(0, 100) + '...',
    });
    return null;
  }
}

/**
 * Parse FluxNode Start transaction (version 6, type 2)
 * Format based on FluxD source code:
 * version(4) | type(1) | nFluxTxVersion(4) | collateralIn(32+4) | collateralPubkey(33) | pubKey(33) | sigTime(4) | sig(variable)
 */
function parseFluxNodeStart(buffer: Buffer, offset: number, result: FluxNodeTransaction): FluxNodeTransaction {
  const extraData: Record<string, any> = {};

  const FLUXNODE_INTERNAL_NORMAL_TX_VERSION = 1;
  const FLUXNODE_INTERNAL_P2SH_TX_VERSION = 2;
  const FLUXNODE_TX_TYPE_NORMAL_BIT = 0x01;
  const FLUXNODE_TX_TYPE_P2SH_BIT = 0x02;
  const FLUXNODE_TX_FEATURE_DELEGATES_BIT = 0x0100;

  let nFluxTxVersion: number | undefined;

  if (result.version === 6) {
    ensureAvailable(buffer, offset, 4, 'nFluxTxVersion');
    nFluxTxVersion = buffer.readUInt32LE(offset);
    offset += 4;
    extraData.nFluxTxVersion = nFluxTxVersion;
  }

  ensureAvailable(buffer, offset, 32 + 4, 'collateral outpoint');
  const collateralHash = buffer.slice(offset, offset + 32).reverse().toString('hex');
  offset += 32;
  result.collateralHash = collateralHash;

  const collateralIndex = buffer.readUInt32LE(offset);
  offset += 4;
  result.collateralIndex = collateralIndex;

  const treatAsP2SH =
    nFluxTxVersion !== undefined &&
    (
      nFluxTxVersion === FLUXNODE_INTERNAL_P2SH_TX_VERSION ||
      (nFluxTxVersion & FLUXNODE_TX_TYPE_P2SH_BIT) !== 0
    );

  const treatAsNormal =
    nFluxTxVersion === undefined ||
    nFluxTxVersion === FLUXNODE_INTERNAL_NORMAL_TX_VERSION ||
    ((nFluxTxVersion & FLUXNODE_TX_TYPE_NORMAL_BIT) !== 0 && (nFluxTxVersion & FLUXNODE_TX_TYPE_P2SH_BIT) === 0);

  if (treatAsP2SH) {
    const publicKey = readVarSliceHex(buffer, offset, 'FluxNode public key (P2SH)');
    result.publicKey = publicKey.value;
    offset = publicKey.offset;

    const redeemScript = readVarSliceHex(buffer, offset, 'FluxNode redeem script');
    extraData.redeemScript = redeemScript.value;
    offset = redeemScript.offset;
  } else if (treatAsNormal) {
    const collateralPubkey = readVarSliceHex(buffer, offset, 'collateral pubkey');
    extraData.collateralPubkey = collateralPubkey.value;
    offset = collateralPubkey.offset;

    const publicKey = readVarSliceHex(buffer, offset, 'FluxNode public key');
    result.publicKey = publicKey.value;
    offset = publicKey.offset;
  } else {
    // Unknown feature combination; attempt to parse as normal for compatibility
    const collateralPubkey = readVarSliceHex(buffer, offset, 'collateral pubkey (fallback)');
    extraData.collateralPubkey = collateralPubkey.value;
    offset = collateralPubkey.offset;

    const publicKey = readVarSliceHex(buffer, offset, 'FluxNode public key (fallback)');
    result.publicKey = publicKey.value;
    offset = publicKey.offset;
  }

  ensureAvailable(buffer, offset, 4, 'sigTime');
  const sigTime = buffer.readUInt32LE(offset);
  offset += 4;
  extraData.sigTime = sigTime;

  const signature = readVarSliceHex(buffer, offset, 'FluxNode signature');
  result.signature = signature.value;
  offset = signature.offset;

  if (nFluxTxVersion !== undefined && (nFluxTxVersion & FLUXNODE_TX_FEATURE_DELEGATES_BIT) !== 0) {
    ensureAvailable(buffer, offset, 1, 'delegate usage flag');
    const usingDelegatesFlag = buffer.readUInt8(offset);
    offset += 1;

    extraData.usingDelegates = usingDelegatesFlag === 1;

    if (usingDelegatesFlag === 1) {
      const delegateCountInfo = readVarInt(buffer, offset);
      offset += delegateCountInfo.size;

      const delegateKeys: string[] = [];
      for (let i = 0; i < delegateCountInfo.value; i++) {
        const delegateKey = readVarSliceHex(buffer, offset, `delegate key ${i}`);
        delegateKeys.push(delegateKey.value);
        offset = delegateKey.offset;
      }

      extraData.delegateCount = delegateKeys.length;
      extraData.delegateKeys = delegateKeys;
    }
  }

  result.extraData = {
    ...result.extraData,
    ...extraData,
  };

  logger.debug('Parsed FluxNode start transaction', {
    version: result.version,
    fluxTxVersion: extraData.nFluxTxVersion,
    hasDelegates: extraData.usingDelegates === true
  });

  return result;
}

/**
 * Parse FluxNode Confirmation transaction (version 5, type 4)
 * Format based on FluxD source code:
 * version(4) | type(1) | collateralIn(36) | sigTime(4) | benchmarkTier(1) | benchmarkSigTime(4) | nUpdateType(1) | ip(varstring) | sig(varbytes) | benchmarkSig(varbytes)
 */
function parseFluxNodeConfirmation(buffer: Buffer, offset: number, result: FluxNodeTransaction): FluxNodeTransaction {
  // Read collateral input (COutPoint: 32 byte hash + 4 byte index)
  const collateralHash = buffer.slice(offset, offset + 32).reverse().toString('hex');
  offset += 32;
  result.collateralHash = collateralHash;

  const collateralIndex = buffer.readUInt32LE(offset);
  offset += 4;
  result.collateralIndex = collateralIndex;

  // Read sigTime (uint32_t - 4 bytes)
  const sigTime = buffer.readUInt32LE(offset);
  offset += 4;

  // Read benchmarkTier (int8_t - 1 byte)
  const benchmarkTier = buffer.readInt8(offset);
  offset += 1;

  // Convert numeric tier to tier name (1=CUMULUS, 2=NIMBUS, 3=STRATUS)
  if (benchmarkTier === 1) result.benchmarkTier = 'CUMULUS';
  else if (benchmarkTier === 2) result.benchmarkTier = 'NIMBUS';
  else if (benchmarkTier === 3) result.benchmarkTier = 'STRATUS';

  // Read benchmarkSigTime (uint32_t - 4 bytes)
  const benchmarkSigTime = buffer.readUInt32LE(offset);
  offset += 4;

  // Read nUpdateType (int8_t - 1 byte)
  const nUpdateType = buffer.readInt8(offset);
  offset += 1;

  // Read IP address (std::string - VarInt length + string data)
  const ipLengthInfo = readVarInt(buffer, offset);
  offset += ipLengthInfo.size;

  let ipAddress = '';
  if (ipLengthInfo.value > 0 && offset + ipLengthInfo.value <= buffer.length) {
    ipAddress = buffer.slice(offset, offset + ipLengthInfo.value).toString('utf8');
    offset += ipLengthInfo.value;
    result.ipAddress = ipAddress;
  }

  // Read sig (std::vector<unsigned char> - VarInt length + signature data)
  const sigLengthInfo = readVarInt(buffer, offset);
  offset += sigLengthInfo.size;

  let signature = '';
  if (sigLengthInfo.value > 0 && offset + sigLengthInfo.value <= buffer.length) {
    signature = buffer.slice(offset, offset + sigLengthInfo.value).toString('hex');
    offset += sigLengthInfo.value;
    result.signature = signature;
  }

  // Read benchmarkSig (std::vector<unsigned char> - VarInt length + signature data)
  const benchmarkSigLengthInfo = readVarInt(buffer, offset);
  offset += benchmarkSigLengthInfo.size;

  let benchmarkSig = '';
  if (benchmarkSigLengthInfo.value > 0 && offset + benchmarkSigLengthInfo.value <= buffer.length) {
    benchmarkSig = buffer.slice(offset, offset + benchmarkSigLengthInfo.value).toString('hex');
    offset += benchmarkSigLengthInfo.value;
  }

  // Store additional confirmation data
  result.extraData = {
    ...result.extraData,
    sigTime,
    benchmarkTier,
    benchmarkSigTime,
    nUpdateType,
    benchmarkSig
  };

  logger.debug('Parsed FluxNode confirmation transaction', {
    version: result.version,
    benchmarkTier,
    updateType: nUpdateType,
    hasIp: Boolean(result.ipAddress)
  });

  return result;
}

/**
 * Parse legacy FluxNode transaction (version 3)
 */
function parseFluxNodeLegacy(buffer: Buffer, offset: number, result: FluxNodeTransaction): FluxNodeTransaction {
  // Legacy format - store remaining data as extraData
  if (offset < buffer.length) {
    result.extraData = {
      rawPayload: buffer.slice(offset).toString('hex'),
    };
  }

  return result;
}

/**
 * Determine FluxNode tier from collateral amount
 */
export function determineFluxNodeTier(collateralAmount: bigint): 'CUMULUS' | 'NIMBUS' | 'STRATUS' | 'UNKNOWN' {
  const amount = Number(collateralAmount) / 1e8; // Convert satoshis to FLUX

  // Collateral requirements (with some tolerance for fees)
  if (amount >= 999 && amount <= 1001) return 'CUMULUS';
  if (amount >= 12499 && amount <= 12501) return 'NIMBUS';
  if (amount >= 39999 && amount <= 40001) return 'STRATUS';

  return 'UNKNOWN';
}

/**
 * Extract IP address from FluxNode public key or other data
 * This may need to be fetched from the FluxNode list API instead
 */
export function extractIpAddress(extraData: any): string | null {
  // IP addresses are typically stored in the FluxNode list, not in the transaction
  // We may need to cross-reference with the FluxNode API or store it separately
  return null;
}

/**
 * Read VarInt from buffer
 * Same implementation as in block-parser.ts
 */
function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } {
  ensureAvailable(buffer, offset, 1, 'varint');
  const first = buffer.readUInt8(offset);

  if (first < 0xfd) {
    return { value: first, size: 1 };
  } else if (first === 0xfd) {
    return { value: buffer.readUInt16LE(offset + 1), size: 3 };
  } else if (first === 0xfe) {
    return { value: buffer.readUInt32LE(offset + 1), size: 5 };
  } else {
    // 0xff - 64-bit value, but we'll use 32-bit for safety
    return { value: buffer.readUInt32LE(offset + 1), size: 9 };
  }
}

/**
 * Generate P2SH address from multisig keys
 * This is a placeholder - actual implementation needs proper Bitcoin address encoding
 */
export function generateP2SHAddress(p2shKeys: string[]): string | null {
  if (!p2shKeys || p2shKeys.length !== 3) return null;

  // This would need proper P2SH address generation
  // For now, we'll just store the keys and generate address later if needed
  return null;
}

function readVarSliceHex(buffer: Buffer, offset: number, fieldName: string): { value: string; offset: number } {
  const { value: length, size } = readVarInt(buffer, offset);
  offset += size;

  if (length === 0) {
    return { value: '', offset };
  }

  ensureAvailable(buffer, offset, length, fieldName);
  const slice = buffer.slice(offset, offset + length).toString('hex');
  offset += length;

  return { value: slice, offset };
}

function ensureAvailable(buffer: Buffer, offset: number, bytesNeeded: number, field: string): void {
  if (offset + bytesNeeded > buffer.length) {
    throw new Error(`Unexpected end of buffer while reading ${field} (need ${bytesNeeded} bytes at offset ${offset}, buffer length ${buffer.length})`);
  }
}
