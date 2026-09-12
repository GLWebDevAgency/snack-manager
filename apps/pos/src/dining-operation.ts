/** Intentions de salle : confirmation réseau, référence conservée après toute réponse incertaine. */
import { DiningAddOrderSchema, DiningServeSchema, DiningSessionOpenSchema, DiningSessionOperationSchema, DiningSessionTransferSchema,
  type DiningAddOrder, type DiningServe, type DiningSessionOpen, type DiningSessionOperation, type DiningSessionTransfer } from '@sm/contracts';
import { mutateStoreItem, requireCrossContextStoreLock, SmApiError, type KeyValueStore } from '@sm/client-core';
import { KEYS } from './pos-state';

export type DiningAction =
  | { action: 'open'; body: DiningSessionOpen }
  | { action: 'transfer'; sessionId: string; body: DiningSessionTransfer }
  | { action: 'close'; sessionId: string; body: DiningSessionOperation }
  | { action: 'serve'; sessionId: string; orderId: string; body: DiningServe }
  | { action: 'order'; sessionId: string; draftId: string; body: DiningAddOrder };

export type DiningOperation = DiningAction & { ownerId: string };

/** Un autre onglet ne peut pas rendre revendable le brouillon déjà envoyé ici. */
export function observeDiningOperation(previous: DiningOperation | null, observed: DiningOperation | null, draftId: string): DiningOperation | null {
  if (previous?.action === 'order' && previous.draftId === draftId && observed?.body.operationId !== previous.body.operationId) return previous;
  return observed;
}

/** Repère local uniquement ; l'API vérifie signature, révocation et droits. */
export function diningOwner(token: string): string | null {
  try {
    // Aucun Buffer/atob requis : la même lecture fonctionne dans Hermes et le navigateur.
    const encoded = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (!encoded.length || encoded.length > 16_384 || !/^[A-Za-z0-9+/]+$/.test(encoded)) return null;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, value = 0, decoded = '';
    for (const char of encoded) {
      value = (value << 6) | alphabet.indexOf(char); bits += 6;
      if (bits >= 8) { bits -= 8; decoded += `%${((value >> bits) & 255).toString(16).padStart(2, '0')}`; value &= (1 << bits) - 1; }
    }
    const payload = JSON.parse(decodeURIComponent(decoded));
    return typeof payload.sub === 'string' && payload.sub.length > 0 && typeof payload.tenantId === 'string' && payload.tenantId.length > 0
      ? `${payload.tenantId}:${payload.sub}` : null;
  } catch { return null; }
}

export function parseDiningOperation(raw: string | null): DiningOperation | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value?.version !== 1 || !value.operation || typeof value.operation !== 'object') throw new Error();
    const op = value.operation as Record<string, unknown>;
    if (typeof op.ownerId !== 'string' || !op.ownerId.length || op.ownerId.length > 200) throw new Error();
    const ownerId = op.ownerId;
    if (op.action === 'open') return { action: 'open', ownerId, body: DiningSessionOpenSchema.parse(op.body) };
    if (typeof op.sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(op.sessionId)) throw new Error();
    if (op.action === 'transfer') return { action: 'transfer', ownerId, sessionId: op.sessionId, body: DiningSessionTransferSchema.parse(op.body) };
    if (op.action === 'close') return { action: 'close', ownerId, sessionId: op.sessionId, body: DiningSessionOperationSchema.parse(op.body) };
    if (op.action === 'order' && typeof op.draftId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(op.draftId)) {
      return { action: 'order', ownerId, sessionId: op.sessionId, draftId: op.draftId, body: DiningAddOrderSchema.parse(op.body) };
    }
    if (op.action === 'serve' && typeof op.orderId === 'string' && /^[a-f0-9]{24}$/i.test(op.orderId)) return { action: 'serve', ownerId, sessionId: op.sessionId, orderId: op.orderId, body: DiningServeSchema.parse(op.body) };
    throw new Error();
  } catch {
    throw new Error('La référence de salle est illisible. Conservez le stockage de ce poste et faites vérifier l’opération avant de continuer.');
  }
}

export const readDiningOperation = async (store: KeyValueStore) => parseDiningOperation(await store.getItem(KEYS.diningOperation));

export async function prepareDiningOperation(store: KeyValueStore, proposed: DiningOperation): Promise<DiningOperation> {
  // AsyncStorage est mono-processus ; le navigateur doit aussi sérialiser ses onglets.
  if (typeof document !== 'undefined') {
    try { requireCrossContextStoreLock(); }
    catch { throw new Error('Ce navigateur ne peut pas sécuriser les opérations de salle. Utilisez un navigateur compatible sur une connexion sécurisée.'); }
  }
  const valid = parseDiningOperation(JSON.stringify({ version: 1, operation: proposed }))!;
  return mutateStoreItem(store, KEYS.diningOperation, (raw) => {
    const pending = parseDiningOperation(raw);
    if (pending && JSON.stringify(pending) !== JSON.stringify(valid)) {
      throw new Error('Une opération de salle reste à vérifier. Reprenez-la avant de démarrer une autre opération.');
    }
    return { value: JSON.stringify({ version: 1, operation: pending ?? valid }), result: pending ?? valid };
  });
}

/** Appelé uniquement après réponse confirmée et journal local durable, ou rejet serveur enregistré. */
export async function clearDiningOperation(store: KeyValueStore, operationId: string): Promise<void> {
  await mutateStoreItem(store, KEYS.diningOperation, (raw) => {
    const pending = parseDiningOperation(raw);
    return { value: pending?.body.operationId === operationId ? null : raw, result: undefined };
  });
}

export function diningOperationPath(operation: DiningOperation): string {
  if (operation.action === 'open') return '/dining/sessions';
  if (operation.action === 'serve') return `/dining/sessions/${operation.sessionId}/orders/${operation.orderId}/serve`;
  const suffix = operation.action === 'order' ? 'orders' : operation.action;
  return `/dining/sessions/${operation.sessionId}/${suffix}`;
}

export function diningOperationRejected(error: unknown, operationId: string): boolean {
  return error instanceof SmApiError && typeof error.body === 'object' && error.body !== null
    && 'code' in error.body && error.body.code === 'DINING_OPERATION_REJECTED'
    && 'operationId' in error.body && error.body.operationId === operationId;
}

export async function assertDiningPurgeSafe(store: KeyValueStore): Promise<void> {
  if (await readDiningOperation(store)) throw new Error('Une opération de salle reste à vérifier. Son identité ne peut pas être effacée ni le poste désappairé.');
}

export async function withDiningDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Résultat encore inconnu. Vérifiez cette opération avec la même référence, sans la recréer.')), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}
