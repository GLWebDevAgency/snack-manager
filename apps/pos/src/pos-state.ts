/**
 * TOUT CE QUE LA CAISSE PERSISTE — et donc tout ce qu'il faut effacer quand
 * l'appareil change d'établissement.
 *
 * Le désappairage n'effaçait que l'appairage, la session et la file : le
 * journal local et les tickets mis en attente restaient, et ressortaient
 * après ré-appairage chez un AUTRE commerçant. Le récapitulatif du poste
 * mélangeait deux restaurants, et un ticket parqué chez A se rappelait chez B
 * avec ses lignes et le nom de son client.
 *
 * La purge itère sur cette table entière : une clé ajoutée ici y entre
 * d'office, sans qu'on ait à penser à la lister ailleurs.
 */
export const KEYS = {
  session: 'sm.pos.session.v1',
  /** Appairage de l'appareil — survit à la déconnexion de l'équipier. */
  device: 'sm.pos.device.v1',
  parked: 'sm.pos.parked.v1',
  dayLog: 'sm.pos.daylog.v1',
  /** Ancienne borne obsolète, conservée uniquement pour la purge/migration. */
  serviceStart: 'sm.pos.servicestart.v1',
  /** UUID opaque seulement ; permet de redériver un QR après réponse perdue. */
  loyaltyEnrollmentRecovery: 'sm.pos.loyalty-enrollment-recovery.v1',
  /** Encaissements directs dont la réponse peut être perdue, purgés à l'appairage. */
  collectionRecovery: 'sm.pos.collection-recovery.v1',
} as const;

/**
 * État métier du poste : modes de service, journal local, tickets en
 * attente, construction du corps de commande.
 *
 * Tout ce qui doit survivre à un rechargement (tickets parqués, journal local,
 * session) passe par le stockage clé/valeur du noyau partagé — le
 * même que la file offline.
 */
import {
  mutateStoreItem,
  uuid,
  type CartLine,
  type KeyValueStore,
} from '@sm/client-core';
import { PAYMENT_DUE_LABEL, PAYMENT_TENDER_LABELS, type PaymentTender } from '@sm/contracts';
import type { LoyaltyTicketState } from './loyalty-state';

export type Mode = 'surplace' | 'emporter' | 'tel';

export const MODE_LABEL: Record<Mode, string> = {
  surplace: 'Sur place',
  emporter: 'À emporter',
  tel: 'Téléphone',
};

export type PayMethod = 'cb' | 'especes' | 'tr' | 'retrait';

export const PAY_LABEL: Record<PayMethod, string> = {
  cb: PAYMENT_TENDER_LABELS.card,
  especes: PAYMENT_TENDER_LABELS.cash,
  tr: PAYMENT_TENDER_LABELS.meal_voucher,
  retrait: PAYMENT_DUE_LABEL,
};

/**
 * Bouton de la caisse → moyen réellement encaissé, tel que l'API l'enregistre.
 *
 * `retrait` reste `null` : rien n'est perçu, la commande part « à encaisser ».
 * Sans cette traduction, l'API recevait `method: 'counter'` pour les trois
 * boutons et enregistrait tout en attente — le récapitulatif local était donc
 * faux même quand l'écran affichait « Payé (carte bancaire) ».
 */
export const PAY_TENDER: Record<PayMethod, PaymentTender | null> = {
  cb: 'card',
  especes: 'cash',
  tr: 'meal_voucher',
  retrait: null,
};

/** Une commande envoyée pendant le service (journal local du poste). */
export interface DayEntry {
  clientId: string;
  /** Numéro affiché immédiatement, avant confirmation serveur. */
  localNumber: number;
  serverId: string | null;
  serverNumber: number | null;
  /** Jeton de suivi renvoyé par l'API — requis pour le ticket et le lien client. */
  trackingToken?: string | null;
  mode: Mode;
  method: PayMethod;
  paid: boolean;
  /** Centimes — calcul local, le serveur fait autorité une fois synchronisé. */
  total: number;
  items: number;
  customerName?: string | null;
  /** Remise appliquée après coup (centimes). */
  discount?: number;
  /** Encaissement espèces : reçu et rendu, en centimes. */
  received?: number;
  change?: number;
  /** Aucun identifiant client : uniquement l'état public relu par clientId. */
  loyalty?: LoyaltyTicketState;
  at: number;
}

