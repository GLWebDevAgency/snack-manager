import { ServiceUnavailableException } from '@nestjs/common';
import { orderRewardHash } from '../loyalty/order-reward.store';
import type { RewardPricedLine } from '../loyalty/order-reward-benefit';

export const orderRewardsEnabled = () => process.env.LOYALTY_ORDER_REWARDS_ENABLED === 'true';
export function rewardPricingHash(payloadHash: string, subtotal: number, lines: readonly RewardPricedLine[]) {
  return orderRewardHash({ payloadHash, subtotal, lines: lines.map(line => ({ productId: String(line.productId),
    unitPrice: line.unitPrice, qty: line.qty, options: line.options.map(option => ({ priceDelta: option.priceDelta })) })) });
}
export function assertOrderRewardReady(order: { loyaltyReward?: unknown; loyaltyRewardProcessing?: { state?: string } | null }) {
  if (order.loyaltyReward != null && order.loyaltyRewardProcessing?.state !== 'consumed') {
    throw new ServiceUnavailableException({ code: 'ORDER_REWARD_PENDING', message: 'Votre récompense est en cours de confirmation. Reprenez cette même commande dans un instant.' });
  }
}
