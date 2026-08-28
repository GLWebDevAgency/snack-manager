/**
 * Adaptateur de transport « démonstration » de la commande en ligne.
 *
 * Il répond aux MÊMES routes publiques que l'API, avec les mêmes formes et les
 * mêmes statuts d'erreur, depuis la fixture et la mémoire du navigateur. Ni le
 * client (`orderingApi`), ni le panier, ni le tunnel ne savent qu'ils ne
 * parlent pas au réseau : c'est tout l'intérêt du port. Ce que le visiteur
 * manipule est la vraie commande en ligne, pas une maquette qui lui ressemble.
 *
 * TOUTES LES ÉCRITURES SONT ACCEPTÉES et gardées en mémoire : le visiteur
 * compose un tacos, choisit son créneau, valide — et il obtient un vrai numéro
 * de retrait, calculé par la même règle que le serveur, sur un créneau dont la
 * capacité vient réellement de baisser.
 *
 * ─── LE PAIEMENT NE SORT JAMAIS D'ICI ───
 *
 * `POST /public/orders/:id/payment-intent` rend « paiement en ligne
 * indisponible » — la réponse que l'API donne elle-même quand Stripe n'est pas
 * configuré. Aucune clé, aucun appel, aucun montant ne part chez un
 * prestataire depuis une démonstration : le tunnel sait déjà terminer le
 * parcours au comptoir dans ce cas, et c'est ce chemin-là qu'on emprunte.
 *
 * ─── LA LATENCE EST UNE FONCTIONNALITÉ ───
 *
 * Une application qui répond en 0 ms ne fait pas vrai : les états de
 * chargement ne s'affichent jamais et l'ensemble sent la maquette. On rend
 * donc en 60 à 180 ms côté navigateur — l'ordre de grandeur d'une bonne
 * connexion. Le rendu serveur, lui, ne dort pas : ce serait du temps volé au
 * premier affichage.
 */
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_UNAVAILABLE_REASON,
  type OrderTicket,
} from "@sm/contracts";
import type {
  CreateOrderPayload,
  CreatedOrder,
  Transport,
  TransportRequest,
  TransportResponse,
  TrackingState,
} from "../api";
import { hhmm } from "../helpers";
import { baseTaken, demoSite, demoSlots, demoTenant } from "./fixture";
import { demoCategories } from "./carte";
import {
  createDemoState,
  demoTrackingToken,
  DemoRefusal,
  historyAt,
  priceLine,
  statusAt,
  type DemoOrder,
  type DemoState,
} from "./state";

export interface DemoTransportOptions {
  /** Horloge injectable — les tests n'attendent pas une vraie seconde. */
  now?: () => number;
  /** Latence désactivable : le rendu serveur ne dort pas, un test non plus. */
  latency?: boolean;
  latencyMs?: { min: number; max: number };
  /** Aléa injectable, pour rendre la latence déterministe en test. */
  random?: () => number;
}

export const DEFAULT_DEMO_LATENCY = { min: 60, max: 180 } as const;

const ok = (body: unknown): TransportResponse => ({ status: 200, body });
const refuse = (status: number, message: string): TransportResponse => ({
  status,
  body: { message, statusCode: status },
});

