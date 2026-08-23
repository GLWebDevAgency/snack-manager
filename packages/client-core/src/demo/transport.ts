/**
 * Adaptateur de transport « démonstration ».
 *
 * Il répond aux MÊMES routes que l'API, avec les mêmes formes et les mêmes
 * statuts d'erreur, depuis la fixture et la mémoire du navigateur. Ni le
 * `SmClient`, ni la file offline, ni la caisse ne savent qu'ils ne parlent pas
 * au réseau : c'est tout l'intérêt du port (ADR 0001). Ce que le visiteur
 * manipule est la vraie application, pas une maquette qui lui ressemble.
 *
 * TOUTES LES ÉCRITURES SONT ACCEPTÉES et gardées en mémoire. Le visiteur
 * ajoute au panier, encaisse, envoie en cuisine, fait avancer un ticket — et
 * l'écran réagit comme en service, parce qu'il se passe réellement quelque
 * chose derrière.
 *
 * ─── LA LATENCE EST UNE FONCTIONNALITÉ ───
 *
 * Une application qui répond en 0 ms ne fait pas vrai : les états de
 * chargement ne s'affichent jamais, le badge « en attente » de la file ne
 * clignote pas, et l'ensemble sent la maquette. On rend donc en 60 à 180 ms,
 * variable — l'ordre de grandeur d'une bonne connexion. C'est le réalisme qui
 * déclenche l'identification, et l'identification est l'objectif.
 */
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TENDER_LABELS,
} from '@sm/contracts';
import type { Transport, TransportRequest, TransportResponse } from '../api';
import { mostAdvancedStatus, type Order, type OrderStatus } from '../types';
import { DEMO_TENANT, demoTrackingToken } from './fixture';
import { createDemoState, DemoRefusal, priceLine, type DemoState, type LineInput } from './state';

export interface DemoTransportOptions {
  /** Bornes de la latence simulée, en millisecondes. */
  latencyMs?: { min: number; max: number };
  /** Horloge injectable — les tests n'attendent pas une vraie seconde. */
  now?: () => number;
  /** Aléa injectable, pour rendre la latence déterministe en test. */
  random?: () => number;
  /** Latence désactivable : un test qui dort n'apporte rien. */
  latency?: boolean;
}

export const DEFAULT_DEMO_LATENCY = { min: 60, max: 180 } as const;

interface CreateOrderBody {
  clientId: string;
  channel?: 'pos' | 'phone' | 'online';
  type?: 'surplace' | 'emporter' | 'pickup';
  lines: LineInput[];
  payment?: {
    method?: 'counter' | 'online';
    tender?: 'cash' | 'card' | 'meal_voucher' | 'online' | null;
    cashReceived?: number;
  };
  pickup?: { slot?: string; customerName?: string; customerPhone?: string };
  note?: string;
}

const ok = (body: unknown): TransportResponse => ({ status: 200, body });
const refuse = (status: number, message: string): TransportResponse => ({
  status,
  body: { message, statusCode: status },
});

/**
 * Crée un transport de démonstration et son état, neufs.
 *
 * L'état n'est jamais partagé entre deux appels. Deux surfaces qui vivent dans
 * le MÊME contexte JavaScript et doivent voir le même service (une caisse et un
 * écran cuisine côte à côte) passent par `transportFor(state)` avec un état
 * commun. Deux cadres séparés ont, eux, deux mondes distincts : rien ne
 * traverse une frontière de document.
 */
export function demoTransport(options: DemoTransportOptions = {}): Transport {
  return transportFor(createDemoState(options.now?.() ?? Date.now()), options);
}

