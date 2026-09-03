/**
 * TOUT CE QUE LA CAISSE PERSISTE — et donc tout ce qu'il faut effacer quand
 * l'appareil change d'établissement.
 *
 * Le désappairage n'effaçait que l'appairage, la session et la file : le
 * journal du service et les tickets mis en attente restaient, et ressortaient
 * après ré-appairage chez un AUTRE commerçant. Le Z du soir mélangeait deux
 * restaurants, et un ticket parqué chez A se rappelait chez B avec ses lignes
 * et le nom de son client.
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
  /** Ouverture du service courant — borne de découpe du Z. */
  serviceStart: 'sm.pos.servicestart.v1',
  /** UUID opaque seulement ; permet de redériver un QR après réponse perdue. */
  loyaltyEnrollmentRecovery: 'sm.pos.loyalty-enrollment-recovery.v1',
} as const;

/**
 * État métier du poste : modes de service, journal du service, tickets en
 * attente, construction du corps de commande.
 *
 * Tout ce qui doit survivre à un rechargement (tickets parqués, journal du
 * service, session) passe par le stockage clé/valeur du noyau partagé — le
 * même que la file offline.
 */
import { uuid, type CartLine, type KeyValueStore } from '@sm/client-core';
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
 * boutons et enregistrait tout en attente — le Z du soir était donc faux même
 * quand l'écran affichait « Payé (carte bancaire) ».
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
 * Commit critique d'une vente dans le journal du service.
 *
 * Contrairement aux préférences UI ci-dessus, cette écriture ne peut pas être
 * best-effort : le verrou d'encaissement ne sera libéré qu'après sa réussite.
 * L'entrée de file réseau est déjà durable à cet instant ; attendre ici évite
 * qu'un verrouillage ou un désappairage démonte l'écran entre le setState et
 * l'effet React chargé de persister le journal.
 */
export async function appendDayEntryDurably(
  store: KeyValueStore,
  current: readonly DayEntry[],
  entry: DayEntry,
  day = serviceDay(),
): Promise<DayEntry[]> {
  const next = [...current, entry];
  await store.setItem(
    KEYS.dayLog,
    JSON.stringify({ day, entries: next }),
  );
  return next;
}

/**
 * Après un enqueue réussi, un défaut du journal n'annule jamais la vente.
 * L'appelant doit vider le ticket et afficher une alerte de journal dégradé :
 * autoriser un nouvel essai créerait un nouvel UUID et donc un doublon.
 */
