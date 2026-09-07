import { BadRequestException, ConflictException } from '@nestjs/common';
import { Document } from 'mongoose';
import {
  aLaCapacite, DEFAULT_DELIVERY_SETTINGS, DeliverySettingsSchema, publicOrderingState,
  type CreateOrder, type DeliverySettings, type PublicDeliverySettings, type SouscriptionLue,
} from '@sm/contracts';
import { Money, ordering } from '@sm/domain';

type DeliveryTenant = SouscriptionLue & {
  delivery?: unknown;
  account?: Parameters<typeof publicOrderingState>[0];
  settings?: { onlineOrderingPaused?: boolean | null; pauseMessage?: string | null } | null;
  encaissement?: { accountId?: string | null; chargesEnabled?: boolean | null } | null;
};

/** Les anciens documents n'ont aucune zone : ils restent en retrait uniquement. */
export function deliverySettingsOf(tenant: { delivery?: unknown }): DeliverySettings {
  try {
    const delivery = tenant.delivery;
    // Les lectures hydratées portent de vrais sous-documents Mongoose, pas
    // du JSON. Ne convertir qu'eux, sans exécuter un toObject arbitraire ni
    // masquer des champs inconnus avant la validation stricte du contrat.
    const plain = delivery instanceof Document ? delivery.toObject({
      getters: false, virtuals: false, transform: false, minimize: false, schemaFieldsOnly: false,
    }) : delivery;
    const result = DeliverySettingsSchema.safeParse(plain);
    if (result.success) return result.data;
  } catch { /* Une normalisation impossible ne rend jamais la livraison disponible. */ }
  return { ...DEFAULT_DELIVERY_SETTINGS, zones: [] };
}

export function publicDeliverySettingsOf(tenant: DeliveryTenant): PublicDeliverySettings {
  const settings = deliverySettingsOf(tenant);
  const gate = publicOrderingState(tenant.account, {
    paused: tenant.settings?.onlineOrderingPaused === true,
    message: tenant.settings?.pauseMessage ?? null,
  }, aLaCapacite(tenant, 'online'));
  const available = !gate.paused && aLaCapacite(tenant, 'delivery') && settings.enabled
    && tenant.encaissement?.chargesEnabled === true && Boolean(tenant.encaissement.accountId);
  return { available, zones: available ? settings.zones : [], leadTimeMin: settings.leadTimeMin, paymentRequired: 'online' };
}

/** Appelé après la promotion, sous la compensation de réservation de commande. */
export function computeDeliveryForOrder(tenant: DeliveryTenant, dto: CreateOrder, subtotalAfterDiscount: number) {
  if (dto.type !== 'delivery') {
    if (dto.delivery) throw new BadRequestException('Adresse de livraison incompatible avec ce mode de remise');
    return null;
  }
  if (!dto.delivery || !dto.pickup) throw new BadRequestException('Adresse et créneau de livraison obligatoires');
  if (dto.channel !== 'online' || dto.payment.method !== 'online') {
    throw new BadRequestException('La livraison exige une commande avec paiement en ligne');
  }
  if (!publicDeliverySettingsOf(tenant).available) {
    throw new ConflictException('La livraison est momentanément indisponible. Vous pouvez choisir le retrait au restaurant.');
  }
  const quote = ordering.quoteDelivery(deliverySettingsOf(tenant), dto.delivery.address.postalCode, Money.fromCents(subtotalAfterDiscount));
  if (!quote.ok) throw new BadRequestException({ code: quote.error.code, message: quote.error.message });
  return {
    address: dto.delivery.address,
    instructions: dto.delivery.instructions ?? '',
    zoneId: quote.value.zoneId,
    zoneName: quote.value.zoneName,
    feeCents: quote.value.feeCents,
    estimatedMinutes: quote.value.estimatedMinutes,
    dispatchedAt: null,
    deliveredAt: null,
    driverName: null,
  };
}
