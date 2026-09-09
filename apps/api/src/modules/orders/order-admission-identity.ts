import { createHash } from 'node:crypto';
import type { CreateOrder } from '@sm/contracts';
import { recoveryNotFound, recoveryPayloadHash, sameRecoveryHash, type PublicRecoveryBinding } from './order-recovery';
import { assertCustomerOrderOwner, customerOrderOwnerFilter } from './customer-order-owner';

export type OrderAdmissionKind = 'public' | 'legacy' | 'staff';
/** Contexte serveur uniquement, jamais un champ accepté depuis un DTO public. */
export type OrderAdmissionBinding = PublicRecoveryBinding & Readonly<{ kind?: OrderAdmissionKind; channel?: CreateOrder['channel'] }>;

/** L'origine n'appartient PAS à la clé : tous les writers arbitrent la même identité. */
export function orderAdmissionId(tenantId: string, clientId: string): string {
  return createHash('sha256').update(JSON.stringify(['sm.order-admission.v1', tenantId, clientId])).digest('hex');
}

export function isPublicOrderAdmission(admission: { kind?: unknown }): boolean {
  // Les admissions C01 antérieures n'ont pas ce champ. null/inconnu ne sont
  // jamais une autorisation implicite, notamment pour un futur import historique.
  return admission.kind === undefined || admission.kind === 'public';
}

/**
 * L'appelant a déjà authentifié le tenant et validé le DTO. Cette empreinte
 * interne n'est PAS une autorisation : aucun endpoint public ne peut l'utiliser.
 * Elle n'inclut ni JWT ni caissier, afin de reprendre après renouvellement de session.
 * Un import historique, dont le corps initial est inconnu, ne passe pas ici.
 */
export function internalOrderAdmissionBinding(kind: 'legacy' | 'staff', tenantId: string, body: CreateOrder): OrderAdmissionBinding {
  if (!['legacy', 'staff'].includes(kind) || (kind === 'legacy' && body.channel !== 'online')
    || (kind === 'staff' && !['pos', 'phone'].includes(body.channel))) throw recoveryNotFound();
  return {
    version: 1, kind, channel: body.channel,
    proofHash: createHash('sha256').update(JSON.stringify(['sm.internal-order-admission.v1', kind, tenantId, body.clientId])).digest('hex'),
    payloadHash: recoveryPayloadHash(body),
  };
}

/** La famille staff ne permet pas d'échanger un ticket téléphone et un ticket caisse. */
export function orderAdmissionChannel(admission: { kind?: unknown; channel?: unknown }): CreateOrder['channel'] {
  if (isPublicOrderAdmission(admission) && (admission.channel === undefined || admission.channel === 'online')) return 'online';
  if (admission.kind === 'legacy' && admission.channel === 'online') return 'online';
  if (admission.kind === 'staff' && (admission.channel === 'pos' || admission.channel === 'phone')) return admission.channel;
  throw recoveryNotFound();
}

export function assertOrderAdmissionBinding(admission: { kind?: unknown; channel?: unknown; proofHash?: unknown; payloadHash?: unknown; customerOwner?: unknown }, binding: OrderAdmissionBinding): void {
  assertCustomerOrderOwner(admission.customerOwner, binding.customerOwner);
  const kind = admission.kind === undefined ? 'public' : admission.kind;
  if (kind !== (binding.kind ?? 'public') || orderAdmissionChannel(admission) !== orderAdmissionChannel(binding)
    || !sameRecoveryHash(admission.proofHash, binding.proofHash)
    || !sameRecoveryHash(admission.payloadHash, binding.payloadHash)) throw recoveryNotFound();
}

/** Jamais de preuve publique artificielle pour le legacy/POS/téléphone. */
export function publicRecoveryOfAdmission(binding: OrderAdmissionBinding): PublicRecoveryBinding | null {
  if (!isPublicOrderAdmission(binding)) return null;
  return { version: 1, proofHash: binding.proofHash, payloadHash: binding.payloadHash };
}

/** Le CAS vérifie aussi l'origine lue ; rétrocompatibilité explicite C01. */
export function orderAdmissionKindFilter(binding: OrderAdmissionBinding) {
  const owner = customerOrderOwnerFilter(binding.customerOwner);
  return isPublicOrderAdmission(binding)
    ? { ...owner, $and: [
      { $or: [{ kind: 'public' }, { kind: { $exists: false } }] },
      { $or: [{ channel: 'online' }, { channel: { $exists: false } }] },
    ] }
    : { ...owner, kind: binding.kind, channel: orderAdmissionChannel(binding) };
}
