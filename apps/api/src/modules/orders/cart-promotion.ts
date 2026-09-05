import { BadRequestException } from '@nestjs/common';
import { Money, ordering } from '@sm/domain';

/** Même recherche tenant/code pour le devis et la réservation de commande. */
export function promotionCandidatesFilter(tenantId: string, promoCode?: string) {
  const code = promoCode?.trim();
  return { tenantId, active: true, code: code ? code.toUpperCase() : null };
}

/** Les anciens champs de borne absents d'un document lean valent « aucune borne ». */
function versRegle(doc: Record<string, unknown>): ordering.PromotionRule {
  const nombre = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const date = (value: unknown): Date | null => value instanceof Date ? value : null;
  return {
    id: String(doc._id), name: String(doc.name ?? ''), kind: doc.kind as ordering.PromotionRule['kind'],
    value: nombre(doc.value), code: typeof doc.code === 'string' && doc.code ? doc.code : null,
    channels: Array.isArray(doc.channels) ? doc.channels as string[] : [],
    startsAt: date(doc.startsAt), endsAt: date(doc.endsAt), active: doc.active === true,
    minSubtotalCents: nombre(doc.minSubtotalCents), maxDiscountCents: nombre(doc.maxDiscountCents),
    maxUsage: nombre(doc.maxUsage), usageCount: nombre(doc.usageCount),
    offeredProductId: doc.offeredProductId ? String(doc.offeredProductId) : null,
  };
}

type CartPromotionContext = {
  subtotal: number;
  channel: string;
  promoCode?: string;
  now: Date;
  lines: readonly { productId: unknown; unitPrice: number }[];
};

export type SelectedCartPromotion = { id: unknown; amount: number; reason: string };

/**
 * Sélection pure : ni horloge implicite, ni lecture/écriture, ni réservation.
 * Le domaine vérifie aussi le canal pour expliquer un code réservé à la caisse.
 * Le writer reste seul responsable du quota atomique et de sa compensation.
 */
export function selectCartPromotion(
  candidates: readonly Record<string, unknown>[],
  input: CartPromotionContext,
): SelectedCartPromotion | null {
  const code = input.promoCode?.trim();
  if (code && candidates.length === 0) {
    throw new BadRequestException(`Le code « ${code} » ne correspond à aucune offre`);
  }
  if (candidates.length === 0) return null;

  // Un produit offert vaut l'exemplaire le moins cher, options comprises.
  const prixAuPanier = new Map<string, Money>();
  for (const line of input.lines) {
    const id = String(line.productId);
    const current = prixAuPanier.get(id);
    if (!current || line.unitPrice < current.cents) prixAuPanier.set(id, Money.fromCents(line.unitPrice));
  }
  const context = { subtotal: Money.fromCents(input.subtotal), channel: input.channel, code: code ?? null,
    now: input.now, prixAuPanier };
  let selected: SelectedCartPromotion | null = null;
  let refusal: string | null = null;
  for (const raw of candidates) {
    const result = ordering.appliquerPromotion(versRegle(raw), context);
    if (!result.ok) {
      refusal ??= result.error.message;
      continue;
    }
    const amount = result.value.amount.cents;
    // Égalité : garde le premier, comme le writer historique.
    if (!selected || amount > selected.amount) selected = { id: raw._id, amount, reason: result.value.reason };
  }
  if (!selected && code) {
    throw new BadRequestException(refusal ?? `Le code « ${code} » n’est pas applicable`);
  }
  return selected;
}