export interface ParkedTicket {
  code: string;
  lines: CartLine[];
  mode: Mode;
  customerName: string;
  customerPhone: string;
  slot: string | null;
  note: string;
  at: number;
}

/**
 * Les coordonnées de retrait n'existent que sur un ticket téléphone. Cette
 * frontière empêche un changement de mode ou une vieille donnée locale de les
 * associer ensuite à une carte fidélité au comptoir.
 */
export function customerFieldsForMode(
  mode: Mode,
  customerName: string,
  customerPhone: string,
  slot: string | null,
): Pick<ParkedTicket, 'customerName' | 'customerPhone' | 'slot'> {
  return mode === 'tel'
    ? { customerName, customerPhone, slot }
    : { customerName: '', customerPhone: '', slot: null };
}

/** Élimine les anciennes copies d'UUID membre/opération du journal local. */
export function minimizeDayEntry(entry: DayEntry): DayEntry {
  const { loyalty, ...publicEntry } = entry;
  if (!loyalty) return publicEntry;
  const state = ['awaiting_order', 'queued', 'credited', 'failed'].includes(loyalty.state)
    ? loyalty.state
    : 'failed';
  const creditedUnits =
    typeof loyalty.creditedUnits === 'number' &&
    Number.isSafeInteger(loyalty.creditedUnits) &&
    loyalty.creditedUnits >= 0
      ? loyalty.creditedUnits
      : undefined;
  return {
    ...publicEntry,
    loyalty: {
      state,
      ...(creditedUnits === undefined ? null : { creditedUnits }),
    },
  };
}

/** Corrige aussi les tickets persistés par une ancienne version de la caisse. */
export function minimizeParkedTicket(
  ticket: ParkedTicket & { loyaltyMemberId?: unknown },
): ParkedTicket {
  const { loyaltyMemberId: _discarded, ...publicTicket } = ticket;
  return {
    ...publicTicket,
    ...customerFieldsForMode(
      ticket.mode,
      ticket.customerName,
      ticket.customerPhone,
      ticket.slot,
    ),
  };
}

// ─── Persistance ───

export async function loadJson<T>(
  store: KeyValueStore,
  key: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJson(
  store: KeyValueStore,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await store.setItem(key, JSON.stringify(value));
  } catch {
    /* quota : on ne bloque jamais le service pour un échec d'écriture */
  }
}

/**
 * Écrivain UNIQUE du journal local.
 *
 * La FIFO locale ordonne les callbacks d'une instance ; `mutateStoreItem`
 * arbitre toutes les instances sous le verrou partagé. Chaque commit repart du
 * snapshot DURABLE courant, jamais de la seule mémoire React. La génération
 * change au reset et empêche donc un autre onglet de ressusciter son ancienne
 * copie ; la révision fait échouer un reset si le journal montré a changé.
 */
export const DAY_LOG_FILE_VERSION = 2 as const;

export interface DayLogFile {
  version: typeof DAY_LOG_FILE_VERSION;
  day: string;
  /** Époque durable : incrémentée uniquement par un reset/changement de jour. */
  generation: number;
  /** CAS durable : incrémenté à chaque mutation réussie. */
  revision: number;
  entries: DayEntry[];
}

export interface DayLogSnapshot {
  day: string;
  generation: number;
  revision: number;
  /** Protège aussi contre une ancienne version qui écrirait sans révision. */
  content: string;
}

export class DayLogChangedError extends Error {
  constructor() {
    super('Le journal a changé depuis l’ouverture du récapitulatif');
    this.name = 'DayLogChangedError';
  }
}

function safeCounter(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : 0;
}

/** Lit aussi l'ancien `{ day, entries }` et le promeut au premier commit. */
export function normalizeDayLogFile(
  value: unknown,
  fallbackDay = serviceDay(),
): DayLogFile {
  const candidate =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Partial<DayLogFile>)
      : null;
  return {
    version: DAY_LOG_FILE_VERSION,
    day:
      typeof candidate?.day === 'string' && candidate.day.length > 0
        ? candidate.day
        : fallbackDay,
    generation: safeCounter(candidate?.generation),
    revision: safeCounter(candidate?.revision),
    entries: Array.isArray(candidate?.entries)
      ? (candidate.entries as DayEntry[]).map(minimizeDayEntry)
      : [],
  };
}

