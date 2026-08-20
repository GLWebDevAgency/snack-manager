"use client";

/**
 * L'ÉTABLISSEMENT DE DÉMONSTRATION, VIVANT.
 *
 * `snapshot.ts` est une photo : des formes justes, mais sans date et sans
 * mouvement. Ce fichier en fait un service en cours — au moment précis où le
 * visiteur ouvre la page.
 *
 * ─── LES DATES SE RECALENT SUR L'HORLOGE DU VISITEUR ───
 *
 * Chaque âge de la fixture devient une date réelle : « 4 minutes » devient
 * l'heure qu'il est moins quatre minutes. Une commande y est donc TOUJOURS
 * arrivée il y a quatre minutes, que la démonstration soit ouverte aujourd'hui
 * ou dans deux ans. Sans ce recalage, un visiteur de mars 2027 verrait
 * « dernière commande il y a 213 jours » au-dessus d'un graphique plat : la
 * démonstration se périmerait toute seule, silencieusement.
 *
 * Trois familles de données vont plus loin que le simple décalage, parce
 * qu'un décalage rigide ne suffit pas à les rendre crédibles :
 *
 *   · LES SÉRIES STATISTIQUES sont RECONSTRUITES. On garde les magnitudes
 *     mesurées (chiffre d'affaires hebdomadaire, panier moyen, mix des canaux,
 *     forme de la journée relevée dans la carte de chaleur) et on les projette
 *     sur les vraies dates. Un axe qui annoncerait « Ven · Sam · Dim » un
 *     mardi trahirait la fixture avant qu'on ait lu un seul chiffre — et la
 *     journée en cours doit s'arrêter à l'heure qu'il est, pas se remplir
 *     jusqu'à 22 h dès le petit-déjeuner.
 *
 *   · LE PLANNING D'ÉQUIPE est ENGENDRÉ pour la semaine demandée. Rejouer des
 *     pointages figés donnerait un planning vide un lundi matin et plein un
 *     dimanche soir, au hasard du jour de la visite.
 *
 *   · L'ABONNEMENT déroule douze mois de factures. La base de staging n'en
 *     porte que trois : un historique plus court que le tunnel d'inscription
 *     dirait le contraire de ce que la page veut dire.
 *
 * ─── TOUT EST MUTABLE, RIEN N'EST PERSISTÉ ───
 *
 * Le visiteur change un prix, déclare une rupture, accepte une commande,
 * répond à un avis : l'objet est modifié ICI, en mémoire, et l'écran suivant
 * le voit. Un rechargement rend l'établissement à son état initial. Une
 * démonstration où cliquer ne fait rien est pire qu'une capture d'écran : elle
 * promet une application et livre une image.
 */

import type {
  Allergen,
  BaseUnit,
  CostsResponse,
  IngredientCategory,
  MeasureUnit,
  PlanningShiftView,
  StockMovementRow,
  StorageMode,
  SupplyBrand,
  SupplyIngredient,
  SupplySupplier,
  SupplySupplierItem,
} from "@sm/contracts";
import type { TenantMe } from "@/lib/api";
import * as S from "./snapshot";
import {
  SEED_CLOSURES,
  SEED_CNAME_TARGET,
  SEED_DOMAINS,
  SEED_DOMAIN_PROVIDER,
  SEED_MOVEMENT_PATTERN,
  SEED_PROMOTIONS,
  SEED_SCREENS,
  type DemoPromo,
} from "./seed";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ─────────────────────────────────────────────────────────────
// Formes internes
// ─────────────────────────────────────────────────────────────

