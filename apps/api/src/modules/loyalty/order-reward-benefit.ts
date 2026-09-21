import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrderRewardBenefitSchema, type OrderRewardBenefit } from '@sm/contracts';

export type RewardPricedLine = { productId: unknown; unitPrice: number; qty: number; options: readonly { priceDelta: number }[] };
/** A product reward covers one cheapest matching base unit; extras remain payable.
 * Names/free text are deliberately never interpreted as catalogue identifiers. */
export function orderRewardBenefit(reward: { id: string; name: string; costUnits: number; kind: string; valueCents: number | null; productRef: string | null },
  lines: readonly RewardPricedLine[], subtotalCents: number): OrderRewardBenefit {
  let amountCents: number;
  if (reward.kind === 'fixed_discount' && Number.isSafeInteger(reward.valueCents) && reward.valueCents! > 0) {
    amountCents = Math.min(reward.valueCents!, subtotalCents);
  } else if (reward.kind === 'product' && /^[a-f0-9]{24}$/.test(reward.productRef ?? '')) {
    const bases = lines.filter(line => String(line.productId) === reward.productRef && line.qty > 0)
      .map(line => line.unitPrice - line.options.reduce((sum, option) => sum + option.priceDelta, 0));
    if (!bases.length) throw new ConflictException('Ajoutez le produit de cette récompense à votre panier.');
    amountCents = Math.min(...bases, subtotalCents);
  } else throw new ConflictException('Cette récompense n’est pas disponible en commande en ligne.');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new BadRequestException('Cette récompense ne réduit pas ce panier.');
  return OrderRewardBenefitSchema.parse({ rewardId: reward.id, name: reward.name, costUnits: reward.costUnits,
    kind: reward.kind, amountCents, productRef: reward.kind === 'product' ? reward.productRef : null, policy: 'one-reward-no-promotion-v1' });
}
