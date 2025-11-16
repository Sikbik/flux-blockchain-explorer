/**
 * Block Reward Labeling Logic
 * Handles the complex history of Flux block rewards and their distribution
 */

export interface RewardLabel {
  type: 'MINING' | 'FOUNDATION' | 'CUMULUS' | 'NIMBUS' | 'STRATUS';
  color: string;
  description: string;
}

export interface RewardTier {
  type: RewardLabel['type'];
  amount: number;
  tolerance: number; // Allow for rounding errors
}

/**
 * Block reward schedule for Flux blockchain
 *
 * Timeline:
 * - Blocks 1-277,999: Pure PoW mining (150 FLUX)
 * - Blocks 278,000-835,553: ZelNodes Era - 75% mining / 25% nodes
 * - Blocks 835,554-2,019,999: Flux Rebrand Era - 50% mining / 50% nodes
 * - Block 2,020,000+: PON/PoUW v2 Fork - No PoW, fixed node rewards + Foundation
 *
 * Node tier distribution (of node share):
 * - Cumulus (formerly Basic): 15%
 * - Nimbus (formerly Super): 25%
 * - Stratus (formerly BAMF): 60%
 *
 * Halving schedule (total block reward):
 * - Blocks 1-655,359: 150 FLUX
 * - Blocks 655,360-1,310,719: 75 FLUX
 * - Blocks 1,310,720-2,019,999: 37.5 FLUX (3rd halving canceled, fixed at 37.5)
 *
 * PON Era (fixed amounts, no halvings):
 * - Cumulus: 1 FLUX
 * - Nimbus: 3.5 FLUX
 * - Stratus: 9 FLUX
 * - Foundation: 0.5 FLUX + transaction fees (variable)
 */

const FLUXNODE_ACTIVATION_HEIGHT = 278000;    // ZelNodes launch
const SPLIT_CHANGE_HEIGHT = 835554;           // 75/25 → 50/50 split change
const FOUNDATION_ACTIVATION_HEIGHT = 2020000; // PON fork

// Halving occurs every 655,350 blocks (after the first halving)
// First halving was at block 657,850 due to initial network tuning
const _HALVING_INTERVAL = 655350; // Kept for documentation
const FIRST_HALVING_HEIGHT = 657850;
const SECOND_HALVING_HEIGHT = 1313200; // 657,850 + 655,350
const _THIRD_HALVING_HEIGHT = 1968550;  // Would be 1,313,200 + 655,350 but was CANCELED - kept for docs
const _INITIAL_REWARD = 150; // Kept for documentation

/**
 * Calculate the expected block reward at a given height
 *
 * Special cases:
 * - First halving at 657,850
 * - Second halving at 1,313,200
 * - Third halving at 1,968,550 was CANCELED - stays at 37.5 until PON
 */
export function getExpectedBlockReward(height: number): number {
  if (height < 1) return 0;

  // Before first halving: 150 FLUX
  if (height < FIRST_HALVING_HEIGHT) {
    return 150;
  }

  // After first halving, before second: 75 FLUX
  if (height < SECOND_HALVING_HEIGHT) {
    return 75;
  }

  // After second halving: 37.5 FLUX
  // 3rd halving was canceled, so it stays at 37.5 until PON fork
  if (height < FOUNDATION_ACTIVATION_HEIGHT) {
    return 37.5;
  }

  // PON era: no block subsidy calculation (handled separately)
  return 0;
}

/**
 * Get expected tier rewards at a given block height
 */
function getTierRewards(height: number): { cumulus: number; nimbus: number; stratus: number; mining: number } {
  const totalReward = getExpectedBlockReward(height);

  if (height < FLUXNODE_ACTIVATION_HEIGHT) {
    // Pre-FluxNode: all mining
    return {
      cumulus: 0,
      nimbus: 0,
      stratus: 0,
      mining: totalReward,
    };
  }

  // PON Era: Fixed absolute amounts (no longer percentages)
  if (height >= FOUNDATION_ACTIVATION_HEIGHT) {
    return {
      cumulus: 1,      // Fixed 1 FLUX
      nimbus: 3.5,     // Fixed 3.5 FLUX
      stratus: 9,      // Fixed 9 FLUX
      mining: 0,       // No more PoW mining
    };
  }

  // Pre-PON: Node rewards are percentages of total block reward
  // Determine mining/node split based on era
  let miningPercent: number;
  let nodePercent: number;

  if (height < SPLIT_CHANGE_HEIGHT) {
    // ZelNodes Era: 75/25 split
    miningPercent = 0.75;
    nodePercent = 0.25;
  } else {
    // Flux Rebrand Era: 50/50 split
    miningPercent = 0.50;
    nodePercent = 0.50;
  }

  const totalNodeReward = totalReward * nodePercent;
  const miningReward = totalReward * miningPercent;

  // Node tier distribution (of node share)
  const cumulus = totalNodeReward * 0.15;  // 15% of node share
  const nimbus = totalNodeReward * 0.25;   // 25% of node share
  const stratus = totalNodeReward * 0.60;  // 60% of node share

  return { cumulus, nimbus, stratus, mining: miningReward };
}

/**
 * Get the reward label for a specific output based on amount and block height
 */
