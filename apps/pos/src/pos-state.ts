/**
 * État métier du poste : modes de service, journal du service, tickets en
 * attente, construction du corps de commande.
 *
 * Tout ce qui doit survivre à un rechargement (tickets parqués, journal du
 * service, session) passe par le stockage clé/valeur du noyau partagé — le
 * même que la file offline.
 */
import { getStore, uuid, type CartLine } from '@sm/client-core';

export type Mode = 'surplace' | 'emporter' | 'tel';

export const MODE_LABEL: Record<Mode, string> = {
  surplace: 'Sur place',
  emporter: 'À emporter',
  tel: 'Téléphone',
};

export type PayMethod = 'cb' | 'especes' | 'retrait';

export const PAY_LABEL: Record<PayMethod, string> = {
  cb: 'Carte bancaire',
  especes: 'Espèces',
  retrait: 'À encaisser au retrait',
};

/** Une commande envoyée pendant le service (journal local du poste). */
export interface DayEntry {
  clientId: string;
  /** Numéro affiché immédiatement, avant confirmation serveur. */
  localNumber: number;
  serverId: string | null;
  serverNumber: number | null;
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

// ─── Persistance ───

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getStore().getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await getStore().setItem(key, JSON.stringify(value));
  } catch {
    /* quota : on ne bloque jamais le service pour un échec d'écriture */
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
  payment: { method: 'counter' };
  pickup?: { slot: string; customerName: string; customerPhone?: string };
  note?: string;
}

export function buildOrderBody(params: {
  clientId: string;
  mode: Mode;
  lines: CartLine[];
  note: string;
  customerName: string;
  customerPhone: string;
  slotIso: string | null;
}): OrderBody {
  const { clientId, mode, lines, note, customerName, customerPhone, slotIso } = params;
  const body: OrderBody = {
    clientId,
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
    // Le POS encaisse au comptoir : le paiement en ligne ne concerne pas cette surface.
    payment: { method: 'counter' },
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