function dayLogFromRaw(raw: string | null, fallbackDay: string): DayLogFile {
  if (!raw) return normalizeDayLogFile(null, fallbackDay);
  try {
    return normalizeDayLogFile(JSON.parse(raw), fallbackDay);
  } catch {
    return normalizeDayLogFile(null, fallbackDay);
  }
}

function snapshotOf(file: DayLogFile): DayLogSnapshot {
  return {
    day: file.day,
    generation: file.generation,
    revision: file.revision,
    content: JSON.stringify(file.entries),
  };
}

function sameSnapshot(file: DayLogFile, expected: DayLogSnapshot): boolean {
  return (
    file.day === expected.day &&
    file.generation === expected.generation &&
    file.revision === expected.revision &&
    JSON.stringify(file.entries) === expected.content
  );
}

function uniqueDayEntries(entries: readonly DayEntry[]): DayEntry[] {
  const positions = new Map<string, number>();
  const unique: DayEntry[] = [];
  for (const entry of entries) {
    const previous = positions.get(entry.clientId);
    if (previous === undefined) {
      positions.set(entry.clientId, unique.length);
      unique.push(entry);
    } else {
      unique[previous] = entry;
    }
  }
  return unique;
}

type DayLogTransform = (current: readonly DayEntry[]) => DayEntry[];

export interface DayLogWriter {
  hydrate(file: DayLogFile): DayLogSnapshot;
  refresh(
    apply: (entries: DayEntry[]) => void,
    day?: string,
  ): Promise<DayLogSnapshot>;
  snapshot(): DayLogSnapshot;
  /** Révision locale utilisée uniquement pour invalider les callbacks pré-reset. */
  revision(): number;
  commit(
    read: () => readonly DayEntry[],
    transform: DayLogTransform,
    apply: (entries: DayEntry[]) => void,
    expectedRevision?: number,
    day?: string,
  ): Promise<boolean>;
  reset(
    apply: (entries: []) => void,
    day?: string,
    validate?: () => void,
    expectedSnapshot?: DayLogSnapshot,
  ): Promise<void>;
}

export function createDayLogWriter(
  store: KeyValueStore,
): DayLogWriter {
  let tail: Promise<void> = Promise.resolve();
  let localRevision = 0;
  let observed = normalizeDayLogFile(null);
  let pending: Array<{
    day: string;
    generation: number;
    transform: DayLogTransform;
  }> = [];
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const targetGeneration = (file: DayLogFile, day: string) =>
    file.day === day ? file.generation : file.generation + 1;

  const withPending = (file: DayLogFile, day: string): DayEntry[] => {
    const generation = targetGeneration(file, day);
    let entries: DayEntry[] = file.day === day ? file.entries : [];
    for (const mutation of pending) {
      if (mutation.day !== day || mutation.generation !== generation) continue;
      entries = uniqueDayEntries(mutation.transform(entries));
    }
    return entries;
  };

  return {
    hydrate(file) {
      observed = normalizeDayLogFile(file, file.day);
      return snapshotOf(observed);
    },
    refresh(apply, day = serviceDay()) {
      return enqueue(async () => {
        const file = dayLogFromRaw(await store.getItem(KEYS.dayLog), day);
        observed = file;
        apply(withPending(file, day));
        return snapshotOf(file);
      });
    },
    snapshot: () => snapshotOf(observed),
    revision: () => localRevision,
    commit(
      _read,
      transform,
      apply,
      expectedRevision = localRevision,
      day = serviceDay(),
    ) {
      return enqueue(async () => {
        if (expectedRevision !== localRevision) return false;
        let attemptedGeneration: number | null = null;
        try {
          const file = await mutateStoreItem(
            store,
            KEYS.dayLog,
            (raw) => {
              const durable = dayLogFromRaw(raw, day);
              const generation = targetGeneration(durable, day);
              attemptedGeneration = generation;
              const nextEntries = uniqueDayEntries(
                transform(withPending(durable, day)),
              );
              const next: DayLogFile = {
                version: DAY_LOG_FILE_VERSION,
                day,
                generation,
                revision: durable.revision + 1,
                entries: nextEntries,
              };
              return { value: JSON.stringify(next), result: next };
            },
          );
          pending = pending.filter(
            (mutation) =>
              mutation.day !== file.day ||
              mutation.generation !== file.generation,
          );
          observed = file;
          apply(file.entries);
          return true;
        } catch (error) {
          const generation =
            attemptedGeneration ??
            (observed.day === day
              ? observed.generation
              : observed.generation + 1);
          pending.push({ day, generation, transform });
          throw error;
        }
      });
    },
    reset(
      apply,
      day = serviceDay(),
      validate,
      expectedSnapshot = snapshotOf(observed),
    ) {
      return enqueue(async () => {
        const file = await mutateStoreItem(store, KEYS.dayLog, (raw) => {
          const durable = dayLogFromRaw(raw, day);
          if (!sameSnapshot(durable, expectedSnapshot)) {
            throw new DayLogChangedError();
          }
          // Les mutations locales déjà parties ont fini avant cette tâche ;
          // les autres onglets sont exclus par le verrou jusqu'au setItem.
          validate?.();
          const next: DayLogFile = {
            version: DAY_LOG_FILE_VERSION,
            day,
            generation: durable.generation + 1,
            revision: durable.revision + 1,
            entries: [],
          };
          return { value: JSON.stringify(next), result: next };
        });
        // Si le stockage refuse, aucune de ces mutations mémoire n'a lieu.
        localRevision += 1;
        pending = [];
        observed = file;
        apply([]);
      });
    },
  };
}

