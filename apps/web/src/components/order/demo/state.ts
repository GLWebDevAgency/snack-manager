/**
 * L'état de la démonstration — entièrement en mémoire, entièrement au visiteur.
 *
 * ─── POURQUOI PAS DE RESTAURANT DE DÉMONSTRATION EN BASE ───
 *
 * Un tenant « démo » côté serveur apparaîtrait dans le CRM comme un client
 * (MRR, compteurs, score de santé), deux visiteurs simultanés se marcheraient
 * dessus — l'un annulerait le créneau de l'autre —, et ses commandes
 * entreraient dans la médiane réseau qui alimente le conseil chiffré vendu aux
 * restaurateurs. On vendrait du conseil calculé sur des clics d'inconnus.
 *
 * Chaque visiteur a donc la sienne, neuve. Il peut tout casser : un
 * rechargement remet à zéro, parce qu'il n'y a rien à remettre à zéro.
 *
 * ─── LE PRIX NE VIENT JAMAIS DU NAVIGATEUR ───
 *
 * `priceLine` est la transcription de ce que fait `OrdersService.create` :
 * le total est RECALCULÉ depuis la carte, à partir des seuls identifiants
 * envoyés. C'est la règle de sécurité de la vraie commande en ligne (un client
 * ne fixe pas son prix), et c'est aussi ce qui rend la démonstration probante —
 * le visiteur voit le supplément à 1,00 € s'ajouter parce qu'il est tarifé
 * dans la carte, pas parce que l'écran l'avait déjà additionné.
 */
import type { OrderStatus, PublicSiteProduct } from "@sm/contracts";
import type { OrderLinePayload } from "../api";
import { demoCategories } from "./carte";

/** Refus servi avec le statut HTTP qu'aurait rendu l'API. */
export class DemoRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DemoRefusal";
  }
}

/** Groupe d'options tel que la carte le sérialise. */
type RawGroup = {
  key: string;
  name: string;
  type: "single" | "multi";
  min: number;
  max: number | null;
  choices: { key: string; name: string; priceDelta: number }[];
  perVariant?: Record<string, { min?: number; max?: number; priceDelta?: number }> | null;
};

export type PricedOption = {
  groupKey: string;
  choiceKey: string;
  name: string;
  priceDelta: number;
};

