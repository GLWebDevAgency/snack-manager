/** Encaisser une vente existante : réseau direct, identité durable, jamais de nouvelle vente. */
import { CollectOrderPaymentSchema, type CollectOrderPayment } from '@sm/contracts';
import { mmss, mutateStoreItem, SmApiError, type KeyValueStore } from '@sm/client-core';
import { KEYS, type DayEntry, type PayMethod } from './pos-state';
import type { ServerOrderRow } from './service-state';

export function canCollectOrder(row: ServerOrderRow): boolean {
  return ['new', 'preparing', 'ready'].includes(row.status ?? '')
    && ['pickup', 'surplace', 'emporter'].includes(row.type ?? '')
    && row.payment?.method === 'counter' && row.payment.status === 'pending'
    && Number.isSafeInteger(row.totals?.total) && (row.totals?.total ?? -1) >= 0;
}

export const COLLECTION_DEADLINE_MS = 15_000;
/** A UI deadline is not a cancellation of the server operation. Keep its UUID. */
export function withCollectionDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Le serveur ne répond pas assez vite. Vérifiez cette commande avec la même référence, sans percevoir un second règlement.')), COLLECTION_DEADLINE_MS);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

type Recoveries = Record<string, CollectOrderPayment>;
function parseRecoveries(raw: string | null): Recoveries {
  if (raw === null) return {};
  try {
    const file: unknown = JSON.parse(raw);
    if (!file || typeof file !== 'object' || !('version' in file) || file.version !== 1 || !('orders' in file)) throw new Error();
    const entries = file.orders;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error();
    return Object.fromEntries(Object.entries(entries).map(([id, value]) => [id, CollectOrderPaymentSchema.parse(value)]));
  } catch {
    throw new Error('La récupération des encaissements est illisible. Faites vérifier ce poste avant de reprendre un règlement.');
  }
}
const serialize = (orders: Recoveries) => JSON.stringify({ version: 1, orders });

export async function collectionRecovery(store: KeyValueStore, orderId: string): Promise<CollectOrderPayment | null> {
  const entries = parseRecoveries(await store.getItem(KEYS.collectionRecovery));
  return Object.hasOwn(entries, orderId) ? entries[orderId] : null;
}

export async function pendingCollectionIds(store: KeyValueStore): Promise<string[]> {
  return Object.keys(parseRecoveries(await store.getItem(KEYS.collectionRecovery)));
}

/** Only this server code guarantees that this UUID has never recorded a payment. */
export function isCollectionRejected(error: unknown): boolean {
  return error instanceof SmApiError && error.status === 409 && !!error.body
    && typeof error.body === 'object' && 'code' in error.body && error.body.code === 'ORDER_COLLECTION_REJECTED';
}

export function isCollectedElsewhere(error: unknown): boolean {
  return error instanceof SmApiError && error.status === 409 && !!error.body
    && typeof error.body === 'object' && 'code' in error.body && error.body.code === 'ORDER_COLLECTION_ALREADY_COLLECTED';
}

export async function discardRejectedCollection(store: KeyValueStore, orderId: string, operationId: string): Promise<void> {
  await mutateStoreItem(store, KEYS.collectionRecovery, (raw) => {
    const entries = parseRecoveries(raw);
    if (entries[orderId]?.operationId === operationId) delete entries[orderId];
    return { value: serialize(entries), result: undefined };
  });
}

/** Le verrou commun au tenant empêche deux onglets d'écraser le premier geste. */
export async function prepareCollection(store: KeyValueStore, orderId: string, proposed: CollectOrderPayment): Promise<CollectOrderPayment> {
  const valid = CollectOrderPaymentSchema.parse(proposed);
  return mutateStoreItem(store, KEYS.collectionRecovery, (raw) => {
    const entries = parseRecoveries(raw);
    const operation = Object.hasOwn(entries, orderId) ? entries[orderId] : valid;
    return { value: serialize({ ...entries, [orderId]: operation }), result: operation };
  });
}

/** À appeler seulement après POST réussi, jamais sur GET : l'audit peut rester à réparer. */
export async function clearPaidCollection(store: KeyValueStore, row: ServerOrderRow, operationId?: string): Promise<void> {
  if (!['paid', 'refunded'].includes(row.payment?.status ?? '')) return;
  await mutateStoreItem(store, KEYS.collectionRecovery, (raw) => {
    const entries = parseRecoveries(raw);
    if (!operationId || entries[row._id]?.operationId === operationId) delete entries[row._id];
    return { value: serialize(entries), result: undefined };
  });
}

export async function collectExistingOrder(
  row: ServerOrderRow,
  operation: CollectOrderPayment,
  request: (id: string, input: CollectOrderPayment) => Promise<ServerOrderRow>,
  options: { resume?: boolean } = {},
): Promise<ServerOrderRow> {
  CollectOrderPaymentSchema.parse(operation);
  if (!options.resume && !canCollectOrder(row)) throw new Error('Cette commande ne peut pas être encaissée au comptoir. Vérifiez son état.');
  if (!options.resume && row.totals?.total !== operation.expectedTotalCents) throw new Error('Le montant a changé. Ne reprenez pas de règlement avant vérification.');
  if (operation.tender === 'cash' && operation.cashReceivedCents < operation.expectedTotalCents) throw new Error('Le montant reçu est insuffisant.');
  const result = await request(row._id, operation);
  if (!result || result._id !== row._id || !['paid', 'refunded'].includes(result.payment?.status ?? '')) {
    throw new Error('La confirmation du paiement est inconnue. Vérifiez cette commande sans percevoir une seconde fois.');
  }
  return result;
}

/** Journal de ce poste seulement : ne pas importer une vente web comme une nouvelle vente locale. */
export function reconcileCollectedJournal(entries: readonly DayEntry[], row: ServerOrderRow): DayEntry[] {
  if (!['paid', 'refunded'].includes(row.payment?.status ?? '')) return [...entries];
  const methods: Record<string, PayMethod> = { cash: 'especes', card: 'cb', meal_voucher: 'tr' };
  const method = methods[row.payment?.tender ?? ''];
  if (!method) return [...entries];
  return entries.map((entry) => (entry.serverId === row._id || entry.clientId === row.clientId)
    && !(entry.refunded && row.payment?.status !== 'refunded') ? {
    ...entry, paid: true, method,
    ...(row.payment?.status === 'refunded' ? { refunded: true as const } : {}),
    serverId: row._id, serverNumber: row.number,
    trackingToken: row.trackingToken ?? entry.trackingToken,
    total: (row.totals?.total ?? entry.total - (entry.discount ?? 0)) + (row.totals?.discount?.amount ?? entry.discount ?? 0),
    discount: row.totals?.discount?.amount ?? entry.discount,
    received: row.payment?.tender === 'cash' ? row.payment.cashReceived ?? undefined : undefined,
    change: row.payment?.tender === 'cash' ? row.payment.changeGiven ?? undefined : undefined,
  } : entry);
}

export function serviceAgeLabel(seconds: number): string {
  const elapsed = Math.max(0, Math.floor(seconds));
  if (elapsed < 3600) return mmss(elapsed);
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} h ${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')} min`;
  return `${Math.floor(elapsed / 86400)} j ${String(Math.floor(elapsed / 3600) % 24).padStart(2, '0')} h`;
}
