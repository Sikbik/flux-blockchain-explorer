/**
 * Debug utility to inspect how the block parser walks transactions
 *
 * Usage:
 *   ts-node src/scripts/debug-block-parser.ts <blockHash|height> [targetTxid]
 *
 * Requires environment variables for FLUX RPC to be configured (see config.ts).
 */

import { config } from '../config';
import { FluxRPCClient } from '../rpc/flux-rpc-client';
import { scanBlockTransactions, ScannedTransaction } from '../parsers/block-parser';
import { Block } from '../types';

interface DebugOptions {
  blockArg: string;
  targetTxid?: string;
}

function parseArgs(): DebugOptions {
  const [, , ...rest] = process.argv;
  if (rest.length === 0) {
    console.error('Usage: ts-node src/scripts/debug-block-parser.ts <blockHash|height> [targetTxid]');
    process.exit(1);
  }

  const [blockArg, targetTxid] = rest;
  return { blockArg, targetTxid };
}

async function fetchBlockHex(rpc: FluxRPCClient, blockArg: string): Promise<{ hash: string; hex: string; block: Block }> {
  let block: Block;

  if (/^\d+$/.test(blockArg)) {
    const height = parseInt(blockArg, 10);
    block = await rpc.getBlock(height, 2);
  } else {
    block = await rpc.getBlock(blockArg, 2);
  }

  const hash = block.hash;
  const rawHex = await rpc.getBlock(hash, 0) as unknown as string;
  return { hash, hex: rawHex, block };
}

function formatTx(tx: ScannedTransaction, expectedTxid?: string): string {
  const status = expectedTxid
    ? tx.txid === expectedTxid
      ? 'MATCH'
      : `MISMATCH (expected ${expectedTxid})`
    : 'OK';

  const kind = tx.fluxNodeType !== undefined ? `FluxNode(type=${tx.fluxNodeType})` : 'Standard';

  return [
    `#${tx.index}`,
    status,
    `version=${tx.version}`,
    kind,
    `offset=${tx.offset}`,
    `length=${tx.length}`,
    `txid=${tx.txid}`,
  ].join(' | ');
}

async function main(): Promise<void> {
  const { blockArg, targetTxid } = parseArgs();
  const rpc = new FluxRPCClient(config.rpc);

  try {
    const { hash, hex, block } = await fetchBlockHex(rpc, blockArg);
    const parsed = scanBlockTransactions(hex);

    const expectedTxids: string[] = (block.tx as Array<string | { txid: string }>).map((entry) =>
      typeof entry === 'string' ? entry : entry.txid
    );

    console.log(`Block ${hash} @ height ${block.height}`);
    console.log(`Transactions (expected): ${expectedTxids.length}`);
    console.log(`Transactions (parsed):   ${parsed.length}`);
    console.log('---');

    parsed.forEach((tx, idx) => {
      const expectedTxid = expectedTxids[idx];
      const line = formatTx(tx, expectedTxid);
      if (targetTxid && tx.txid === targetTxid) {
        console.log(`${line}    <= TARGET`);
      } else {
        console.log(line);
      }
    });

    if (parsed.length !== expectedTxids.length) {
      const missing = expectedTxids.slice(parsed.length);
      if (missing.length > 0) {
        console.warn('Parser returned fewer transactions than expected. Missing txids:');
        missing.forEach((txid) => console.warn(`  - ${txid}`));
      }
    }

    if (targetTxid && !parsed.some((tx) => tx.txid === targetTxid)) {
      console.warn(`Target txid ${targetTxid} not found by parser.`);
    }
  } catch (error: any) {
    console.error(`Failed to debug block ${blockArg}: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