export type DemoOrderLine = {
  productId: string;
  name: string;
  variantKey: string | null;
  variantName: string | null;
  options: PricedOption[];
  removed: string[];
  note: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type DemoOrder = {
  _id: string;
  number: number;
  clientId: string;
  status: OrderStatus;
  createdAt: string;
  lines: DemoOrderLine[];
  totals: { subtotal: number; discount: null; total: number };
  payment: { method: "online" | "counter"; status: "pending" | "paid" };
  pickup: { slot: string; customerName: string; customerPhone: string | null } | null;
  note: string | null;
  trackingToken: string;
};

export interface DemoState {
  products: Map<string, PublicSiteProduct>;
  orders: DemoOrder[];
  /** Séquence des numéros de retrait, comme le compteur journalier du serveur. */
  nextNumber: number;
}

/**
 * Numéro de retrait du premier ticket du visiteur.
 *
 * Pas 1 : un restaurant qui prend sa première commande de la journée devant
 * vous ne ressemble pas à un restaurant. Le service a commencé sans lui.
 */
const FIRST_PICKUP_NUMBER = 27;

export function createDemoState(): DemoState {
  const products = new Map<string, PublicSiteProduct>();
  for (const category of demoCategories()) {
    for (const product of category.products) products.set(product._id, product);
  }
  return { products, orders: [], nextNumber: FIRST_PICKUP_NUMBER };
}

/** Jeton de suivi de démonstration — même forme que le vrai, aucun secret. */
export const demoTrackingToken = (orderId: string): string => `demo-${orderId}`;

// ─────────────────────────────────────────────────────────────
// Tarification (côté « serveur »)
// ─────────────────────────────────────────────────────────────

/** Bornes effectives d'un groupe pour la variante choisie. */
function rulesFor(group: RawGroup, variantKey: string | null) {
  const rule = variantKey ? group.perVariant?.[variantKey] : undefined;
  const min = rule?.min ?? group.min ?? 0;
  const max = rule?.max ?? group.max ?? Number.POSITIVE_INFINITY;
  return { min, max: Math.max(min, max), priceDelta: rule?.priceDelta };
}

function basePrice(product: PublicSiteProduct, variantKey: string | null): number {
  if (product.variants.length === 0) return product.price;
  const variant = product.variants.find((v) => v.key === variantKey);
  return variant?.price ?? Math.min(...product.variants.map((v) => v.price));
}

/** Ligne chiffrée depuis la carte — jamais depuis ce que le panier avait calculé. */
export function priceLine(
  products: Map<string, PublicSiteProduct>,
  line: OrderLinePayload,
): Omit<DemoOrderLine, "qty" | "lineTotal"> & { photoUrl: string | null } {
  const product = products.get(line.productId);
  if (!product) throw new DemoRefusal(404, `Produit ${line.productId} introuvable`);
  if (product.outOfStock) throw new DemoRefusal(409, `« ${product.name} » est en rupture`);

  const variantKey = line.variantKey ?? null;
  let variantName: string | null = null;
  if (product.variants.length > 0) {
    const variant = product.variants.find((v) => v.key === variantKey);
    if (!variant) throw new DemoRefusal(400, `Format requis pour « ${product.name} »`);
    variantName = variant.name;
  }

  const groups = product.optionGroups as RawGroup[];
  let unitPrice = basePrice(product, variantKey);
  const options: PricedOption[] = (line.options ?? []).map((selected) => {
    const group = groups.find((g) => g.key === selected.groupKey);
    const choice = group?.choices.find((c) => c.key === selected.choiceKey);
    if (!group || !choice) throw new DemoRefusal(400, `Option inconnue pour « ${product.name} »`);
    const priceDelta = rulesFor(group, variantKey).priceDelta ?? choice.priceDelta;
    unitPrice += priceDelta;
    return { groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta };
  });

  // Groupes obligatoires : le minimum effectif dépend de la variante choisie
  // (un tacos M attend 1 viande, un XXL en attend 4).
  for (const group of groups) {
    const { min, max } = rulesFor(group, variantKey);
    const count = options.filter((o) => o.groupKey === group.key).length;
    if (count < min || count > max) {
      const expected = min === max ? String(min) : `${min}–${max === Infinity ? "∞" : max}`;
      throw new DemoRefusal(
        400,
        `« ${group.name} » : ${expected} choix attendu(s) pour « ${product.name} »`,
      );
    }
  }

  const known = new Set(product.removables.map((item) => typeof item === "string" ? item : item.key));
  return {
    productId: product._id,
    name: product.name,
    variantKey,
    variantName,
    options,
    removed: (line.removed ?? []).filter((r) => known.has(r)),
    note: line.note?.trim() || null,
    unitPrice,
    photoUrl: product.photoUrl,
  };
}

// ─────────────────────────────────────────────────────────────
// Avancement en cuisine
// ─────────────────────────────────────────────────────────────

/**
 * Étapes de la cuisine simulée, en secondes après l'envoi du ticket.
 *
 * Un vrai service met dix à vingt minutes ; personne ne reste dix minutes
 * devant un écran de démonstration. Une quarantaine de secondes suffit à
 * montrer que le suivi VIT, sans transformer la visite en salle d'attente.
 */
const KITCHEN: { status: OrderStatus; afterS: number }[] = [
  { status: "new", afterS: 0 },
  { status: "preparing", afterS: 10 },
  { status: "ready", afterS: 40 },
];

/**
 * Statut d'une commande de démonstration, déduit du temps écoulé.
 *
 * Aucun minuteur, aucune écriture différée : le statut est CALCULÉ à la
 * lecture. Le visiteur qui reste sur l'écran de confirmation voit son ticket
 * passer « Reçue → En préparation → Prête » comme le ferait la cuisine — sauf
 * qu'ici c'est l'horloge qui joue le rôle du chef. Les durées sont celles
 * d'une démonstration (une minute et demie), pas celles d'un vrai service.
 */
export function statusAt(order: DemoOrder, now: number): OrderStatus {
  const elapsed = (now - Date.parse(order.createdAt)) / 1000;
  let status: OrderStatus = "new";
  for (const step of KITCHEN) if (elapsed >= step.afterS) status = step.status;
  return status;
}

/** Historique correspondant, pour la page de suivi. */
export function historyAt(order: DemoOrder, now: number): { status: OrderStatus; at: string }[] {
  const created = Date.parse(order.createdAt);
  const elapsed = (now - created) / 1000;
  return KITCHEN.filter((step) => elapsed >= step.afterS).map((step) => ({
    status: step.status,
    at: new Date(created + step.afterS * 1000).toISOString(),
  }));
}