/** Jour de service au sens du restaurant (fuseau du poste). */
export function serviceDay(at = new Date()): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code court d'un ticket en attente — lisible à voix haute au comptoir. */
export function parkCode(): string {
  let out = 'P';
  for (let i = 0; i < 3; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)] ?? 'X';
  }
  return out;
}

// ─── Créneaux de retrait ───

export interface Slot {
  key: string;
  label: string;
  /** ISO envoyé à l'API ; `null` = dès que possible (≈ 15 min). */
  iso: string;
}

/** Créneaux au quart d'heure sur les deux prochaines heures + « dès que possible ». */
export function pickupSlots(now = new Date()): Slot[] {
  const asap = new Date(now.getTime() + 15 * 60_000);
  const slots: Slot[] = [{ key: 'asap', label: '~15 min', iso: asap.toISOString() }];
  const cursor = new Date(now.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(Math.ceil((cursor.getMinutes() + 5) / 15) * 15);
  for (let i = 0; i < 8; i++) {
    const label = `${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`;
    slots.push({ key: label, label, iso: cursor.toISOString() });
    cursor.setMinutes(cursor.getMinutes() + 15);
  }
  return slots;
}

// ─── Panier ───

/** Libellé de second niveau d'une ligne : variante · options · retraits. */
export function lineDetail(line: CartLine): string {
  const parts: string[] = [];
  if (line.variantName) parts.push(line.variantName);
  if (line.options.length) parts.push(line.options.map((o) => o.name).join(', '));
  if (line.removed.length) parts.push(line.removed.map((r) => `sans ${r}`).join(', '));
  return parts.join(' · ');
}

export function makeLine(input: Omit<CartLine, 'lineId'>): CartLine {
  return { ...input, lineId: uuid() };
}

// ─── Corps de commande (contrat API) ───

export interface OrderBody {
  clientId: string;
  /** UUID technique de la carte présentée avant encaissement, jamais son profil. */
  loyaltyMemberId?: string;
  /** Même écriture durable que la vente : aucun crash ne peut séparer les deux. */
  loyaltyEarnOperationId?: string;
  channel: 'pos' | 'phone';
  type: 'surplace' | 'emporter' | 'pickup';
  lines: {
    productId: string;
    variantKey?: string;
    options: { groupKey: string; choiceKey: string }[];
    removed: string[];
    note?: string;
    qty: number;
  }[];
  payment: {
    /** Le POS encaisse au comptoir : `online` ne concerne pas cette surface. */
    method: 'counter';
    /** Moyen réellement présenté — `null` = à encaisser au retrait. */
    tender: PaymentTender | null;
    cashReceived?: number;
    changeGiven?: number;
  };
  pickup?: { slot: string; customerName: string; customerPhone?: string };
  note?: string;
}

export function buildOrderBody(params: {
  clientId: string;
  loyaltyMemberId?: string | null;
  loyaltyEarnOperationId?: string | null;
  mode: Mode;
  lines: CartLine[];
  note: string;
  customerName: string;
  customerPhone: string;
  slotIso: string | null;
  /** Bouton d'encaissement pressé au comptoir. */
  method: PayMethod;
  /** Encaissement espèces : montant posé et rendu calculé localement. */
  cash?: { received: number; change: number };
}): OrderBody {
  const {
    clientId,
    loyaltyMemberId,
    loyaltyEarnOperationId,
    mode,
    lines,
    note,
    customerName,
    customerPhone,
    slotIso,
    method,
    cash,
  } = params;
  if (!!loyaltyMemberId !== !!loyaltyEarnOperationId) {
    throw new Error('La carte fidélité et son opération de gain sont indissociables');
  }
  const tender = PAY_TENDER[method];
  const body: OrderBody = {
    clientId,
    ...(mode !== 'tel' && loyaltyMemberId && loyaltyEarnOperationId
      ? { loyaltyMemberId, loyaltyEarnOperationId }
      : null),
    channel: mode === 'tel' ? 'phone' : 'pos',
    type: mode === 'tel' ? 'pickup' : mode,
    lines: lines.map((l) => ({
      productId: l.productId,
      ...(l.variantKey ? { variantKey: l.variantKey } : null),
      options: l.options.map((o) => ({ groupKey: o.groupKey, choiceKey: o.choiceKey })),
      removed: l.removed,
      ...(l.note ? { note: l.note.slice(0, 200) } : null),
      qty: l.qty,
    })),
    payment: {
      method: 'counter',
      tender,
      // Le rendu est transmis pour trace, mais l'API le recalcule sur SON
      // total : la file offline peut rejouer ce corps bien plus tard.
      ...(tender === 'cash' && cash
        ? { cashReceived: cash.received, changeGiven: Math.max(0, cash.change) }
        : null),
    },
  };
  if (mode === 'tel') {
    body.pickup = {
      slot: slotIso ?? new Date(Date.now() + 15 * 60_000).toISOString(),
      customerName: customerName.trim(),
      ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : null),
    };
  }
  const trimmed = note.trim();
  if (trimmed) body.note = trimmed.slice(0, 500);
  return body;
}