/** Transport branché sur un état existant — deux surfaces, un seul service. */
export function transportFor(state: DemoState, options: DemoTransportOptions = {}): Transport {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const bounds = options.latencyMs ?? DEFAULT_DEMO_LATENCY;
  const withLatency = options.latency ?? true;

  const wait = (): Promise<void> => {
    if (!withLatency) return Promise.resolve();
    const ms = bounds.min + random() * Math.max(0, bounds.max - bounds.min);
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  return {
    async send(request) {
      await wait();
      try {
        return route(state, request, now());
      } catch (err) {
        if (err instanceof DemoRefusal) return refuse(err.status, err.message);
        throw err;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Aiguillage
// ─────────────────────────────────────────────────────────────

function route(state: DemoState, request: TransportRequest, at: number): TransportResponse {
  const [rawPath = '', rawQuery = ''] = request.path.split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(rawQuery);
  const method = request.method.toUpperCase();
  const segments = path.split('/').filter(Boolean);

  // ─── Carte et établissement ───

  // `/public/tenants/:slug` et `/public/tenants/:slug/menu` — le slug n'est pas
  // vérifié : en démonstration il n'existe qu'un restaurant, et refuser sur un
  // slug inattendu ne protégerait rien tout en cassant l'écran du visiteur.
  if (method === 'GET' && segments[0] === 'public' && segments[1] === 'tenants') {
    if (segments.length === 3) return ok(DEMO_TENANT);
    if (segments.length === 4 && segments[3] === 'menu') return ok(state.menu);
  }

  // ─── Suivi public (ticket, page client) ───

  if (method === 'GET' && segments[0] === 'public' && segments[1] === 'orders' && segments[2]) {
    const order = state.orders.find((o) => o._id === segments[2]);
    // Jeton absent ou faux ⇒ 404 et non 403, comme l'API : un 403 confirmerait
    // l'existence de la commande.
    if (!order || query.get('t') !== demoTrackingToken(order._id)) {
      return refuse(404, 'Commande introuvable');
    }
    if (segments.length === 4 && segments[3] === 'ticket') return ok(ticketOf(order, at));
    if (segments.length === 3) return ok(trackingOf(order));
  }

  // ─── Commandes (staff) ───

  if (segments[0] === 'orders') {
    if (method === 'GET' && segments.length === 1) return ok(listOrders(state, query));

    if (method === 'POST' && segments.length === 1) {
      return ok(createOrder(state, request.body as CreateOrderBody, at));
    }

    const id = segments[1];
    const order = id ? state.orders.find((o) => o._id === id) : undefined;

    if (method === 'GET' && segments.length === 2) {
      return order ? ok(order) : refuse(404, 'Commande introuvable');
    }

    if (segments.length === 3 && id) {
      if (!order) return refuse(404, 'Commande introuvable');
      if (method === 'PATCH' && segments[2] === 'status') {
        return ok(advance(order, request.body as { status?: OrderStatus }, at));
      }
      if (method === 'POST' && segments[2] === 'cancel') return ok(cancel(order, at));
      if (method === 'POST' && segments[2] === 'discount') {
        return ok(discount(order, request.body as { pin?: string; amount?: number; reason?: string }));
      }
    }
  }

  return refuse(
    404,
    `Route absente de la démonstration : ${method} ${path}. Elle existe côté API — ajoutez-la à demo/transport.ts.`,
  );
}

// ─────────────────────────────────────────────────────────────
// Lectures
// ─────────────────────────────────────────────────────────────

function listOrders(state: DemoState, query: URLSearchParams): { rows: Order[]; total: number } {
  const status = query.get('status');
  const since = query.get('since');
  const floor = since ? Date.parse(since) : Number.NaN;
  const rows = state.orders
    .filter((o) => (status ? o.status === status : true))
    .filter((o) => (Number.isFinite(floor) ? Date.parse(o.createdAt) >= floor : true))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 200)
    .map((o) => ({ ...o, trackingToken: demoTrackingToken(o._id) }));
  return { rows, total: rows.length };
}

function trackingOf(order: Order) {
  return {
    _id: order._id,
    number: order.number,
    status: order.status,
    statusHistory: order.statusHistory,
    pickupSlot: order.pickup?.slot ?? null,
  };
}

/** Ticket client — mêmes libellés que l'API, tirés des contrats partagés. */
function ticketOf(order: Order, at: number) {
  const tender = (order.payment as { tender?: 'cash' | 'card' | 'meal_voucher' | 'online' | null }).tender ?? null;
  const cash = order.payment as { cashReceived?: number | null; changeGiven?: number | null };
  return {
    orderId: order._id,
    pickupNumber: order.number,
    header: {
      tenantName: DEMO_TENANT.name,
      slug: DEMO_TENANT.slug,
      address: DEMO_TENANT.address,
      phones: DEMO_TENANT.phones,
    },
    createdAt: order.createdAt,
    printedAt: new Date(at).toISOString(),
    channel: order.channel,
    channelLabel: ORDER_CHANNEL_LABELS[order.channel] ?? order.channel,
    type: order.type,
    typeLabel: ORDER_TYPE_LABELS[order.type] ?? order.type,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    pickup: order.pickup
      ? {
          slotLabel: hhmm(order.pickup.slot),
          customerName: order.pickup.customerName,
          customerPhone: order.pickup.customerPhone ?? null,
        }
      : null,
    lines: order.lines.map((l) => ({
      qty: l.qty,
      name: l.name,
      variantName: l.variantName ?? null,
      options: l.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
      removed: l.removed,
      note: l.note ?? null,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    totals: order.totals,
    payment: {
      method: order.payment.method,
      methodLabel: PAYMENT_METHOD_LABELS[order.payment.method] ?? order.payment.method,
      tender,
      tenderLabel: tender ? (PAYMENT_TENDER_LABELS[tender] ?? tender) : null,
      status: order.payment.status,
      statusLabel: PAYMENT_STATUS_LABELS[order.payment.status] ?? order.payment.status,
      paid: order.payment.status === 'paid',
      cashReceived: cash.cashReceived ?? null,
      changeGiven: cash.changeGiven ?? null,
    },
    note: order.note ?? null,
  };
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────
// Écritures
// ─────────────────────────────────────────────────────────────

/** Canaux où l'argent est perçu au comptoir, à la commande. */
const COUNTER_CHANNELS = ['pos', 'phone'] as const;
/** Tenders réglés sur-le-champ face au client. */
const IMMEDIATE_TENDERS = ['cash', 'card', 'meal_voucher'] as const;

function createOrder(state: DemoState, body: CreateOrderBody, at: number): Order {
  if (!body?.clientId || !Array.isArray(body.lines) || body.lines.length === 0) {
    throw new DemoRefusal(400, 'Commande vide');
  }

  // Idempotence sur `clientId`, exactement comme le serveur : la file offline
  // rejoue sans jamais créer de doublon (ADR 0003).
  const replay = state.orders.find((o) => o.clientId === body.clientId);
  if (replay) return { ...replay, trackingToken: demoTrackingToken(replay._id) } as Order;

  const lines = body.lines.map((line) => {
    const priced = priceLine(state.products, line);
    return {
      productId: line.productId,
      name: priced.name,
      variantKey: line.variantKey ?? null,
      variantName: priced.variantName,
      options: priced.options,
      removed: line.removed ?? [],
      note: line.note ?? null,
      qty: line.qty,
      unitPrice: priced.unitPrice,
      lineTotal: priced.unitPrice * line.qty,
    };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const channel = body.channel ?? 'pos';
  const method = body.payment?.method ?? 'counter';
  const tender = method === 'online' ? 'online' : (body.payment?.tender ?? null);
  const immediate =
    (COUNTER_CHANNELS as readonly string[]).includes(channel) &&
    tender !== null &&
    (IMMEDIATE_TENDERS as readonly string[]).includes(tender);

  // Le rendu monnaie se déduit du total que l'on vient de chiffrer, jamais de
  // celui que la caisse avait calculé : la file peut rejouer bien plus tard.
  const received = tender === 'cash' ? body.payment?.cashReceived : undefined;
  if (received !== undefined && received < subtotal) {
    throw new DemoRefusal(
      400,
      `Montant reçu insuffisant : ${received} centimes pour un total de ${subtotal}`,
    );
  }

  const id = `demo-order-${state.orders.length + 1}-${state.nextNumber}`;
  const order = {
    _id: id,
    number: state.nextNumber++,
    clientId: body.clientId,
    channel,
    type: body.type ?? 'surplace',
    lines,
    totals: { subtotal, discount: null, total: subtotal },
    payment: {
      method,
      tender,
      status: immediate ? 'paid' : 'pending',
      cashReceived: received ?? null,
      changeGiven: received === undefined ? null : received - subtotal,
    },
    status: 'new' as OrderStatus,
    statusHistory: [{ status: 'new' as OrderStatus, at: new Date(at).toISOString() }],
    pickup: body.pickup?.customerName
      ? {
          slot: body.pickup.slot ?? new Date(at + 15 * 60_000).toISOString(),
          customerName: body.pickup.customerName,
          customerPhone: body.pickup.customerPhone ?? null,
        }
      : null,
    note: body.note ?? null,
    createdAt: new Date(at).toISOString(),
  } as unknown as Order;

  state.orders.push(order);
  return { ...order, trackingToken: demoTrackingToken(id) } as Order;
}

/**
 * Avancement de statut — règle offline « le plus avancé gagne ».
 *
 * Un rejeu vers un statut déjà dépassé est ignoré et rend l'état courant, sans
 * erreur : c'est ce qui permet à deux tablettes désynchronisées de se remettre
 * d'accord sans qu'aucune ne recule.
 */
function advance(order: Order, body: { status?: OrderStatus }, at: number): Order {
  const next = body?.status;
  if (!next) throw new DemoRefusal(400, 'Statut manquant');
  const kept = mostAdvancedStatus(order.status, next);
  if (kept === order.status) return order;

  order.status = kept;
  order.statusHistory = [...order.statusHistory, { status: kept, at: new Date(at).toISOString() }];
  // Filet des commandes parties sans encaissement : l'argent rentre à la remise.
  if (kept === 'delivered' && order.payment.method === 'counter' && order.payment.status === 'pending') {
    order.payment.status = 'paid';
  }
  return order;
}

function cancel(order: Order, at: number): Order {
  if (order.status === 'delivered') {
    throw new DemoRefusal(409, 'Commande déjà servie — passer par un remboursement');
  }
  order.status = 'cancelled';
  order.statusHistory = [
    ...order.statusHistory,
    { status: 'cancelled', at: new Date(at).toISOString() },
  ];
  return order;
}

/**
 * Remise.
 *
 * L'API revalide le PIN de l'équipier ; ici, tout code non vide passe. Un
 * visiteur de la page d'accueil n'a aucun moyen de connaître le vrai, et lui
 * opposer « PIN incorrect » ne démontrerait qu'une chose : qu'il ne peut pas
 * essayer. Le PLAFOND, lui, est bien celui du domaine — une remise ne peut pas
 * dépasser le sous-total, sinon la caisse deviendrait débitrice.
 */
function discount(order: Order, body: { pin?: string; amount?: number; reason?: string }): Order {
  if (!body?.pin) throw new DemoRefusal(401, 'PIN requis');
  const amount = Math.round(body.amount ?? 0);
  if (amount <= 0 || amount > order.totals.subtotal) {
    throw new DemoRefusal(400, 'Montant de remise invalide');
  }
  order.totals = {
    subtotal: order.totals.subtotal,
    discount: { amount, reason: body.reason ?? 'Geste commercial' },
    total: order.totals.subtotal - amount,
  };
  return order;
}
