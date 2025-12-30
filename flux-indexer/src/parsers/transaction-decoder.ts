/**
 * Raw Transaction Decoder
 *
 * Decodes transparent vin/vout from raw transaction hex so the indexer can run
 * with txindex=0 (no getrawtransaction lookups for historical txs).
 */

import * as crypto from 'crypto';

import type { ScriptPubKey, Transaction, TransactionInput, TransactionOutput } from '../types';
import { encodeFluxAddress } from '../utils/script-utils';

export type FluxNetwork = 'mainnet' | 'testnet';

export function decodeRawTransaction(
  txHex: string,
  options?: { network?: FluxNetwork; txid?: string }
): Transaction {
  const network: FluxNetwork = options?.network ?? 'mainnet';
  const buffer = Buffer.from(txHex, 'hex');

  let offset = 0;
  ensureAvailable(buffer, offset, 4, 'version');
  const versionRaw = buffer.readUInt32LE(offset);
  const isOverwintered = (versionRaw & 0x80000000) !== 0;
  const version = versionRaw & 0x7fffffff;
  offset += 4;

  if (isOverwintered) {
    ensureAvailable(buffer, offset, 4, 'versionGroupId');
    offset += 4;
  }

  const vinCount = readVarInt(buffer, offset);
  offset += vinCount.size;

  const vin: TransactionInput[] = [];
  for (let i = 0; i < vinCount.value; i++) {
    ensureAvailable(buffer, offset, 32 + 4, `vin ${i} outpoint`);
    const prevHash = buffer.subarray(offset, offset + 32);
    offset += 32;

    const vout = buffer.readUInt32LE(offset);
    offset += 4;

    const scriptLen = readVarInt(buffer, offset);
    offset += scriptLen.size;
    ensureAvailable(buffer, offset, scriptLen.value + 4, `vin ${i} scriptSig+sequence`);

    const scriptSig = buffer.subarray(offset, offset + scriptLen.value);
    offset += scriptLen.value;

    const sequence = buffer.readUInt32LE(offset);
    offset += 4;

    if (isCoinbaseInput(prevHash, vout)) {
      vin.push({
        coinbase: scriptSig.toString('hex'),
        sequence,
      });
    } else {
      vin.push({
        txid: Buffer.from(prevHash).reverse().toString('hex'),
        vout,
        scriptSig: {
          asm: '',
          hex: scriptSig.toString('hex'),
        },
        sequence,
      });
    }
  }

  const voutCount = readVarInt(buffer, offset);
  offset += voutCount.size;

  const vout: TransactionOutput[] = [];
  for (let i = 0; i < voutCount.value; i++) {
    ensureAvailable(buffer, offset, 8, `vout ${i} value`);
    const valueSats = buffer.readBigInt64LE(offset);
    offset += 8;

    const scriptLen = readVarInt(buffer, offset);
    offset += scriptLen.size;
    ensureAvailable(buffer, offset, scriptLen.value, `vout ${i} scriptPubKey`);
    const script = buffer.subarray(offset, offset + scriptLen.value);
    offset += scriptLen.value;

    const scriptPubKey = decodeScriptPubKey(script, network);

    vout.push({
      value: Number(valueSats) / 1e8,
      n: i,
      scriptPubKey,
    });
  }

  // locktime always present for standard transactions (transparent part)
  let locktime = 0;
  if (offset + 4 <= buffer.length) {
    locktime = buffer.readUInt32LE(offset);
  }

  const computedTxid = calculateTxid(buffer);
  const txid = options?.txid ?? computedTxid;

  return {
    txid,
    hash: txid,
    version,
    size: buffer.length,
    vsize: buffer.length,
    locktime,
    vin,
    vout,
  };
}

function decodeScriptPubKey(script: Buffer, network: FluxNetwork): ScriptPubKey {
  const hex = script.toString('hex');

  // P2PKH: OP_DUP OP_HASH160 PUSH20 <hash160> OP_EQUALVERIFY OP_CHECKSIG
  if (
    script.length === 25 &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  ) {
    const hash160 = script.subarray(3, 23).toString('hex');
    const address = encodeFluxAddress(hash160, 'p2pkh', network);
    return {
      asm: '',
      hex,
      type: 'pubkeyhash',
      addresses: address ? [address] : undefined,
    };
  }

  // P2SH: OP_HASH160 PUSH20 <hash160> OP_EQUAL
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    const hash160 = script.subarray(2, 22).toString('hex');
    const address = encodeFluxAddress(hash160, 'p2sh', network);
    return {
      asm: '',
      hex,
      type: 'scripthash',
      addresses: address ? [address] : undefined,
    };
  }

  // P2PK: <PUSH33|PUSH65> <pubkey> OP_CHECKSIG
  if (
    (script.length === 35 || script.length === 67) &&
    (script[0] === 0x21 || script[0] === 0x41) &&
    script[script.length - 1] === 0xac
  ) {
    const pubkeyLen = script[0];
    if (pubkeyLen + 2 === script.length) {
      const pubkey = script.subarray(1, 1 + pubkeyLen);
      const hash160 = hash160FromPubkey(pubkey).toString('hex');
      const address = encodeFluxAddress(hash160, 'p2pkh', network);
      return {
        asm: '',
        hex,
        type: 'pubkey',
        addresses: address ? [address] : undefined,
      };
    }
  }

  // OP_RETURN
  if (script.length > 0 && script[0] === 0x6a) {
    return {
      asm: '',
      hex,
      type: 'nulldata',
    };
  }

  return {
    asm: '',
    hex,
    type: 'nonstandard',
  };
}

function hash160FromPubkey(pubkey: Buffer): Buffer {
  const sha = crypto.createHash('sha256').update(pubkey).digest();
  return crypto.createHash('ripemd160').update(sha).digest();
}

function calculateTxid(txBuffer: Buffer): string {
  const hash1 = crypto.createHash('sha256').update(txBuffer).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  return Buffer.from(hash2).reverse().toString('hex');
}

function isCoinbaseInput(prevHash: Buffer, vout: number): boolean {
  if (vout !== 0xffffffff) return false;
  for (let i = 0; i < prevHash.length; i++) {
    if (prevHash[i] !== 0) return false;
  }
  return true;
}

function readVarInt(buffer: Buffer, offset: number): { value: number; size: number } {
  ensureAvailable(buffer, offset, 1, 'varint');
  const first = buffer.readUInt8(offset);

  if (first < 0xfd) {
    return { value: first, size: 1 };
  }

  if (first === 0xfd) {
    ensureAvailable(buffer, offset, 3, 'varint 0xfd');
    return { value: buffer.readUInt16LE(offset + 1), size: 3 };
  }

  if (first === 0xfe) {
    ensureAvailable(buffer, offset, 5, 'varint 0xfe');
    return { value: buffer.readUInt32LE(offset + 1), size: 5 };
  }

  ensureAvailable(buffer, offset, 9, 'varint 0xff');
  const value = Number(buffer.readBigUInt64LE(offset + 1));
  return { value, size: 9 };
}

function ensureAvailable(buffer: Buffer, offset: number, needed: number, context: string): void {
  if (offset + needed > buffer.length) {
    throw new Error(`Raw tx decode: need ${needed} bytes for ${context} at offset ${offset}, length=${buffer.length}`);
  }
}

