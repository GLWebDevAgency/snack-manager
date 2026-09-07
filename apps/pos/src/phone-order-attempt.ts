/**
 * Journal C15-B. Le réseau reste fourni par le flux téléphone, jamais la file.
 *
 * Toujours injecter client.tenantStore : son verrou revalide l'appairage,
 * contrairement à un stockage brut. Enregistrer avant POST, conserver la
 * même tentative après timeout/404/4xx et attendre le reçu avant de vider le
 * ticket. Le corps reste disponible pour réparer le journal local ; appeler
 * archiveReceived seulement APRÈS cette réparation durable et le vidage sûr.
 *
 * Un HTTP 409, ou le contrat de reprise PUBLIC, ne prouve pas la clôture.
 * Seul le résultat authentifié staff lié à l'identité autorise un rejet.
 * Pas de TTL : une tentative incertaine ne devient jamais une nouvelle vente.
 */
import { CreateOrderSchema, OrderStatusSchema, StaffOrderAttemptResultSchema, StaffPhoneOrderAttemptRequestSchema, PublicOrderRejectionReasonSchema,
  type CreateOrder, type OrderStatus, type PublicOrderRejectionReason } from '@sm/contracts';
import { mutateStoreItem, uuid, type KeyValueStore } from '@sm/client-core';
import { KEYS } from './pos-state';

export const PHONE_ORDER_ATTEMPT_KEY = KEYS.phoneOrderAttempt;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type PhoneBody = CreateOrder & {
  channel: 'phone'; type: 'pickup';
  payment: { method: 'counter'; tender: null };
  pickup: { slot: string; customerName: string; customerPhone?: string };
};
type CounterTender = 'cash' | 'card' | 'meal_voucher';
export interface PhoneOrderReceipt {
  readonly tenantId: string;
  readonly clientId: string;
  readonly orderId: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly slot: string;
  readonly totalCents: number;
  readonly items: number;
  readonly trackingToken: string;
  readonly payment: {
    readonly method: 'counter'; readonly status: 'pending' | 'paid' | 'refunded';
    readonly tender: CounterTender | null;
    readonly cashReceived?: number; readonly changeGiven?: number;
  };
}
interface AttemptBase {
  readonly tenantId: string;
  readonly clientId: string;
  readonly createdAt: number;
  readonly body: DeepReadonly<PhoneBody>;
  /** UUID du brouillon de cet onglet. Une reprise ne possède pas son autre ticket. */
  readonly draftId?: string;
}
export type ReceivedPhoneOrderAttempt = AttemptBase & { readonly state: 'received'; readonly receipt: PhoneOrderReceipt };
export type RejectedPhoneOrderAttempt = AttemptBase & { readonly state: 'rejected'; readonly rejection: { reason: PublicOrderRejectionReason; message: string } };
export type PhoneOrderAttempt = (AttemptBase & { readonly state: 'prepared' | 'uncertain' }) | ReceivedPhoneOrderAttempt | RejectedPhoneOrderAttempt;
interface Journal { version: 1; tenantId: string; active: PhoneOrderAttempt | null; lastReceipt: PhoneOrderReceipt | null }

