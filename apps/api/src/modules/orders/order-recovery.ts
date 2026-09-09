import { createHash, timingSafeEqual } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PublicOrderRecoveryReceiptSchema, type CreatePublicOrder, type PublicOrderRecoveryReceipt } from '@sm/contracts';
import type { Order } from '@sm/db';
import { assertCustomerOrderOwner, type CustomerOrderOwner } from './customer-order-owner';

export type PublicRecoveryBinding = Readonly<{ version: 1; proofHash: string; payloadHash: string; validationOwner?: string; customerOwner?: CustomerOrderOwner }>;

export function recoveryNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ORDER_RECOVERY_NOT_FOUND', message: 'Commande introuvable' });
}

export function recoveryProofHash(tenantId: string, clientId: string, proof: string): string {
  return createHash('sha256').update(JSON.stringify(['sm.public-order-recovery.v1', tenantId, clientId, proof])).digest('hex');
}

export function publicRecoveryBinding(tenantId: string, body: CreatePublicOrder, customerOwner?: CustomerOrderOwner): PublicRecoveryBinding | undefined {
  if (!body.recoveryProof) return undefined;
  const { recoveryProof, turnstileToken: _transient, ...business } = body;
  const normalized = { ...business, fulfillment: body.fulfillment ?? 'pickup' };
  return {
    version: 1,
    proofHash: recoveryProofHash(tenantId, body.clientId, recoveryProof),
    payloadHash: recoveryPayloadHash(normalized),
    ...(customerOwner ? { customerOwner: { ...customerOwner } } : {}),
  };
}

/** Même canonisation pour toutes les admissions, sans confondre leurs preuves. */
export function recoveryPayloadHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Trie uniquement les clés d'objet, sans changer l'ordre métier des lignes/options. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function sameRecoveryHash(left: unknown, right: string): boolean {
  return typeof left === 'string' && /^[a-f0-9]{64}$/.test(left)
    && /^[a-f0-9]{64}$/.test(right)
    && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** Utilisé avant CHAQUE retour idempotent, y compris une collision Mongo 11000. */
export function assertPublicRecoveryReplay(order: Pick<Order, 'channel' | 'publicRecovery'> & { customerOwner?: unknown }, binding?: PublicRecoveryBinding): void {
  assertCustomerOrderOwner(order.customerOwner, binding?.customerOwner);
  const stored = order.publicRecovery;
  if (!stored && !binding) return; // comportement historique, aucune adoption
  if (order.channel !== 'online' || !stored || !binding || !sameRecoveryHash(stored.proofHash, binding.proofHash)) throw recoveryNotFound();
  if (!sameRecoveryHash(stored.payloadHash, binding.payloadHash)) {
    throw new ConflictException({ code: 'ORDER_ATTEMPT_PAYLOAD_CONFLICT', message: 'Le corps de cette tentative a changé. Reprenez la commande initiale.' });
  }
}

export function recoveryReceipt(order: Order & { _id: unknown }): PublicOrderRecoveryReceipt {
  if (!order.trackingToken || order.channel !== 'online' || !['pickup', 'delivery'].includes(order.type)) throw recoveryNotFound();
  return PublicOrderRecoveryReceiptSchema.parse({
    _id: String(order._id), number: order.number, status: order.status, type: order.type,
    trackingToken: order.trackingToken,
    payment: { method: order.payment.method, status: order.payment.status },
    totals: { total: order.totals.total },
    pickup: order.pickup?.slot ? { slot: new Date(order.pickup.slot).toISOString() } : null,
  });
}
