/** Réservation réseau directe : aucun port de file offline ni de perception. */
import { requireCrossContextStoreLock, type KeyValueStore } from '@sm/client-core';
import {
  archiveReceivedPhoneOrderAttempt, markPhoneOrderUncertain, preparePhoneOrderAttempt,
  readPhoneOrderAttempt, recordPhoneOrderReceipt, recordPhoneOrderResult, releaseRejectedPhoneOrderAttempt,
  type PhoneOrderAttempt, type ReceivedPhoneOrderAttempt,
} from './phone-order-attempt';

export const PHONE_ORDER_DEADLINE_MS = 15_000;
export async function withPhoneOrderDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('La confirmation est inconnue. Reprenez cette commande avec la même référence, sans encaisser ni la ressaisir.')), PHONE_ORDER_DEADLINE_MS);
  });
  try { return await Promise.race([work, deadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

interface PhoneOrderPorts {
  store: KeyValueStore;
  tenantId: string;
  /** POST staff authentifié seulement. Aucun cache, retry caché ni enqueue. */
  request: (path: string, body: unknown) => Promise<unknown>;
  assertReady: () => void;
}

export function createPhoneOrderFlow({ store, tenantId, request, assertReady }: PhoneOrderPorts) {
  // Ce verrou ne bloque PAS le verrou court du stockage ni le reste du POS.
  // En cas de timeout serveur, la même identité durable reste l'autorité.
  const locked = async <T>(action: () => Promise<T>): Promise<T> => requireCrossContextStoreLock().request(
    `sm.pos.phone-operation.v1:${tenantId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('Cette commande est déjà en cours de vérification sur un autre onglet. Patientez puis vérifiez son état.');
      return action();
    });
  const active = async (): Promise<PhoneOrderAttempt> => {
    const attempt = await readPhoneOrderAttempt(store, tenantId);
    if (!attempt) throw new Error('Cette tentative a déjà été traitée. Actualisez son état avant toute nouvelle commande.');
    return attempt;
  };
  const send = async (attempt: PhoneOrderAttempt): Promise<PhoneOrderAttempt> => {
    if (attempt.state === 'received' || attempt.state === 'rejected') return attempt;
    assertReady();
    await markPhoneOrderUncertain(store, tenantId, attempt.clientId);
    assertReady();
    const response = await withPhoneOrderDeadline(request('/orders', attempt.body));
    return recordPhoneOrderReceipt(store, tenantId, attempt.clientId, response);
  };
  return {
    submit: (body: unknown, draftId: string) => locked(async () => {
      assertReady();
      const attempt = await preparePhoneOrderAttempt(store, tenantId, body, draftId);
      // Ne pas envoyer le ticket A depuis le bouton de validation du ticket B.
      if (attempt.draftId !== draftId) return attempt;
      return send(attempt);
    }),
    resume: () => locked(async () => {
      const attempt = await active();
      if (attempt.state === 'received' || attempt.state === 'rejected') return attempt;
      assertReady();
      const result = await withPhoneOrderDeadline(request('/orders/recovery', attempt.body));
      const observed = await recordPhoneOrderResult(store, tenantId, attempt.clientId, result);
      // Une reprise explicite peut renvoyer LE MÊME corps si l'admission reste
      // pending. 404, erreur ou réponse malformée n'atteignent jamais ce chemin.
      return send(observed);
    }),
    abandon: () => locked(async () => {
      const attempt = await active();
      if (attempt.state === 'received' || attempt.state === 'rejected') return attempt;
      assertReady();
      const result = await withPhoneOrderDeadline(request('/orders/abandon', attempt.body));
      return recordPhoneOrderResult(store, tenantId, attempt.clientId, result);
    }),
    releaseRejected: () => locked(async () => {
      const attempt = await active();
      await releaseRejectedPhoneOrderAttempt(store, tenantId, attempt.clientId);
    }),
    finish: (repair: (attempt: ReceivedPhoneOrderAttempt) => Promise<void>) => locked(async () => {
      const attempt = await active();
      if (attempt.state !== 'received') throw new Error('Le serveur doit confirmer la commande avant de terminer.');
      // Reçu -> journal local durable -> vidage du bon brouillon -> archivage.
      // Une panne à n'importe quelle étape conserve le reçu rejouable.
      await repair(attempt);
      return archiveReceivedPhoneOrderAttempt(store, tenantId, attempt.clientId);
    }),
  };
}