export interface DemoProduct {
  _id: string;
  tenantId: string;
  categoryId: string | null;
  name: string;
  description: string;
  price: number;
  variants: unknown[];
  optionGroups: unknown[];
  removables: { key: string; label: string }[];
  supplements: unknown[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  outOfStockSource: string | null;
  photoUrl: string | null;
  order: number;
  active: boolean;
  updatedAt: string;
}

export interface DemoCategory {
  _id: string;
  tenantId: string;
  name: string;
  order: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoOrderLine {
  productId: string;
  name: string;
  variantKey: string | null;
  variantName: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  removed: string[];
  note: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface DemoOrder {
  _id: string;
  tenantId: string;
  number: number;
  clientId: string;
  channel: "pos" | "online" | "phone";
  type: "surplace" | "emporter" | "pickup";
  lines: DemoOrderLine[];
  totals: { subtotal: number; discount: unknown; total: number };
  payment: {
    method: string;
    tender: string | null;
    status: string;
    cashReceived: number | null;
    changeGiven: number | null;
    stripePaymentIntentId: null;
  };
  status: "new" | "preparing" | "ready" | "delivered" | "cancelled";
  statusHistory: { status: string; at: string }[];
  pickup: { slot: string; customerName: string; customerPhone: string | null } | null;
  note: string | null;
  trackingToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoReview {
  _id: string;
  tenantId: string;
  orderId: null;
  author: string;
  rating: number;
  text: string;
  source: string;
  reply: { text: string; at: string; by: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoStaff {
  _id: string;
  tenantId: string;
  name: string;
  role: "gerant" | "caisse" | "cuisine";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Pointage ouvert — `null` hors service. */
  onDuty: { shiftId: string; clockIn: string } | null;
  lastClockOut: string | null;
}

export interface DemoDeviceRow {
  id: string;
  name: string;
  kind: "pos" | "kds";
  paired: boolean;
  /**
   * L'appareil bat-il encore ?
   *
   * Un poste en service envoie un battement toutes les trente secondes ; son
   * « dernier contact » est donc TOUJOURS récent, jamais une date figée au
   * démarrage. Sans ce drapeau, la caisse de démonstration passait « hors
   * ligne » au bout de cinq minutes de visite — et la page qui doit rassurer
   * le gérant sur l'état de son parc affichait deux pannes.
   */
  beating: boolean;
  lastSeenAt: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  active: boolean;
}

export interface DemoScreenRow {
  id: string;
  name: string;
  orientation: "landscape" | "portrait";
  theme: "brand" | "dark" | "light";
  playlist: unknown[];
  paired: boolean;
  /** Même raison que pour les postes : un écran allumé bat en continu. */
  beating: boolean;
  lastSeenAt: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  active: boolean;
}

export interface DemoDomainRow {
  id: string;
  hostname: string;
  status: "pending_dns" | "issuing_certificate" | "active" | "failed";
  statusLabel: string;
  isPrimary: boolean;
  addedAt: string;
  lastCheckedAt: string | null;
  detail: string | null;
}

export interface DemoRecipe {
  lines: [string, number, string][];
  options: [string, string, string, number, string][];
}

export interface DemoWorld {
  /** Instant de démarrage — toutes les dates en découlent. */
  bootAt: number;
  tenant: TenantMe;
  categories: DemoCategory[];
  products: DemoProduct[];
  boms: Record<string, DemoRecipe>;
  ingredients: SupplyIngredient[];
  suppliers: SupplySupplier[];
  movements: StockMovementRow[];
  priceIncreases: {
    itemId: string;
    supplierId: string;
    supplierName: string;
    ingredientId: string;
    ingredientName: string;
    sku: string | null;
    previousPriceCents: number;
    packPriceCents: number;
    increasePct: number;
    recordedAt: string;
  }[];
  orders: DemoOrder[];
  reviews: DemoReview[];
  staff: DemoStaff[];
  devices: DemoDeviceRow[];
  screens: DemoScreenRow[];
  promotions: DemoPromo[];
  domains: DemoDomainRow[];
  billing: Record<string, unknown>;
  /**
   * Services PRÉVUS, par semaine (`AAAA-MM-JJ` du lundi).
   *
   * Engendrés à la demande puis CONSERVÉS : un visiteur qui pose un service,
   * change de semaine et revient doit retrouver ce qu'il a posé. Une
   * regénération à chaque lecture effacerait ses gestes et l'écran donnerait
   * l'impression de ne rien enregistrer.
   */
  planning: Record<string, PlanningShiftView[]>;
  /** Compteur d'identifiants — un objet créé en démonstration a un vrai id. */
  seq: number;
}

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

/** Âge en minutes → date ISO, relativement à l'instant de démarrage. */
export const at = (bootAt: number, ageMin: number): string =>
  new Date(bootAt - ageMin * MIN).toISOString();

/**
 * Remplace récursivement les jetons `@<âge en minutes>` par de vraies dates.
 * Employé sur les charges utiles profondes (l'abonnement) où énumérer les
 * champs datés à la main serait une source d'oublis silencieux.
 */
export function reviveAges(value: unknown, bootAt: number): unknown {
  if (typeof value === "string") {
    return /^@-?\d+$/.test(value) ? at(bootAt, Number(value.slice(1))) : value;
  }
  if (Array.isArray(value)) return value.map((v) => reviveAges(v, bootAt));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reviveAges(v, bootAt)]),
    );
  }
  return value;
}

/** Jour ISO (1 = lundi … 7 = dimanche) de l'horloge locale du visiteur. */
export const isoDay = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

// ─────────────────────────────────────────────────────────────
// Construction du monde
// ─────────────────────────────────────────────────────────────

export function createWorld(bootAt: number): DemoWorld {
  const iso = (ageMin: number) => at(bootAt, ageMin);

  // ── Établissement ──
  const tenant: TenantMe = {
    _id: "t1",
    slug: S.SNAP_TENANT.slug,
    name: S.SNAP_TENANT.name,
    logoUrl: S.SNAP_TENANT.logoUrl,
    brandColor: S.SNAP_TENANT.brandColor,
    address: S.SNAP_TENANT.address,
    phones: [...S.SNAP_TENANT.phones],
    hours: JSON.parse(JSON.stringify(S.SNAP_TENANT.hours)) as TenantMe["hours"],
    // La base de staging n'en porte aucune ; sans ces deux-là, la section
    // « Fermetures exceptionnelles » de l'écran Horaires serait un vide.
    closures: SEED_CLOSURES.map((c) => ({
      from: iso(c.fromAgeMin),
      to: iso(c.toAgeMin),
      reason: c.reason,
    })),
    plan: S.SNAP_TENANT.plan as TenantMe["plan"],
    settings: { ...(S.SNAP_TENANT.settings as TenantMe["settings"]), dailyGoalCents: 90_000 },
  };

  // ── Carte ──
  const categories: DemoCategory[] = S.SNAP_CATEGORIES.map((c) => ({
    _id: c.id,
    tenantId: "t1",
    name: c.name,
    order: c.order,
    active: c.active,
    createdAt: iso(400 * 24 * 60),
    updatedAt: iso(3 * 24 * 60),
  }));

  const supplementByKey = S.SNAP_SUPPLEMENTS as Record<string, unknown>;
  const removableByKey = S.SNAP_REMOVABLES as Record<string, string>;

  const products: DemoProduct[] = S.SNAP_PRODUCTS.map((p) => ({
    _id: p.id,
    tenantId: "t1",
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    price: p.price,
    variants: p.variants as unknown[],
    optionGroups: (p.groupSet ? (S.SNAP_GROUP_SETS[p.groupSet] ?? []) : []).map(
      (g) => S.SNAP_GROUPS[g],
    ),
    removables: (p.removableSet ? (S.SNAP_REMOVABLE_SETS[p.removableSet] ?? []) : []).map(
      (k) => ({ key: k, label: removableByKey[k] ?? k }),
    ),
    supplements: (p.supplementSet ? (S.SNAP_SUPPLEMENT_SETS[p.supplementSet] ?? []) : []).map(
      (k) => supplementByKey[k],
    ),
    tags: [...p.tags],
    isNew: p.isNew,
    outOfStock: p.outOfStock,
    outOfStockSource: p.outOfStockSource,
    photoUrl: p.photoUrl,
    order: p.order,
    active: p.active,
    updatedAt: iso(2 * 24 * 60),
  }));

  const boms: Record<string, DemoRecipe> = JSON.parse(JSON.stringify(S.SNAP_BOMS));

  // ── Ingrédients ──
  const ingredients: SupplyIngredient[] = S.SNAP_INGREDIENTS.map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category as IngredientCategory,
    unit: i.unit as BaseUnit,
    allergens: [...i.allergens] as Allergen[],
    costPerUnitCents: i.costPerUnitCents,
    currentStock: i.currentStock,
    parLevel: i.parLevel,
    storage: i.storage as StorageMode,
    isOut: i.isOut,
    active: true,
    removable: i.removable,
    supplementPriceCents: i.supplementPriceCents,
    displayName: i.displayName,
    belowPar: i.currentStock < i.parLevel,
    brands: i.brands.map(
      (b): SupplyBrand => ({
        id: b.id,
        ingredientId: i.id,
        name: b.name,
        preferred: b.preferred,
        notes: b.notes,
      }),
    ),
  }));
  const ingById = new Map(ingredients.map((i) => [i.id, i]));

  // ── Fournisseurs ──
  const suppliers: SupplySupplier[] = S.SNAP_SUPPLIERS.map((s) => ({
    id: s.id,
    name: s.name,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    paymentTerms: s.paymentTerms,
    deliveryDays: s.deliveryDays,
    notes: s.notes,
    active: s.active,
    items: s.items.map((it): SupplySupplierItem => {
      const ing = ingById.get(it.ingredientId);
      return {
        id: it.id,
        supplierId: s.id,
        ingredientId: it.ingredientId,
        brandId: it.brandId,
        sku: it.sku,
        packQty: it.packQty,
        packPriceCents: it.packPriceCents,
        active: it.active,
        ingredient: ing ? { id: ing.id, name: ing.name, unit: ing.unit } : null,
        brand: null,
      };
    }),
  }));
  const supById = new Map(suppliers.map((s) => [s.id, s]));

  const priceIncreases = S.SNAP_PRICE_INCREASES.map((a) => ({
    itemId: a.itemId,
    supplierId: a.supplierId,
    supplierName: supById.get(a.supplierId)?.name ?? "Fournisseur",
    ingredientId: a.ingredientId,
    ingredientName: ingById.get(a.ingredientId)?.name ?? "Ingrédient",
    sku: a.sku,
    previousPriceCents: a.previousPriceCents,
    packPriceCents: a.packPriceCents,
    increasePct: a.increasePct,
    recordedAt: iso(a.recordedAtAgeMin),
  }));

  // ── Journal des mouvements ──
  //
  // Déroulé depuis le motif de `seed.ts` sur les ingrédients RÉELS : le journal
  // parle des produits du Comptoir, pas d'un jeu d'essai parallèle.
  const movements: StockMovementRow[] = SEED_MOVEMENT_PATTERN.map((m, k) => {
    const ing = ingredients[m.pick % ingredients.length]!;
    const base = ing.parLevel > 0 ? ing.parLevel : Math.max(1, ing.currentStock);
    const qty = Math.round(base * m.ratio * 100) / 100;
    return {
      id: `mv${k + 1}`,
      ingredientId: ing.id,
      ingredientName: ing.name,
      unit: ing.unit,
      type: m.type,
      qty,
      ref: m.ref,
      note: m.note,
      at: iso(m.ageMin),
    };
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // ── Commandes du service en cours ──
  //
  // L'écran des commandes charge `/orders?since=<minuit local>` : une commande
  // plus vieille que le début de la journée n'y apparaît tout simplement pas.
  // À 00 h 20, les vingt-six commandes de la fixture (jusqu'à quatre heures
  // d'ancienneté) tomberaient donc toutes hors champ et le visiteur trouverait
  // une liste vide. On COMPRIME les anciennetés pour qu'elles tiennent dans la
  // journée en cours — le service reste lisible à n'importe quelle heure.
  const sinceMidnight = dayOffsetMin(new Date(bootAt));
  const oldest = Math.max(...S.SNAP_ORDERS.map((o) => o.ageMin), 1);
  const room = Math.max(12, sinceMidnight - 3);
  const squeeze = oldest > room ? room / oldest : 1;
  const orderAge = (m: number) => Math.max(0, Math.round(m * squeeze));

  const orders: DemoOrder[] = S.SNAP_ORDERS.map((o, k) => {
    const createdAt = iso(orderAge(o.ageMin));
    return {
      _id: `o${k + 1}`,
      tenantId: "t1",
      number: o.number,
      clientId: `demo-client-${k + 1}`,
      channel: o.channel as DemoOrder["channel"],
      type: o.type as DemoOrder["type"],
      lines: o.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        variantKey: l.variantKey,
        variantName: l.variantName,
        options: l.options.map((op) => ({ ...op })),
        removed: [...l.removed],
        note: l.note,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      totals: { ...o.totals },
      payment: { ...o.payment, stripePaymentIntentId: null },
      status: o.status as DemoOrder["status"],
      statusHistory: historyFor(o.status as DemoOrder["status"], orderAge(o.ageMin), bootAt),
      pickup: o.pickup
        ? {
            slot: iso(orderAge(o.pickup.slotAgeMin)),
            customerName: o.pickup.customerName,
            customerPhone: o.pickup.customerPhone,
          }
        : null,
      note: o.note,
      trackingToken: `demo-token-${k + 1}`,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // ── Avis ──
  const reviews: DemoReview[] = S.SNAP_REVIEWS.map((r) => ({
    _id: r.id,
    tenantId: "t1",
    orderId: null,
    author: r.author,
    rating: r.rating,
    text: r.text,
    source: "manual",
    reply: r.reply
      ? { text: r.reply.text, at: iso(r.reply.atAgeMin), by: r.reply.by }
      : null,
    createdAt: iso(r.createdAtAgeMin),
    updatedAt: iso(r.createdAtAgeMin),
  }));

  // ── Équipe ──
  //
  // Qui est en poste se déduit de l'heure qu'il est : deux équipiers pointés en
  // plein service, personne à 4 h du matin. Une liste figée afficherait
  // « en poste depuis 14 h » à un visiteur nocturne.
  const now = new Date(bootAt);
  const inService = isWithinService(tenant, now);
  const staff: DemoStaff[] = S.SNAP_CREW.map((c, k) => {
    const onShiftNow = inService && ROSTER[k]!.includes(isoDay(now));
    return {
      _id: `st${k + 1}`,
      tenantId: "t1",
      name: c.name,
      role: c.role as DemoStaff["role"],
      active: true,
      createdAt: iso(300 * 24 * 60),
      updatedAt: iso(30 * 24 * 60),
      onDuty: onShiftNow
        ? { shiftId: `sh-live-${k + 1}`, clockIn: iso(90 + k * 12) }
        : null,
      lastClockOut: onShiftNow ? null : iso(dayOffsetMin(now) + 60 + k * 7),
    };
  });

  // ── Postes et écrans ──
  //
  // Le premier poste bat, le second non : un parc où tout est vert ne dit pas
  // au gérant à quoi ressemble une panne, et c'est précisément pour ça qu'il
  // ouvre cette page.
  const devices: DemoDeviceRow[] = S.SNAP_DEVICES.map((d, k) => ({
    id: d.id,
    name: d.name,
    kind: d.kind as DemoDeviceRow["kind"],
    paired: d.paired,
    beating: d.paired && k === 0,
    lastSeenAt: d.lastSeenAtAgeMin === null ? null : iso(k === 0 ? 1 : 190),
    pairingCode: null,
    pairingExpiresAt: null,
    active: d.active,
  }));

  const screens: DemoScreenRow[] = SEED_SCREENS.map((s) => ({
    id: s.id,
    name: s.name,
    orientation: s.orientation,
    theme: s.theme,
    playlist: s.playlist as unknown[],
    paired: s.paired,
    beating: s.paired,
    lastSeenAt: s.lastSeenAtAgeMin === null ? null : iso(s.lastSeenAtAgeMin),
    pairingCode: s.pairingCode,
    pairingExpiresAt: s.pairingCode ? iso(-s.pairingExpiresInMin) : null,
    active: s.active,
  }));

  // ── Noms de domaine ──
  const domains: DemoDomainRow[] = SEED_DOMAINS.map((d, k) => ({
    id: `dom${k + 1}`,
    hostname: d.hostname,
    status: d.status,
    statusLabel: d.statusLabel,
    isPrimary: d.isPrimary,
    addedAt: iso(d.addedAtAgeMin),
    lastCheckedAt: d.lastCheckedAtAgeMin === null ? null : iso(d.lastCheckedAtAgeMin),
    detail: d.detail,
  }));

  return {
    bootAt,
    tenant,
    categories,
    products,
    boms,
    ingredients,
    suppliers,
    movements,
    priceIncreases,
    orders,
    reviews,
    staff,
    devices,
    screens,
    promotions: SEED_PROMOTIONS.map((p) => ({ ...p, channels: [...p.channels] })),
    domains,
    billing: buildBilling(bootAt),
    planning: {},
    seq: 1000,
  };
}

/**
 * Historique de statuts plausible à rebours du statut courant.
 *
 * L'écran des commandes affiche « acceptée à 19:04, prête à 19:16 » : sans
 * historique, il n'aurait qu'une ligne et le suivi paraîtrait cassé.
 */
function historyFor(
  status: DemoOrder["status"],
  ageMin: number,
  bootAt: number,
): { status: string; at: string }[] {
  const steps: [DemoOrder["status"], number][] = [["new", 0]];
  if (status === "cancelled") steps.push(["cancelled", 6]);
  else {
    if (status !== "new") steps.push(["preparing", 3]);
    if (status === "ready" || status === "delivered") steps.push(["ready", 11]);
    if (status === "delivered") steps.push(["delivered", 16]);
  }
  return steps.map(([s, offset]) => ({
    status: s,
    at: at(bootAt, Math.max(0, ageMin - offset)),
  }));
}

/** Roulement hebdomadaire par équipier — jours ISO travaillés. */
const ROSTER: number[][] = [
  [1, 2, 3, 4, 5, 6], // gérant : partout sauf le dimanche
  [2, 3, 4, 5, 6, 7],
  [1, 2, 3, 5, 6, 7],
  [1, 4, 5, 6, 7],
  [2, 3, 4, 6, 7],
  [1, 3, 4, 5, 6],
];

/** Minutes écoulées depuis minuit local. */
const dayOffsetMin = (d: Date): number => d.getHours() * 60 + d.getMinutes();

/** Minutes depuis minuit d'un horaire « HH:MM ». */
const hhmmMin = (v: string): number => {
  const [h = "0", m = "0"] = v.split(":");
  return Number(h) * 60 + Number(m);
};

/** Ouverture et fermeture d'une journée, `null` si le restaurant ne sert pas. */
function serviceSpan(tenant: TenantMe, d: Date): { open: number; close: number } | null {
  const day = tenant.hours.find((h) => h.day === isoDay(d));
  if (!day) return null;
  const slots = [day.lunch, day.dinner].filter(Boolean) as { open: string; close: string }[];
  if (slots.length === 0) return null;
  return {
    open: Math.min(...slots.map((s) => hhmmMin(s.open))),
    close: Math.max(...slots.map((s) => hhmmMin(s.close))),
  };
}

/** Le restaurant sert-il à cet instant, d'après ses horaires réels ? */
function isWithinService(tenant: TenantMe, d: Date): boolean {
  const day = tenant.hours.find((h) => h.day === isoDay(d));
  if (!day) return false;
  const minutes = dayOffsetMin(d);
  const inSlot = (slot: { open: string; close: string } | null) =>
    slot !== null && minutes >= hhmmMin(slot.open) && minutes <= hhmmMin(slot.close);
  return inSlot(day.lunch) || inSlot(day.dinner);
}

/**
 * L'HORLOGE DE SERVICE — celle sur laquelle les statistiques sont projetées.
 *
 * Un restaurant ne sert pas à 5 h du matin. Projeter la journée sur l'heure
 * BRUTE donnerait donc, pour tout visiteur venu hors service, un tableau de
 * bord à zéro euro et un graphique horaire entièrement plat : rigoureusement
 * exact, et rigoureusement inutile. C'est même le cas le plus probable — on
 * regarde une vitrine à l'heure où l'on a le temps, rarement en plein rush.
 *
 * On recale donc la journée sur le DERNIER SERVICE :
 *   · en plein service          → l'heure qu'il est, la journée se remplit sous
 *                                 les yeux du visiteur ;
 *   · après la fermeture        → la fermeture du jour, journée complète ;
 *   · avant la première ouverture → la fermeture de la veille.
 *
 * Rien n'est inventé : c'est la même journée, lue au dernier instant où elle
 * avait quelque chose à dire. Et les commandes, elles, gardent l'heure réelle
 * (voir `orderAges`) — un ticket doit dire « il y a 4 min », pas « il y a 4 min
 * hier soir ».
 */
export function serviceClock(tenant: TenantMe, bootAt: number): Date {
  const now = new Date(bootAt);
  const today = serviceSpan(tenant, now);
  if (today) {
    const minutes = dayOffsetMin(now);
    if (minutes >= today.open) {
      if (minutes <= today.close) return now;
      const closed = new Date(now);
      closed.setHours(0, today.close, 0, 0);
      return closed;
    }
  }
  // Avant l'ouverture (ou jour de fermeture) : on remonte au dernier jour servi.
  for (let back = 1; back <= 7; back++) {
    const d = new Date(bootAt - back * DAY);
    const span = serviceSpan(tenant, d);
    if (!span) continue;
    d.setHours(0, span.close, 0, 0);
    return d;
  }
  return now;
}

// ─────────────────────────────────────────────────────────────
// Planning : engendré pour la fenêtre demandée
// ─────────────────────────────────────────────────────────────

export interface DemoShiftRow {
  _id: string;
  staffId: string;
  clockIn: string;
  clockOut: string | null;
  source: string;
  hours: number | null;
}

/**
 * Pointages de la fenêtre `[from, to)`.
 *
 * Engendrés à la demande plutôt que rejoués : la semaine affichée est celle
 * que le visiteur regarde. Les jours à venir sont vides (personne n'a encore
 * pointé), le jour courant s'arrête à l'heure qu'il est, et le service en cours
 * laisse des pointages OUVERTS — c'est ce que le gérant voit en plein coup de
 * feu, et c'est ce qui rend le bouton « badger » lisible.
 */
export function shiftsBetween(world: DemoWorld, from: Date, to: Date): DemoShiftRow[] {
  const rows: DemoShiftRow[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  let n = 0;
  while (cursor.getTime() < to.getTime()) {
    const day = isoDay(cursor);
    const hours = world.tenant.hours.find((h) => h.day === day);
    for (const [k, member] of world.staff.entries()) {
      if (!member.active) continue;
      if (!(ROSTER[k % ROSTER.length] ?? []).includes(day)) continue;
      const slot = hours?.dinner ?? hours?.lunch ?? null;
      if (!slot) continue;
      const [oh = "18", om = "0"] = slot.open.split(":");
      const [ch = "22", cm = "30"] = slot.close.split(":");
      const start = new Date(cursor);
      start.setHours(Number(oh), Number(om) - 30, 0, 0);
      const end = new Date(cursor);
      end.setHours(Number(ch), Number(cm) + 30, 0, 0);
      if (start.getTime() > world.bootAt) continue; // à venir : rien n'est pointé
      if (start.getTime() < from.getTime()) continue;
      const open = end.getTime() > world.bootAt;
      const closedAt = open ? null : end;
      rows.push({
        _id: `sh${++n}`,
        staffId: member._id,
        clockIn: start.toISOString(),
        clockOut: closedAt ? closedAt.toISOString() : null,
        source: "backoffice",
        hours: closedAt
          ? Math.round(((closedAt.getTime() - start.getTime()) / HOUR) * 2) / 2
          : null,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────
// Statistiques : magnitudes mesurées, dates vivantes
// ─────────────────────────────────────────────────────────────

type Period = "1d" | "7d" | "30d";

const statsOf = (p: Period) => S.SNAP_STATS[p] ?? S.SNAP_STATS["7d"]!;

/** Commandes relevées dans la carte de chaleur, par jour ISO puis par heure. */
const heatByDay = (() => {
  const table = new Map<number, Map<number, number>>();
  for (const cell of S.SNAP_HEATMAP) {
    const row = table.get(cell.day) ?? new Map<number, number>();
    row.set(cell.hour, cell.orders);
    table.set(cell.day, row);
  }
  return table;
})();

const dayWeight = (day: number): number => {
  let sum = 0;
  for (const n of heatByDay.get(day)?.values() ?? []) sum += n;
  return sum;
};

const WEEK_WEIGHT = (() => {
  let sum = 0;
  for (let d = 1; d <= 7; d++) sum += dayWeight(d);
  return sum || 1;
})();

/** Chiffre d'affaires d'une journée COMPLÈTE de ce jour de semaine. */
const dayCaCents = (day: number): number =>
  Math.round((statsOf("7d").caCents * dayWeight(day)) / WEEK_WEIGHT);

/**
 * Part de la journée déjà servie à l'instant `d`, d'après la courbe relevée.
 * Avant l'ouverture, zéro : c'est ce qui fait qu'un visiteur du matin voit une
 * journée qui commence, et non une journée entière déjà encaissée.
 */
function elapsedShare(d: Date): number {
  const row = heatByDay.get(isoDay(d));
  if (!row) return 0;
  const total = dayWeight(isoDay(d)) || 1;
  const hour = d.getHours();
  const partial = (d.getMinutes() / 60) * (row.get(hour) ?? 0);
  let done = 0;
  for (const [h, n] of row) if (h < hour) done += n;
  return Math.min(1, (done + partial) / total);
}

const WEEKDAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export interface DemoBucket {
  label: string;
  caCents: number;
  orders: number;
}

/**
 * Série temporelle de la période, aux conventions EXACTES de l'API :
 * 1d = heures 11h→22h d'aujourd'hui · 7d = sept jours glissants nommés par
 * leur jour de semaine · 30d = quatre semaines, « S-3 » à « Cette sem. ».
 */
export function timeseries(world: DemoWorld, period: Period): DemoBucket[] {
  const now = serviceClock(world.tenant, world.bootAt);
  const anchor = now.getTime();
  const basket = statsOf("7d").avgBasketCents || 2000;

  if (period === "1d") {
    const day = isoDay(now);
    const row = heatByDay.get(day);
    const total = dayWeight(day) || 1;
    const full = dayCaCents(day);
    const buckets: DemoBucket[] = [];
    for (let h = 11; h <= 22; h++) {
      const share = (row?.get(h) ?? 0) / total;
      let factor = 0;
      if (h < now.getHours()) factor = 1;
      else if (h === now.getHours()) factor = now.getMinutes() / 60;
      const caCents = Math.round(full * share * factor);
      buckets.push({ label: `${h}h`, caCents, orders: Math.round(caCents / basket) });
    }
    return buckets;
  }

  if (period === "7d") {
    const buckets: DemoBucket[] = [];
    for (let k = 6; k >= 0; k--) {
      const d = new Date(anchor - k * DAY);
      const day = isoDay(d);
      const caCents = Math.round(dayCaCents(day) * (k === 0 ? elapsedShare(now) : 1));
      buckets.push({
        label: WEEKDAYS_FR[day - 1] ?? "?",
        caCents,
        orders: Math.round(caCents / basket),
      });
    }
    return buckets;
  }

  // 30d — les trois semaines pleines gardent les montants MESURÉS ; la semaine
  // en cours est recalculée jour par jour, sinon elle serait pleine dès lundi.
  const measured = statsOf("30d").bucketWeights;
  const buckets: DemoBucket[] = [];
  for (let j = 3; j >= 1; j--) {
    const caCents = measured[3 - j] ?? 0;
    buckets.push({ label: `S-${j}`, caCents, orders: Math.round(caCents / basket) });
  }
  let current = 0;
  for (let k = isoDay(now) - 1; k >= 0; k--) {
    const d = new Date(anchor - k * DAY);
    current += Math.round(dayCaCents(isoDay(d)) * (k === 0 ? elapsedShare(now) : 1));
  }
  buckets.push({ label: "Cette sem.", caCents: current, orders: Math.round(current / basket) });
  return buckets;
}

export function overview(world: DemoWorld, period: Period) {
  const buckets = timeseries(world, period);
  const caCents = buckets.reduce((s, b) => s + b.caCents, 0);
  const orders = buckets.reduce((s, b) => s + b.orders, 0);
  const measured = statsOf(period);
  return {
    period,
    caCents,
    orders,
    avgBasketCents: orders > 0 ? Math.round(caCents / orders) : 0,
    // Les évolutions mesurées restent celles de la vraie base pour 7 et 30
    // jours ; sur la journée, on compare à la même heure la veille — c'est la
    // seule comparaison qui ait un sens à 14 h.
    deltas:
      period === "1d"
        ? dailyDeltas(world)
        : (measured.deltas as { caPct: number | null; ordersPct: number | null; avgBasketPct: number | null }),
  };
}

function dailyDeltas(world: DemoWorld) {
  const now = serviceClock(world.tenant, world.bootAt);
  const share = elapsedShare(now);
  const today = dayCaCents(isoDay(now)) * share;
  const yesterday = dayCaCents(isoDay(new Date(now.getTime() - DAY))) * share;
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return { caPct: pct(today, yesterday), ordersPct: pct(today, yesterday), avgBasketPct: 0 };
}

/** Part de la période courante par rapport à la semaine mesurée. */
function scaleFor(world: DemoWorld, period: Period): number {
  if (period !== "1d") return 1;
  const week = statsOf("7d").caCents || 1;
  const today = overview(world, "1d").caCents;
  return today / week;
}

export function topProducts(world: DemoWorld, period: Period, limit: number) {
  const source = statsOf(period === "1d" ? "7d" : period).topProducts;
  const scale = scaleFor(world, period);
  return source
    .map((t) => ({
      name: t.name,
      qty: Math.max(period === "1d" ? 0 : 1, Math.round(t.qty * scale)),
      caCents: Math.round(t.caCents * scale),
    }))
    .filter((t) => t.qty > 0)
    .slice(0, limit);
}

export function channels(world: DemoWorld, period: Period) {
  const source = statsOf(period === "1d" ? "7d" : period).channels;
  const scale = scaleFor(world, period);
  return source.map((c) => ({
    channel: c.channel,
    orders: Math.round(c.orders * scale),
    caCents: Math.round(c.caCents * scale),
  }));
}

export function prepTimes(world: DemoWorld, period: Period) {
  // La journée en cours n'a pas encore assez de commandes servies pour un p90
  // honnête : on rend la mesure de la semaine, qui est celle que l'API
  // renverrait passé le premier coup de feu.
  const measured = statsOf(period === "1d" ? "7d" : period).prepTimes;
  return {
    period,
    avgMinutes: measured.avgMinutes,
    p90Minutes: measured.p90Minutes,
    orders: period === "1d" ? overview(world, "1d").orders : measured.orders,
  };
}

/**
 * Compteurs de la barre du tableau de bord — calculés sur l'état VIVANT.
 * Accepter une commande fait donc bouger le compteur sous les yeux du visiteur.
 */
export function summaryLive(world: DemoWorld) {
  const today = overview(world, "1d");
  return {
    caTodayCents: today.caCents,
    ordersToday: today.orders,
    newCount: world.orders.filter((o) => o.status === "new").length,
    readyCount: world.orders.filter((o) => o.status === "ready").length,
    reviewsPendingCount: world.reviews.filter((r) => !r.reply).length,
    productsOutCount: world.products.filter((p) => p.outOfStock).length,
  };
}

// ─────────────────────────────────────────────────────────────
// Recettes et coûts — recalculés sur l'état vivant des ingrédients
// ─────────────────────────────────────────────────────────────

/** Conversion vers l'unité de base de l'ingrédient (g→kg, ml→l). */
const toBase = (qty: number, unit: MeasureUnit): number =>
  unit === "g" || unit === "ml" ? qty / 1000 : qty;

function lineOf(world: DemoWorld, ingredientId: string, qty: number, unit: string) {
  const ing = world.ingredients.find((i) => i.id === ingredientId);
  return {
    ingredientId,
    name: ing?.name ?? "Ingrédient retiré",
    qty,
    unit: unit as MeasureUnit,
    costCents: Math.round(toBase(qty, unit as MeasureUnit) * (ing?.costPerUnitCents ?? 0)),
    allergens: ing?.allergens ?? [],
    // Recalculé, jamais figé : déclarer une rupture depuis l'écran Ingrédients
    // doit se voir dans la fiche produit sans recharger la démonstration.
    isOut: ing?.isOut === true,
  };
}

export function bomOf(world: DemoWorld, productId: string) {
  const recipe = world.boms[productId] ?? { lines: [], options: [] };
  const product = world.products.find((p) => p._id === productId);
  const lines = recipe.lines.map(([id, qty, unit]) => lineOf(world, id, qty, unit));
  const options = recipe.options.map(([groupKey, choiceKey, id, qty, unit]) => ({
    groupKey,
    choiceKey,
    ...lineOf(world, id, qty, unit),
  }));
  const costCents = lines.reduce((s, l) => s + l.costCents, 0);
  const priceCents = product?.price ?? 0;
  const allergens = [
    ...new Set([...lines, ...options].flatMap((l) => l.allergens)),
  ] as Allergen[];
  return {
    recipes: [{ variantKey: null, lines, costCents }],
    options,
    costByVariant: { base: costCents },
    allergens,
    marginByVariant: {
      base: {
        priceCents,
        costCents,
        marginCents: priceCents - costCents,
        marginPct:
          priceCents > 0 ? Math.round(((priceCents - costCents) / priceCents) * 1000) / 10 : 0,
      },
    },
  };
}

export function costsOf(world: DemoWorld, refs: string[]): CostsResponse {
  const out: CostsResponse = {};
  for (const ref of refs) {
    const product = world.products.find((p) => p._id === ref);
    if (!product) continue;
    const recipe = world.boms[ref];
    const costCents = (recipe?.lines ?? []).reduce(
      (s, [id, qty, unit]) => s + lineOf(world, id, qty, unit).costCents,
      0,
    );
    out[ref] = {
      costCents,
      marginPct:
        product.price > 0
          ? Math.round(((product.price - costCents) / product.price) * 1000) / 10
          : null,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Abonnement
// ─────────────────────────────────────────────────────────────

/**
 * Douze mois de factures déroulés depuis le modèle photographié.
 *
 * La base de staging n'en porte que trois — un historique d'abonnement plus
 * court que le tunnel d'inscription, ce qui dirait exactement le contraire de
 * ce que la page promet (« retrouvez toutes vos factures »). On garde donc la
 * FORME réelle d'une facture, et on la déroule mois par mois à rebours du
 * mois courant, libellés français compris.
 */
function buildBilling(bootAt: number): Record<string, unknown> {
  const source = reviveAges(S.SNAP_BILLING, bootAt) as {
    tenant: unknown;
    subscription: Record<string, unknown>;
    outstanding: Record<string, unknown>;
    invoices: Record<string, unknown>[];
    legalGaps: unknown;
  };
  const template =
    source.invoices.find((i) => i.kind === "abonnement") ?? source.invoices[0] ?? {};
  const setup = source.invoices.find((i) => i.kind === "mise_en_place");
  const amount = (source.subscription.mrrCents as number) ?? 13900;
  const planLabel = (source.subscription.planLabel as string) ?? "Complet";

  // Bornes de mois en UTC : une facture datée « 1er septembre » à l'heure de
  // Paris s'écrit `31/08T22:00Z`, et la page — qui formate en UTC — afficherait
  // une échéance au 31 août pour la facture de septembre. Un décalage d'un jour
  // sur un document comptable est le genre de détail qui coûte la confiance.
  const now = new Date(bootAt);
  const firstOfMonth = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const monthLabel = (d: Date) => `${MONTHS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const key = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  /** Ancienneté du compte : douze mois de factures, donc douze mois de client. */
  const HISTORY_MONTHS = 11;
  const opened = firstOfMonth(-HISTORY_MONTHS);

  // Les numéros suivent le TEMPS, du plus ancien au plus récent : un
  // SM-2026-0004 daté d'avant un SM-2026-0003 se repère au premier coup d'œil
  // et fait douter de tout le reste du document.
  let seq = setup ? 1 : 0;
  const invoice = (offset: number, paid: boolean) => {
    const start = firstOfMonth(offset);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    seq += 1;
    return {
      ...template,
      _id: `inv${seq}`,
      number: `SM-${start.getUTCFullYear()}-${String(seq).padStart(4, "0")}`,
      kind: "abonnement",
      kindLabel: "Abonnement",
      label: `Abonnement ${planLabel} — ${monthLabel(start)}`,
      period: {
        key: key(start),
        start: start.toISOString(),
        end: end.toISOString(),
        label: monthLabel(start),
      },
      amountCents: amount,
      amountLabel: euros(amount),
      status: paid ? "payee" : "envoyee",
      statusLabel: paid ? "Payée" : "Envoyée",
      storedStatus: paid ? "payee" : "envoyee",
      issuedAt: new Date(start.getTime() - 12 * DAY).toISOString(),
      dueAt: start.toISOString(),
      paidAt: paid ? new Date(start.getTime() + 9 * HOUR).toISOString() : null,
      method: paid ? "prelevement" : null,
      methodLabel: paid ? "Prélèvement SEPA" : null,
      cancelledAt: null,
      cancelReason: "",
      overdueDays: 0,
      dueCents: paid ? 0 : amount,
    };
  };

  // Émission chronologique (numérotation croissante), affichage anti-chronologique.
  const chronological: Record<string, unknown>[] = [];
  if (setup) {
    chronological.push({
      ...setup,
      _id: "inv-setup",
      number: `SM-${opened.getUTCFullYear()}-0001`,
      label: `Mise en place — onboarding et formation (${monthLabel(opened)})`,
      period: {
        key: key(opened),
        start: opened.toISOString(),
        end: opened.toISOString(),
        label: monthLabel(opened),
      },
      issuedAt: opened.toISOString(),
      dueAt: opened.toISOString(),
      paidAt: opened.toISOString(),
    });
  }
  for (let k = -HISTORY_MONTHS; k <= 0; k++) chronological.push(invoice(k, true));
  const upcoming = invoice(1, false);
  chronological.push(upcoming);

  const nextStart = firstOfMonth(1);
  return {
    tenant: source.tenant,
    subscription: {
      ...source.subscription,
      // Le compte doit être aussi vieux que ses factures ; « client depuis
      // avant-hier » sous douze mois d'historique se contredit tout seul.
      since: opened.toISOString(),
    },
    nextDue: {
      at: nextStart.toISOString(),
      amountCents: amount,
      amountLabel: euros(amount),
      daysUntil: Math.max(0, Math.ceil((nextStart.getTime() - bootAt) / DAY)),
      invoiceNumber: upcoming.number,
    },
    outstanding: {
      ...source.outstanding,
      totalDueCents: amount,
      totalDueLabel: euros(amount),
      invoices: 1,
      overdueCents: 0,
      overdueLabel: euros(0),
      overdueInvoices: 0,
      oldestOverdueAt: null,
      oldestOverdueDays: 0,
    },
    invoices: chronological.reverse(),
    legalGaps: source.legalGaps,
    generatedAt: new Date(bootAt).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// Vues dérivées partagées avec le routeur
// ─────────────────────────────────────────────────────────────

/** « 20 min », « 3 h », « 2 j » — même règle que `screens.view.ts` côté API. */
export function sinceLabel(elapsedMs: number): string {
  if (elapsedMs < HOUR) return `${Math.max(1, Math.floor(elapsedMs / MIN))} min`;
  if (elapsedMs < 2 * DAY) return `${Math.floor(elapsedMs / HOUR)} h`;
  return `${Math.floor(elapsedMs / DAY)} j`;
}

export const SITE_SUBDOMAIN = `${S.SNAP_TENANT.slug}.snackmanager.app`;
export const CNAME_TARGET = SEED_CNAME_TARGET;
export const DOMAIN_PROVIDER = SEED_DOMAIN_PROVIDER;
export const REVIEW_COUNTS = S.SNAP_REVIEW_COUNTS;
export const HEATMAP = S.SNAP_HEATMAP;
