import { DomainError } from '../shared/errors';
import type { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/** Livraison assurée par le restaurant, par codes postaux complets. */
export interface DeliveryZonePolicy {
  readonly id: string;
  readonly name: string;
  readonly postalCodes: readonly string[];
  readonly feeCents: number;
  readonly minimumOrderCents: number;
}

export interface DeliveryPolicy {
  readonly enabled: boolean;
  /** Temps total minimal de préparation et de trajet. */
  readonly leadTimeMin: number;
  readonly zones: readonly DeliveryZonePolicy[];
}

export interface DeliveryQuote {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly feeCents: number;
  readonly minimumOrderCents: number;
  /** Montant des produits après remise, hors frais. */
  readonly subtotalCents: number;
  readonly totalCents: number;
  readonly estimatedMinutes: number;
}

export class DeliveryRefused extends DomainError {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Aucun I/O : les zones persistées et le panier net font seuls autorité. */
export function quoteDelivery(
  policy: DeliveryPolicy,
  postalCode: string,
  subtotal: Money,
): Result<DeliveryQuote, DeliveryRefused> {
  if (!policy.enabled) {
    return err(new DeliveryRefused('delivery.unavailable', 'La livraison est momentanément indisponible.'));
  }
  const matches = policy.zones.filter((zone) => zone.postalCodes.includes(postalCode));
  if (matches.length === 0) {
    return err(new DeliveryRefused('delivery.outside_zone', 'Cette adresse se trouve hors de notre zone de livraison. Vous pouvez retirer votre commande au restaurant.'));
  }
  const zone = matches[0]!;
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(zone.feeCents) || zone.feeCents < 0 ||
    !Number.isSafeInteger(zone.minimumOrderCents) || zone.minimumOrderCents < 0 ||
    !Number.isSafeInteger(subtotal.cents) || subtotal.cents < 0 ||
    !Number.isSafeInteger(subtotal.cents + zone.feeCents) ||
    !Number.isInteger(policy.leadTimeMin) || policy.leadTimeMin < 20
  ) {
    return err(new DeliveryRefused('delivery.invalid_configuration', 'La livraison est momentanément indisponible.'));
  }
  if (subtotal.cents < zone.minimumOrderCents) {
    const missing = ((zone.minimumOrderCents - subtotal.cents) / 100).toFixed(2).replace('.', ',');
    return err(new DeliveryRefused('delivery.minimum_not_reached', `Ajoutez ${missing} € de produits pour atteindre le minimum de livraison, après remise et hors frais.`));
  }
  return ok({
    zoneId: zone.id,
    zoneName: zone.name,
    feeCents: zone.feeCents,
    minimumOrderCents: zone.minimumOrderCents,
    subtotalCents: subtotal.cents,
    totalCents: subtotal.cents + zone.feeCents,
    estimatedMinutes: policy.leadTimeMin,
  });
}
