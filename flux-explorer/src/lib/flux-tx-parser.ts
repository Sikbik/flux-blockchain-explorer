/**
 * Flux Transaction Parser
 *
 * Parses Flux-specific transaction types (FluxNode confirmations, updates, etc.)
 * from raw transaction hex data.
 */

export interface FluxNodeTransaction {
  type: string;
  nType: number;
  collateralOutputHash?: string;
  collateralOutputIndex?: number;
  collateralOutput?: string;
  sigTime?: number;
  sig?: string;
  ip?: string;
  updateType?: number;
  benchmarkTier?: string;
  benchmarkSigTime?: number;
  benchmarkSig?: string;
}

/**
 * Parse FluxNode transaction from raw hex
 */
export function parseFluxNodeTransaction(hex: string): FluxNodeTransaction | null {
  try {
    const buffer = Buffer.from(hex, 'hex');
    let offset = 0;

    // Read version (4 bytes, little-endian)
    // const version = buffer.readUInt32LE(offset);
    offset += 4;

    // Read nType (1 byte)
    const nType = buffer.readUInt8(offset);
    offset += 1;

    // Only parse FluxNode transactions (type 4)
    if (nType !== 4) {
      return null;
    }

    // Read collateral output hash (32 bytes)
    const collateralHash = buffer.slice(offset, offset + 32);
    const collateralOutputHash = collateralHash.reverse().toString('hex');
    offset += 32;

    // Read collateral output index (4 bytes, little-endian)
    const collateralOutputIndex = buffer.readUInt32LE(offset);
    offset += 4;

    const collateralOutput = `COutPoint(${collateralOutputHash.slice(0, 10)}, ${collateralOutputIndex})`;

    // Read sigTime (4 bytes, little-endian)
    const sigTime = buffer.readUInt32LE(offset);
    offset += 4;

    // Read signature length prefix (varint)
    // const sigLengthPrefix = buffer.readUInt8(offset);
    offset += 1;

    // Read benchmark sig time (4 bytes, little-endian)
    const benchmarkSigTime = buffer.readUInt32LE(offset);
    offset += 4;

    // Read updateType (1 byte)
    const updateType = buffer.readUInt8(offset);
    offset += 1;

    // Read IP address length (1 byte)
    const ipLength = buffer.readUInt8(offset);
    offset += 1;

    // Read IP address (variable length string)
    const ipBytes = buffer.slice(offset, offset + ipLength);
    const ip = ipBytes.toString('utf8');
    offset += ipLength;

    // Read signature (starts with 0x41 for 65-byte signature)
    const sigType = buffer.readUInt8(offset);
    offset += 1;

    let sig = '';
    if (sigType === 0x41) {
      // 65-byte signature
      const sigBytes = buffer.slice(offset, offset + 64);
      sig = sigBytes.toString('base64');
      offset += 64;
    }

    // Read benchmark signature (starts with 0x41)
    const benchmarkSigType = buffer.readUInt8(offset);
    offset += 1;

    let benchmarkSig = '';
    if (benchmarkSigType === 0x41) {
      // 65-byte signature
      const benchmarkSigBytes = buffer.slice(offset, offset + 64);
      benchmarkSig = benchmarkSigBytes.toString('base64');
      offset += 64;
    }

    return {
      type: 'Confirming a fluxnode',
      nType,
      collateralOutputHash,
      collateralOutputIndex,
      collateralOutput,
      sigTime,
      sig,
      ip,
      updateType,
      benchmarkTier: undefined, // Will be determined by looking up collateral amount
      benchmarkSigTime,
      benchmarkSig,
    };
  } catch (error) {
    console.error('Failed to parse FluxNode transaction:', error);
    return null;
  }
}

/**
 * Check if transaction is a FluxNode transaction (0 inputs, 0 outputs)
 */
export function isFluxNodeTransaction(tx: { vin?: unknown[]; vout?: unknown[] }): boolean {
  return (
    tx.vin !== undefined &&
    tx.vout !== undefined &&
    tx.vin.length === 0 &&
    tx.vout.length === 0
  );
}

/**
 * Determine FluxNode tier from collateral amount
 */
export function getTierFromCollateral(amount: number): string {
  // Flux collateral amounts:
  // CUMULUS: 1,000 FLUX
  // NIMBUS: 12,500 FLUX
  // STRATUS: 40,000 FLUX

  if (amount >= 40000) {
    return 'STRATUS';
  } else if (amount >= 12500) {
    return 'NIMBUS';
  } else if (amount >= 1000) {
    return 'CUMULUS';
  }

  return 'UNKNOWN';
}

/**
 * Categorize transactions into regular transactions and node confirmations
 */
export interface TransactionCounts {
  totalTransactions: number;
  regularTransactions: number;
  nodeConfirmations: number;
  nodeConfirmationsByTier: {
    cumulus: number;
    nimbus: number;
    stratus: number;
    unknown: number;
  };
}

export function categorizeTransactions(
  transactions: Array<{ vin?: unknown[]; vout?: unknown[] } | null>
): TransactionCounts {
  const counts: TransactionCounts = {
    totalTransactions: transactions.length,
    regularTransactions: 0,
    nodeConfirmations: 0,
    nodeConfirmationsByTier: {
      cumulus: 0,
      nimbus: 0,
      stratus: 0,
      unknown: 0,
    },
  };

  for (const tx of transactions) {
    if (!tx) continue;

    if (isFluxNodeTransaction(tx)) {
      counts.nodeConfirmations++;
      // Note: We would need to fetch the collateral amount to determine tier
      // For now, increment unknown
      counts.nodeConfirmationsByTier.unknown++;
    } else {
      counts.regularTransactions++;
    }
  }

  return counts;
}