export function getRewardLabel(amount: number, blockHeight: number): RewardLabel {
  // Foundation era (block 2,020,000+)
  // In PON era: Stratus = 9, Nimbus = 3.5, Cumulus = 1, Foundation = 0.5 + fees
  if (blockHeight >= FOUNDATION_ACTIVATION_HEIGHT) {
    // Use a reasonable tolerance for fixed amounts
    const tolerance = 0.01;

    // Check fixed tier rewards FIRST (9, 3.5, 1 FLUX) - exact matches
    // Stratus: 9 FLUX
    if (Math.abs(amount - 9) < tolerance) {
      return {
        type: 'STRATUS',
        color: 'bg-blue-500',
        description: 'FluxNode Stratus Tier Reward',
      };
    }

    // Nimbus: 3.5 FLUX (check before Foundation range!)
    if (Math.abs(amount - 3.5) < tolerance) {
      return {
        type: 'NIMBUS',
        color: 'bg-purple-500',
        description: 'FluxNode Nimbus Tier Reward',
      };
    }

    // Cumulus: 1 FLUX (check before Foundation range!)
    if (Math.abs(amount - 1) < tolerance) {
      return {
        type: 'CUMULUS',
        color: 'bg-pink-500',
        description: 'FluxNode Cumulus Tier Reward',
      };
    }

    // Foundation: 0.5 + fees (variable, typically 0.4-3.4)
    // IMPORTANT: Only check amounts that are NOT tier rewards
    // Must be LESS than 0.95 to avoid catching Cumulus (1 FLUX)
    // Must NOT be 3.5 (Nimbus) - check range around foundation amounts
    if (amount < 0.95 || (amount > 1.05 && amount < 3.45) || (amount > 3.55 && amount < 8.95)) {
      return {
        type: 'FOUNDATION',
        color: 'bg-green-500',
        description: 'Foundation Reward (0.5 FLUX + tx fees)',
      };
    }

    // No mining in PON era - fallback to Foundation for any remaining amounts
    return {
      type: 'FOUNDATION',
      color: 'bg-green-500',
      description: 'Foundation Reward',
    };
  }

  // FluxNode era (blocks 279,991 - 2,019,999)
  if (blockHeight >= FLUXNODE_ACTIVATION_HEIGHT) {
    const expectedTiers = getTierRewards(blockHeight);
    // Use relative tolerance: 0.01% of the expected value, minimum 0.0001
    const getRelativeTolerance = (expected: number) => Math.max(expected * 0.0001, 0.0001);

    if (Math.abs(amount - expectedTiers.stratus) < getRelativeTolerance(expectedTiers.stratus)) {
      return {
        type: 'STRATUS',
        color: 'bg-blue-500',
        description: 'FluxNode Stratus Tier Reward',
      };
    }

    if (Math.abs(amount - expectedTiers.nimbus) < getRelativeTolerance(expectedTiers.nimbus)) {
      return {
        type: 'NIMBUS',
        color: 'bg-purple-500',
        description: 'FluxNode Nimbus Tier Reward',
      };
    }

    if (Math.abs(amount - expectedTiers.cumulus) < getRelativeTolerance(expectedTiers.cumulus)) {
      return {
        type: 'CUMULUS',
        color: 'bg-pink-500',
        description: 'FluxNode Cumulus Tier Reward',
      };
    }

    // Anything else is mining reward
    return {
      type: 'MINING',
      color: 'bg-yellow-500',
      description: 'Mining Reward',
    };
  }

  // Early blocks (1 - 279,990): Pure PoW mining
  return {
    type: 'MINING',
    color: 'bg-yellow-500',
    description: 'Mining Reward (Pre-FluxNode)',
  };
}

/**
 * Get all expected rewards for a block at a given height
 * Useful for displaying what the distribution should look like
 */
export function getExpectedRewardsForBlock(blockHeight: number): Array<{ type: RewardLabel['type']; amount: number }> {
  const rewards: Array<{ type: RewardLabel['type']; amount: number }> = [];

  if (blockHeight < FLUXNODE_ACTIVATION_HEIGHT) {
    // Pure mining
    const totalReward = getExpectedBlockReward(blockHeight);
    rewards.push({ type: 'MINING', amount: totalReward });
  } else if (blockHeight < FOUNDATION_ACTIVATION_HEIGHT) {
    // FluxNode era
    const tiers = getTierRewards(blockHeight);
    rewards.push(
      { type: 'STRATUS', amount: tiers.stratus },
      { type: 'NIMBUS', amount: tiers.nimbus },
      { type: 'CUMULUS', amount: tiers.cumulus },
      { type: 'MINING', amount: tiers.mining }
    );
  } else {
    // Foundation era
    const tiers = getTierRewards(blockHeight);
    rewards.push(
      { type: 'STRATUS', amount: tiers.stratus },
      { type: 'NIMBUS', amount: tiers.nimbus },
      { type: 'CUMULUS', amount: tiers.cumulus },
      { type: 'FOUNDATION', amount: 0.5 }, // Base foundation, fees are variable
      { type: 'MINING', amount: tiers.mining }
    );
  }

  return rewards;
}

/**
 * Get color class for a reward type
 */
export function getRewardColor(type: RewardLabel['type']): string {
  switch (type) {
    case 'MINING':
      return 'bg-yellow-500';
    case 'FOUNDATION':
      return 'bg-green-500';
    case 'CUMULUS':
      return 'bg-pink-500';
    case 'NIMBUS':
      return 'bg-purple-500';
    case 'STRATUS':
      return 'bg-blue-500';
    default:
      return 'bg-gray-500';
  }
}

/**
 * Format reward amount for display
 */
export function formatRewardAmount(amount: number): string {
  return amount.toFixed(8);
}