const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const BODY_KEYS = ['channel', 'type', 'lines', 'payment', 'pickup', 'note', 'promoCode'];
const invalid = () => new Error('La reprise de la commande téléphone est illisible ou incohérente. Ne ressaisissez pas cette commande avant vérification.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  return value as Record<string, unknown>;
}
function keys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const record = object(value);
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw invalid();
  return record;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()) throw invalid();
  return value;
}
function identity(value: unknown): string {
  const id = text(value, 24); if (!OBJECT_ID.test(id)) throw invalid(); return id;
}
function clientIdentity(value: unknown): string {
  const id = text(value, 36); if (!UUID_V4.test(id)) throw invalid(); return id;
}
function sameTenant(expected: string, actual: unknown): void {
  if (actual !== expected) throw new Error('La reprise appartient à un autre établissement. Reconnectez le poste sans réécrire ses données.');
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Validation structurelle seulement : aucune promesse de disponibilité locale. */
function phoneBody(input: unknown, clientId: string): PhoneBody {
  const candidate = keys(input, BODY_KEYS);
  keys(candidate.pickup, ['slot', 'customerName', 'customerPhone']);
  const payment = keys(candidate.payment, ['method', 'tender']);
  if (candidate.channel !== 'phone' || candidate.type !== 'pickup' || payment.method !== 'counter' || payment.tender !== null) throw invalid();
  if (!Array.isArray(candidate.lines)) throw invalid();
  for (const value of candidate.lines) {
    const line = keys(value, ['productId', 'variantKey', 'options', 'removed', 'note', 'qty']);
    if (line.options !== undefined) {
      if (!Array.isArray(line.options)) throw invalid();
      line.options.forEach((option) => keys(option, ['groupKey', 'choiceKey']));
    }
  }
  try {
    const parsed = StaffPhoneOrderAttemptRequestSchema.parse({ ...candidate, clientId }) as PhoneBody;
    // Les coordonnées sont bornées localement sans changer le contrat global.
    if (parsed.pickup.customerName.length > 80 || (parsed.pickup.customerPhone?.length ?? 0) > 32) throw invalid();
    return parsed;
  } catch { throw invalid(); }
}

function paymentReceipt(value: unknown): PhoneOrderReceipt['payment'] {
  const payment = object(value);
  if (payment.method !== 'counter' || !['pending', 'paid', 'refunded'].includes(String(payment.status))) throw invalid();
  const status = payment.status as PhoneOrderReceipt['payment']['status'];
  const tender = payment.tender ?? null;
  if (status === 'pending' ? tender !== null : !['cash', 'card', 'meal_voucher'].includes(String(tender))) throw invalid();
  const cash = payment.cashReceived == null ? undefined : integer(payment.cashReceived);
  const change = payment.changeGiven == null ? undefined : integer(payment.changeGiven);
  if (tender !== 'cash' && (cash !== undefined || change !== undefined)) throw invalid();
  return { method: 'counter', status, tender: tender as CounterTender | null,
    ...(cash === undefined ? {} : { cashReceived: cash }), ...(change === undefined ? {} : { changeGiven: change }) };
}

function parseReceipt(value: unknown, tenantId: string): PhoneOrderReceipt {
  const receipt = keys(value, ['tenantId', 'clientId', 'orderId', 'number', 'status', 'slot', 'totalCents', 'items', 'trackingToken', 'payment']);
  sameTenant(tenantId, receipt.tenantId);
  const slot = text(receipt.slot, 40);
  // Le schéma existant valide les vraies dates ISO, pas seulement une regex.
  try { CreateOrderSchema.shape.pickup.unwrap().shape.slot.parse(slot); } catch { throw invalid(); }
  const token = text(receipt.trackingToken, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw invalid();
  const payment = paymentReceipt(keys(receipt.payment, ['method', 'status', 'tender', 'cashReceived', 'changeGiven']));
  const totalCents = integer(receipt.totalCents);
  if (payment.status === 'paid' && payment.tender === 'cash' && payment.cashReceived !== undefined && payment.changeGiven !== undefined
    && payment.cashReceived - payment.changeGiven !== totalCents) throw invalid();
  const status = OrderStatusSchema.safeParse(receipt.status);
  if (!status.success) throw invalid();
  return { tenantId, clientId: clientIdentity(receipt.clientId), orderId: identity(receipt.orderId), number: integer(receipt.number, 1),
    status: status.data, slot, totalCents, items: integer(receipt.items, 1), trackingToken: token, payment };
}

function parseJournal(raw: string | null, tenantId: string): Journal {
  identity(tenantId);
  if (raw === null) return { version: 1, tenantId, active: null, lastReceipt: null };
  let file: Record<string, unknown>;
  try { file = keys(JSON.parse(raw), ['version', 'tenantId', 'active', 'lastReceipt']); } catch { throw invalid(); }
  if (file.version !== 1) throw invalid();
  sameTenant(tenantId, file.tenantId);
  const lastReceipt = file.lastReceipt === null ? null : parseReceipt(file.lastReceipt, tenantId);
  let active: PhoneOrderAttempt | null = null;
  if (file.active !== null) {
    const entry = keys(file.active, ['tenantId', 'clientId', 'createdAt', 'body', 'state', 'receipt', 'rejection', 'draftId']);
    sameTenant(tenantId, entry.tenantId);
    const clientId = clientIdentity(entry.clientId);
    const storedBody = keys(entry.body, [...BODY_KEYS, 'clientId']);
    if (storedBody.clientId !== clientId) throw invalid();
    const { clientId: _clientId, ...input } = storedBody;
    const body = phoneBody(input, clientId);
    const base = { tenantId, clientId, createdAt: integer(entry.createdAt), body,
      ...(entry.draftId === undefined ? {} : { draftId: clientIdentity(entry.draftId) }) };
    if (entry.state === 'received' && !Object.hasOwn(entry, 'rejection')) {
      const receipt = parseReceipt(entry.receipt, tenantId);
      if (receipt.clientId !== clientId || receipt.slot !== body.pickup.slot || receipt.items !== body.lines.reduce((sum, line) => sum + line.qty, 0)) throw invalid();
      active = { ...base, state: 'received', receipt };
    } else if (entry.state === 'rejected' && !Object.hasOwn(entry, 'receipt')) {
      const rejection = keys(entry.rejection, ['reason', 'message']);
      const reason = PublicOrderRejectionReasonSchema.safeParse(rejection.reason);
      if (!reason.success) throw invalid();
      active = { ...base, state: 'rejected', rejection: { reason: reason.data, message: text(rejection.message, 1000) } };
    } else if ((entry.state === 'prepared' || entry.state === 'uncertain') && !Object.hasOwn(entry, 'receipt') && !Object.hasOwn(entry, 'rejection')) {
      active = { ...base, state: entry.state };
    } else throw invalid();
  }
  return { version: 1, tenantId, active, lastReceipt };
}

async function mutate<T>(store: KeyValueStore, tenantId: string, change: (file: Journal) => T): Promise<T> {
  return mutateStoreItem(store, PHONE_ORDER_ATTEMPT_KEY, (raw) => {
    const file = parseJournal(raw, tenantId);
    const result = change(file);
    return { value: JSON.stringify(file), result };
  });
}
function current(file: Journal, clientId: string): PhoneOrderAttempt {
  clientIdentity(clientId);
  if (!file.active || file.active.clientId !== clientId) throw invalid();
  return file.active;
}

export async function readPhoneOrderAttempt(store: KeyValueStore, tenantId: string): Promise<PhoneOrderAttempt | null> {
  return freeze(parseJournal(await store.getItem(PHONE_ORDER_ATTEMPT_KEY), tenantId).active);
}
export async function readLastPhoneOrderReceipt(store: KeyValueStore, tenantId: string): Promise<PhoneOrderReceipt | null> {
  return freeze(parseJournal(await store.getItem(PHONE_ORDER_ATTEMPT_KEY), tenantId).lastReceipt);
}

/** Restauration locale avant réseau, toujours via le store de l'appairage. */
export async function readPhoneOrderJournal(store: KeyValueStore): Promise<DeepReadonly<Journal> | null> {
  const raw = await store.getItem(PHONE_ORDER_ATTEMPT_KEY);
  if (raw === null) return null;
  let tenantId: string;
  try { tenantId = identity(object(JSON.parse(raw)).tenantId); } catch { throw invalid(); }
  return freeze(parseJournal(raw, tenantId));
}

/** Alloue l'UUID UNE fois sous le verrou. Le résultat existant prime sur le brouillon proposé. */
export async function preparePhoneOrderAttempt(store: KeyValueStore, tenantId: string, input: unknown, draftId?: string): Promise<PhoneOrderAttempt> {
  // Parse avant le premier await : l'appelant peut déjà modifier son brouillon.
  const snapshot = phoneBody(input, '00000000-0000-4000-8000-000000000000');
  // Mongo sérialise les Date avec millisecondes. Figer dès l'acquisition la
  // même représentation dans le disque ET le futur POST, pas au rejeu.
  snapshot.pickup.slot = new Date(snapshot.pickup.slot).toISOString();
  if (draftId !== undefined) clientIdentity(draftId);
  return freeze(await mutate(store, tenantId, (file) => {
    if (file.active) return file.active;
    const clientId = clientIdentity(uuid());
    if (file.lastReceipt?.clientId === clientId) throw invalid();
    const active: PhoneOrderAttempt = { tenantId, clientId, createdAt: Date.now(), state: 'prepared', body: { ...snapshot, clientId },
      ...(draftId === undefined ? {} : { draftId }) };
    file.active = active;
    return active;
  }));
}

export async function markPhoneOrderUncertain(store: KeyValueStore, tenantId: string, clientId: string): Promise<PhoneOrderAttempt> {
  return freeze(await mutate(store, tenantId, (file) => {
    const attempt = current(file, clientId);
    if (attempt.state === 'prepared') file.active = { ...attempt, state: 'uncertain' };
    return file.active!;
  }));
}

/** Extrait seulement le reçu utile d'une commande obtenue par le port staff authentifié. */
function receiptFromOrder(value: unknown, attempt: PhoneOrderAttempt): PhoneOrderReceipt {
  const order = object(value);
  sameTenant(attempt.tenantId, order.tenantId);
  if (order.clientId !== attempt.clientId || order.channel !== 'phone' || order.type !== 'pickup') throw invalid();
  const pickup = object(order.pickup);
  if (pickup.slot !== attempt.body.pickup.slot || pickup.customerName !== attempt.body.pickup.customerName
    || (pickup.customerPhone ?? null) !== (attempt.body.pickup.customerPhone ?? null)
    || (order.note ?? null) !== (attempt.body.note ?? null)) throw invalid();
  if (!Array.isArray(order.lines) || order.lines.length !== attempt.body.lines.length) throw invalid();
  order.lines.forEach((value, index) => {
    const line = object(value);
    const expected = attempt.body.lines[index]!;
    if (line.productId !== expected.productId || (line.variantKey ?? null) !== (expected.variantKey ?? null)
      || line.qty !== expected.qty || (line.note ?? null) !== (expected.note ?? null)
      || JSON.stringify(line.removed) !== JSON.stringify(expected.removed) || !Array.isArray(line.options)) throw invalid();
    const options = line.options.map((value) => { const option = object(value); return { groupKey: option.groupKey, choiceKey: option.choiceKey }; });
    if (JSON.stringify(options) !== JSON.stringify(expected.options)) throw invalid();
  });
  return parseReceipt({ tenantId: order.tenantId, clientId: order.clientId, orderId: order._id, number: order.number,
    status: order.status, slot: pickup.slot, totalCents: object(order.totals).total,
    items: attempt.body.lines.reduce((sum, line) => sum + line.qty, 0), trackingToken: order.trackingToken,
    payment: paymentReceipt(order.payment) }, attempt.tenantId);
}

/** Une réponse HTTP réussie seule ne suffit pas : identité ET snapshot métier sont vérifiés. */
export async function recordPhoneOrderReceipt(store: KeyValueStore, tenantId: string, clientId: string, serverOrder: unknown): Promise<ReceivedPhoneOrderAttempt> {
  // Détacher la réponse du caller avant attente du verrou, sans sérialiser de secrets sur disque.
  let snapshot: unknown;
  try { snapshot = JSON.parse(JSON.stringify(serverOrder)); } catch { throw invalid(); }
  return freeze(await mutate(store, tenantId, (file) => {
    const attempt = current(file, clientId);
    if (attempt.state === 'rejected') throw invalid();
    const receipt = receiptFromOrder(snapshot, attempt);
    if (attempt.state === 'received') {
      if (attempt.receipt.orderId !== receipt.orderId || attempt.receipt.number !== receipt.number
        || attempt.receipt.trackingToken !== receipt.trackingToken) throw invalid();
      // Première preuve immuable ; tout statut courant se relit sur le serveur.
      return attempt;
    }
    const received: ReceivedPhoneOrderAttempt = { ...attempt, state: 'received', receipt };
    file.active = received;
    return received;
  }));
}

/** Appel explicite après journal durable. Ne libère jamais prepared/uncertain. */
export async function archiveReceivedPhoneOrderAttempt(store: KeyValueStore, tenantId: string, clientId: string): Promise<PhoneOrderReceipt> {
  return freeze(await mutate(store, tenantId, (file) => {
    if (!file.active && file.lastReceipt?.clientId === clientId) return file.lastReceipt;
    const attempt = current(file, clientId);
    if (attempt.state !== 'received') throw invalid();
    file.lastReceipt = attempt.receipt;
    file.active = null;
    return attempt.receipt;
  }));
}

/** Résultat de /orders/recovery ou /orders/abandon, jamais une erreur HTTP brute. */
export async function recordPhoneOrderResult(store: KeyValueStore, tenantId: string, clientId: string, value: unknown): Promise<PhoneOrderAttempt> {
  const parsed = StaffOrderAttemptResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.clientId !== clientId) throw invalid();
  const result = parsed.data;
  if (result.state === 'created') return recordPhoneOrderReceipt(store, tenantId, clientId, result.order);
  return freeze(await mutate(store, tenantId, (file) => {
    const attempt = current(file, clientId);
    if (result.state === 'pending') return attempt;
    if (attempt.state === 'received') throw invalid();
    const rejection = { reason: result.reason, message: text(result.message, 1000) };
    file.active = { ...attempt, state: 'rejected', rejection };
    return file.active;
  }));
}

/** Explicitement après lecture du rejet, pour corriger le créneau ou le panier. */
export async function releaseRejectedPhoneOrderAttempt(store: KeyValueStore, tenantId: string, clientId: string): Promise<void> {
  await mutate(store, tenantId, (file) => {
    if (current(file, clientId).state !== 'rejected') throw invalid();
    file.active = null;
  });
}

/** S'exécute sous le verrou de purge avec le store BRUT fourni par ce verrou. */
export async function assertPhoneOrderPurgeSafe(store: KeyValueStore): Promise<void> {
  const raw = await store.getItem(PHONE_ORDER_ATTEMPT_KEY);
  if (raw === null) return;
  let tenantId: string;
  try { tenantId = identity(object(JSON.parse(raw)).tenantId); } catch { throw invalid(); }
  if (parseJournal(raw, tenantId).active !== null) {
    throw new Error('Une commande téléphone reste à vérifier ou à enregistrer dans le journal. Le poste ne peut pas être désappairé sans cette vérification.');
  }
}
