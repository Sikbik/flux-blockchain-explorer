#!/usr/bin/env node
/**
 * Quick script to inspect a block's transactions
 */

import { FluxRPCClient } from '../rpc/flux-rpc-client';
import { config } from '../config';

async function main() {
  const blockArg = process.argv[2];
  if (!blockArg) {
    console.error('Usage: node inspect-block.js <blockHash|height>');
    process.exit(1);
  }

  const rpc = new FluxRPCClient(config.rpc);

  try {
    // Get block with verbosity 2 (full transaction details)
    let block;
    if (blockArg.match(/^\d+$/)) {
      const hash = await rpc.getBlockHash(parseInt(blockArg));
      block = await rpc.getBlock(hash, 2);
    } else {
      block = await rpc.getBlock(blockArg, 2);
    }

    console.log(`Block ${block.hash} @ height ${block.height}`);
    console.log(`Total transactions: ${block.tx.length}`);
    console.log('---');

    block.tx.forEach((tx: any, index: number) => {
      const isCoinbase = tx.vin && tx.vin.length > 0 && tx.vin[0].coinbase;
      const inputCount = tx.vin ? tx.vin.length : 0;
      const outputCount = tx.vout ? tx.vout.length : 0;

      const hasShieldedSpend = (tx.vShieldedSpend && tx.vShieldedSpend.length > 0) ||
                               (tx.vShieldedSpend2 && tx.vShieldedSpend2.length > 0);
      const hasShieldedOutput = (tx.vShieldedOutput && tx.vShieldedOutput.length > 0) ||
                                (tx.vShieldedOutput2 && tx.vShieldedOutput2.length > 0);
      const hasJoinSplit = tx.vjoinsplit && tx.vjoinsplit.length > 0;

      let type = isCoinbase ? 'COINBASE' : 'REGULAR';
      if (hasShieldedSpend || hasShieldedOutput) type += ' (SAPLING)';
      if (hasJoinSplit) type += ' (JOINSPLIT)';
      if (inputCount === 0 && outputCount > 0 && !isCoinbase) type += ' [DESHIELDING]';
      if (inputCount > 0 && outputCount === 0) type += ' [SHIELDING]';

      console.log(`[${index}] ${tx.txid}`);
      console.log(`    Version: ${tx.version}, Overwinter: ${tx.overwintered || false}`);
      console.log(`    Type: ${type}`);
      console.log(`    Inputs: ${inputCount}, Outputs: ${outputCount}`);
      if (hasShieldedSpend || hasShieldedOutput || hasJoinSplit) {
        console.log(`    Shielded spends: ${tx.vShieldedSpend?.length || 0}, outputs: ${tx.vShieldedOutput?.length || 0}, joinsplits: ${tx.vjoinsplit?.length || 0}`);
      }
      console.log('');
    });

  } catch (error: any) {
    console.error('Failed to inspect block:', error.message);
    process.exit(1);
  }
}

main();