// ─── Récapitulatif local du poste ───

/**
 * Ventilation des seules commandes inscrites dans le journal de cette caisse.
 *
 * Ce type n'est ni un Z fiscal, ni une clôture du restaurant : il ne contient
 * pas les commandes web ou celles saisies sur un autre poste. L'écran rappelle
 * ce périmètre avant toute remise à zéro.
 */
export interface LocalJournalSummary {
  orders: number;
  /** Total local remises déduites (centimes). */
  ca: number;
  cash: number;
  card: number;
  mealVoucher: number;
  /** Commandes locales parties sans encaissement (« au retrait »). */
  due: number;
  /** Encaissements locaux dont le moyen n'a pas été saisi. */
  unspecified: number;
  discounts: number;
}

const EMPTY_LOCAL_SUMMARY: LocalJournalSummary = {
  orders: 0,
  ca: 0,
  cash: 0,
  card: 0,
  mealVoucher: 0,
  due: 0,
  unspecified: 0,
  discounts: 0,
};

export const LOCAL_JOURNAL_SCOPE_NOTICE =
  'Ce récapitulatif contient uniquement les commandes saisies sur cette caisse. Les commandes web, celles des autres caisses et la comptabilité globale ne sont ni totalisées ni clôturées ici. Elles restent visibles dans le suivi opérationnel.';

/** Calcule exclusivement ce qui est déjà présent dans le journal du poste. */
export function zFromJournal(entries: DayEntry[]): LocalJournalSummary {
  const z = { ...EMPTY_LOCAL_SUMMARY };
  for (const entry of entries) {
    const net = entry.total - (entry.discount ?? 0);
    z.orders += 1;
    z.ca += net;
    z.discounts += entry.discount ?? 0;

    if (!entry.paid) {
      z.due += net;
      continue;
    }
    const tender = PAY_TENDER[entry.method];
    if (tender === 'cash') z.cash += net;
    else if (tender === 'card') z.card += net;
    else if (tender === 'meal_voucher') z.mealVoucher += net;
    else z.unspecified += net;
  }
  return z;
}