/** Transport de démonstration et son état, neufs. */
export function demoTransport(options: DemoTransportOptions = {}): Transport {
  const state = createDemoState();
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
  const [rawPath = "", rawQuery = ""] = request.path.split("?");
  const path = rawPath.replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(rawQuery);
  const method = request.method.toUpperCase();
  const segments = path.split("/").filter(Boolean);
  const clock = new Date(at);

  // ─── Restaurant et carte ───
  //
  // Le slug n'est pas vérifié : cette route n'est atteignable que depuis
  // `/r/demo`, où il n'existe qu'un restaurant. Refuser sur un slug inattendu
  // ne protégerait rien et casserait l'écran du visiteur.
  if (method === "GET" && segments[0] === "public" && segments[1] === "tenants") {
    const taken = (iso: string) => baseTaken(iso) + bookedOn(state, iso);
    if (segments.length === 3) {
      return ok({ ...demoTenant(clock), onlineOrderingPaused: false, pauseMessage: null });
    }
    if (segments.length === 4 && segments[3] === "site") {
      return ok(demoSite(clock, taken));
    }
    if (segments.length === 4 && segments[3] === "menu") {
      return ok({ categories: demoCategories() });
    }
    if (segments.length === 4 && segments[3] === "slots") {
      return ok(demoSlots(clock, query.get("date"), taken));
    }
  }

  if (
    method === "POST" &&
    segments[0] === "public" &&
    segments[1] === "tenants" &&
    segments.length === 4 &&
    segments[3] === "orders"
  ) {
    return ok(createOrder(state, request.body as CreateOrderPayload, at));
  }

  // ─── Commande créée : paiement, suivi, ticket ───

  if (segments[0] === "public" && segments[1] === "orders" && segments[2]) {
    const order = state.orders.find((o) => o._id === segments[2]);

    if (method === "POST" && segments[3] === "payment-intent") {
      if (!order) return refuse(404, "Commande introuvable");
      // Jamais Stripe depuis une démonstration. L'API répond exactement cela
      // quand le paiement en ligne n'est pas configuré : le tunnel enchaîne
      // sur « à régler au comptoir » sans se bloquer.
      return ok({ unavailable: true, reason: PAYMENT_UNAVAILABLE_REASON });
    }

    if (method === "GET") {
      // Jeton absent ou faux ⇒ 404 et non 403, comme l'API : un 403
      // confirmerait l'existence de la commande.
      if (!order || query.get("t") !== demoTrackingToken(order._id)) {
        return refuse(404, "Commande introuvable");
      }
      if (segments.length === 3) return ok(trackingOf(order, at));
      if (segments.length === 4 && segments[3] === "ticket") return ok(ticketOf(order, at, clock));
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

/** Places déjà prises sur un créneau par les commandes du visiteur. */
function bookedOn(state: DemoState, iso: string): number {
  return state.orders.filter((o) => o.pickup?.slot === iso).length;
}

function trackingOf(order: DemoOrder, at: number): TrackingState {
  return {
    _id: order._id,
    number: order.number,
    status: statusAt(order, at),
    statusHistory: historyAt(order, at),
    pickupSlot: order.pickup?.slot ?? null,
  };
}

/** Ticket client — mêmes libellés que l'API, tirés des contrats partagés. */
function ticketOf(order: DemoOrder, at: number, clock: Date): OrderTicket {
  const tenant = demoTenant(clock);
  const status = statusAt(order, at);
  return {
    orderId: order._id,
    pickupNumber: order.number,
    header: {
      tenantName: tenant.name,
      slug: tenant.slug,
      address: tenant.address,
      phones: tenant.phones,
    },
    createdAt: order.createdAt,
    printedAt: new Date(at).toISOString(),
    channel: "online",
    channelLabel: ORDER_CHANNEL_LABELS.online,
    type: "pickup",
    typeLabel: ORDER_TYPE_LABELS.pickup,
    status,
    statusLabel: ORDER_STATUS_LABELS[status],
    pickup: order.pickup
      ? {
          slotIso: order.pickup.slot,
          slotLabel: hhmm(order.pickup.slot),
          customerName: order.pickup.customerName,
          customerPhone: order.pickup.customerPhone,
        }
      : null,
    lines: order.lines.map((l) => ({
      qty: l.qty,
      name: l.name,
      variantName: l.variantName,
      options: l.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
      removed: l.removed,
      note: l.note,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    })),
    totals: order.totals,
    payment: {
      method: order.payment.method,
      methodLabel: PAYMENT_METHOD_LABELS[order.payment.method],
      tender: null,
      tenderLabel: null,
      status: order.payment.status,
      statusLabel: PAYMENT_STATUS_LABELS[order.payment.status],
      paid: order.payment.status === "paid",
      cashReceived: null,
      changeGiven: null,
    },
    note: order.note,
  };
}

// ─────────────────────────────────────────────────────────────
// Écriture : la commande
// ─────────────────────────────────────────────────────────────

/**
 * Création de commande — transcription de `OrdersService.create`.
 *
 * Rien de ce que le navigateur a calculé n'est repris : les lignes sont
 * rechiffrées depuis la carte, le total en découle, et le numéro de retrait
 * vient de la séquence du service. Le `clientId` sert de clé d'idempotence,
 * comme côté serveur : un double appui ou un réessai ne crée jamais deux
 * commandes.
 */
function createOrder(state: DemoState, body: CreateOrderPayload, at: number): CreatedOrder {
  if (!body?.clientId || !Array.isArray(body.lines) || body.lines.length === 0) {
    throw new DemoRefusal(400, "Commande vide");
  }
  if (!body.pickup?.slot || !body.pickup.customerName?.trim()) {
    throw new DemoRefusal(400, "Créneau et nom requis");
  }

  const replay = state.orders.find((o) => o.clientId === body.clientId);
  if (replay) return projection(replay, at);

  const lines = body.lines.map((line) => {
    const priced = priceLine(state.products, line);
    const qty = Math.max(1, Math.min(99, Math.round(line.qty)));
    return {
      productId: priced.productId,
      name: priced.name,
      variantKey: priced.variantKey,
      variantName: priced.variantName,
      options: priced.options,
      removed: priced.removed,
      note: priced.note,
      qty,
      unitPrice: priced.unitPrice,
      lineTotal: priced.unitPrice * qty,
    };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

  const number = state.nextNumber++;
  const id = `demo-order-${number}`;
  const method = body.payment?.method === "online" ? "online" : "counter";
  const order: DemoOrder = {
    _id: id,
    number,
    clientId: body.clientId,
    status: "new",
    createdAt: new Date(at).toISOString(),
    lines,
    totals: { subtotal, discount: null, total: subtotal },
    // Le paiement en ligne n'aboutit jamais ici (aucun Stripe en
    // démonstration) : l'argent est dû au comptoir, comme le dit l'écran.
    payment: { method, status: "pending" },
    pickup: {
      slot: body.pickup.slot,
      customerName: body.pickup.customerName.trim(),
      customerPhone: body.pickup.customerPhone?.trim() || null,
    },
    note: body.note?.trim() || null,
    trackingToken: demoTrackingToken(id),
  };
  state.orders.push(order);
  return projection(order, at);
}

/** Ce que l'API renvoie à la création — une projection, pas la commande entière. */
function projection(order: DemoOrder, at: number): CreatedOrder {
  return {
    _id: order._id,
    number: order.number,
    status: statusAt(order, at),
    // La démonstration ne joue aucune promotion : ses commandes sont au tarif
    // de la carte, et une remise inventée ferait douter du chiffre montré.
    totals: { subtotal: order.totals.subtotal, discount: null, total: order.totals.total },
    pickup: order.pickup
      ? { slot: order.pickup.slot, customerName: order.pickup.customerName }
      : null,
    trackingToken: order.trackingToken,
  };
}