export async function commitQueuedSaleJournal(
  store: KeyValueStore,
  current: readonly DayEntry[],
  entry: DayEntry,
  day = serviceDay(),
): Promise<{ entries: DayEntry[]; durable: boolean }> {
  try {
    return {
      entries: await appendDayEntryDurably(store, current, entry, day),
      durable: true,
    };
  } catch {
    return { entries: [...current, entry], durable: false };
  }
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

// ─── Clôture de service (Z) ───

/**
 * Ventilation du service par moyen de paiement.
 *
 * Ce que compte réellement un gérant le soir : les espèces du tiroir, le
 * bordereau du TPE, la télécollecte des titres-restaurant, ce qui est déjà
 * tombé sur le compte via la vente en ligne, et ce qui reste dû. Un total
 * unique ne se recoupe avec rien.
 */
export interface ServiceZ {
  orders: number;
  /** Chiffre d'affaires du service, remises déduites (centimes). */
  ca: number;
  cash: number;
  card: number;
  /** Titres-restaurant — à recouper avec la télécollecte du terminal TR. */
  mealVoucher: number;
  online: number;
  /** Commandes parties sans encaissement (« à encaisser au retrait »). */
  due: number;
  /**
   * Encaissé au comptoir SANS moyen saisi.
   *
   * Ce n'est pas un vestige : le cas se produit à chaque commande « à régler au
   * retrait » que la cuisine fait passer à « Remis ». L'API bascule alors le
   * paiement en « réglé » — l'argent rentre bien — mais personne n'a dit
   * comment : ni le KDS, qui ne connaît pas le tiroir, ni la caisse, qui n'a
   * pas été sollicitée.
   *
   * Le montant est donc RÉEL et doit être ventilé à la main au moment du Z. Le
   * présenter comme une anomalie de données anciennes faisait chercher un bogue
   * là où il y a un geste manquant.
   */
  unspecified: number;
  discounts: number;
  /**
   * `server` : calculé sur les commandes enregistrées, donc vente en ligne
   * comprise. `local` : repli hors ligne sur le seul journal de ce poste.
   */
  source: 'server' | 'local';
  /**
   * LE Z EST-IL UN TOTAL, OU UN MINIMUM ?
   *
   * `GET /orders` plafonne sa réponse à 200 commandes, les plus RÉCENTES, et
   * annonce la coupe (`total`, `truncated`). La caisse typait la réponse
   * `{ rows }` et jetait les deux : au-delà de 200 commandes dans la journée,
   * le chiffre d'affaires, les espèces, la carte et les titres-restaurant
   * étaient calculés sur une fenêtre amputée de ses lignes les PLUS ANCIENNES,
   * en silence. Le gérant recomptait son tiroir contre un total faux.
   *
   * Quand `partial` est vrai, aucun montant de ce Z n'est un total : ce sont
   * tous des minima, et l'écran doit le dire au lieu de conclure.
   */
  partial: boolean;
  /** Commandes de la journée absentes de la fenêtre (`0` si rien n'est coupé). */
  missing: number;
}

/** Ce que le serveur dit de la fenêtre qu'il vient de servir. */
export interface ZWindow {
  /** Nombre exact de commandes correspondant à la requête, côté serveur. */
  total: number;
  /** `true` quand les lignes reçues ne sont qu'une fenêtre. */
  truncated: boolean;
  /** Nombre de lignes réellement reçues. */
  received: number;
}

const EMPTY_Z: Omit<ServiceZ, 'source' | 'partial' | 'missing'> = {
  orders: 0,
  ca: 0,
  cash: 0,
  card: 0,
  mealVoucher: 0,
  online: 0,
  due: 0,
  unspecified: 0,
  discounts: 0,
};

/** Commande telle que la renvoie `GET /orders` (champs utiles au Z). */
export interface ServiceOrderRow {
  createdAt?: string;
  status?: string;
  totals?: { total?: number; discount?: { amount?: number } | null };
  payment?: { status?: string; tender?: PaymentTender | null };
}

/**
 * Z de référence : calculé sur les commandes enregistrées côté serveur.
 *
 * Seule source qui voie la vente en ligne et les remises passées depuis le
 * back-office. Les commandes annulées en sortent — elles n'ont encaissé rien.
 *
 * @param since début du service en ms (la clôture précédente, ou minuit).
 * @param fenetre ce que le serveur a dit de la coupe. Facultatif : sans lui, on
 *        suppose la fenêtre complète — c'était le comportement d'avant, et il
 *        reste exact tant que la journée tient sous le plafond. Le fournir est
 *        ce qui permet au Z de dire « au moins » plutôt que d'affirmer.
 */
export function zFromServer(
  rows: ServiceOrderRow[],
  since: number,
  fenetre?: ZWindow,
): ServiceZ {
  const z = {
    ...EMPTY_Z,
    source: 'server' as const,
    partial: fenetre?.truncated === true,
    missing: fenetre ? Math.max(0, fenetre.total - fenetre.received) : 0,
  };
  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const at = row.createdAt ? Date.parse(row.createdAt) : Number.NaN;
    if (Number.isFinite(at) && at < since) continue;

    const total = Math.round(row.totals?.total ?? 0);
    z.orders += 1;
    z.ca += total;
    z.discounts += Math.round(row.totals?.discount?.amount ?? 0);

    if (row.payment?.status !== 'paid') {
      z.due += total;
      continue;
    }
    const tender = row.payment.tender ?? null;
    if (tender === 'cash') z.cash += total;
    else if (tender === 'card') z.card += total;
    else if (tender === 'meal_voucher') z.mealVoucher += total;
    else if (tender === 'online') z.online += total;
    else z.unspecified += total;
  }
  return z;
}

/**
 * Repli hors ligne : le journal local du poste.
 *
 * Il ne connaît que ce qui est parti de CETTE caisse — la vente en ligne y est
 * donc absente, et le Z le signale par `source: 'local'` plutôt que d'afficher
 * un zéro qui passerait pour un fait.
 */
export function zFromJournal(entries: DayEntry[]): ServiceZ {
  // Le journal local n'est jamais tronqué : il contient exactement ce que CE
  // poste a encaissé. Il est incomplet pour une autre raison — la vente en
  // ligne lui échappe —, et c'est `source: 'local'` qui le dit.
  const z = { ...EMPTY_Z, source: 'local' as const, partial: false, missing: 0 };
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
