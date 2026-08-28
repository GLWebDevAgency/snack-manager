"use client";

/**
 * L'API DU BACK-OFFICE, EN MÉMOIRE.
 *
 * Ce fichier répond aux MÊMES routes que l'API, avec les mêmes formes et les
 * mêmes statuts d'erreur, depuis l'établissement de `state.ts`. Le back-office
 * ne sait pas qu'il ne parle pas au réseau : ce que le visiteur manipule est la
 * vraie application, pas une maquette qui lui ressemble.
 *
 * ─── LES ÉCRITURES SONT ACCEPTÉES, ET ELLES SE VOIENT ───
 *
 * Changer un prix, déclarer une rupture, accepter une commande, répondre à un
 * avis, basculer une promotion : l'objet est modifié en mémoire et l'écran
 * suivant le lit. C'est ce qui distingue une démonstration d'une capture
 * d'écran — et c'est aussi ce qui fait qu'un restaurateur comprend qu'il tient
 * un outil et pas une brochure.
 *
 * ─── CE QUI EST CALCULÉ ICI PLUTÔT QUE FIGÉ ───
 *
 * Les libellés d'état (« Hors ligne depuis 12 min »), les alertes de stock, les
 * coûts matière et les compteurs du tableau de bord sont RECALCULÉS à chaque
 * requête, exactement comme le fait l'API. Figés, ils mentiraient dès la
 * première écriture : on déclarerait une rupture et l'écran des alertes
 * continuerait d'afficher l'ancienne liste.
 *
 * ─── LA LATENCE EST UNE FONCTIONNALITÉ ───
 *
 * Une application qui répond en 0 ms ne fait pas vrai : les états de
 * chargement ne s'affichent jamais, les squelettes ne clignotent pas, et
 * l'ensemble sent la maquette. On rend donc en 70 à 200 ms.
 */

import {
  DEVICE_KIND_LABELS,
  DEVICE_OFFLINE_AFTER_MS,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  SCREEN_OFFLINE_AFTER_MS,
  SCREEN_ORIENTATION_LABELS,
  SCREEN_THEME_LABELS,
  mostAdvancedStatus,
  type DeviceKind,
  type OrderStatus,
  type PlanningPosition,
  type PlanningShiftView,
  type PlanningStatus,
  type SupplyIngredient,
} from "@sm/contracts";
import {
  bomOf,
  channels,
  costsOf,
  createWorld,
  HEATMAP,
  overview,
  prepTimes,
  REVIEW_COUNTS,
  shiftsBetween,
  sinceLabel,
  summaryLive,
  timeseries,
  topProducts,
  CNAME_TARGET,
  DOMAIN_PROVIDER,
  SITE_SUBDOMAIN,
  type DemoOrder,
  type DemoWorld,
} from "./state";
import {
  PLANNING_STATUS_PUBLISHED,
  planningComparison,
  planningCoverage,
  planningSetStaffCost,
  planningStaffCosts,
  planningWeek,
  shiftsOfWeek,
  weekAnchor,
  withDerived,
  ymd,
} from "./planning";

export interface DemoResponse {
  status: number;
  body: unknown;
}

/** Refus rendu avec la forme d'erreur de l'API (NestJS). */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ok = (body: unknown): DemoResponse => ({ status: 200, body });

/** Retrouve un service prévu et la semaine qui le porte. */
function findShift(
  w: DemoWorld,
  id: string | undefined,
): { week: string; shift: PlanningShiftView } | null {
  if (!id) return null;
  for (const [week, rows] of Object.entries(w.planning)) {
    const shift = rows.find((s) => s.id === id);
    if (shift) return { week, shift };
  }
  return null;
}

/** Copie d'un objet privée de quelques clés — les champs qu'une écriture ne
 *  doit pas laisser passer (une liste imbriquée, un PIN, une date calculée). */
const omit = <T extends Record<string, unknown>>(source: T, ...keys: string[]): T =>
  Object.fromEntries(Object.entries(source).filter(([k]) => !keys.includes(k))) as T;
const refuse = (status: number, message: string): DemoResponse => ({
  status,
  body: { message, statusCode: status, error: status === 404 ? "Not Found" : "Bad Request" },
});

// ─────────────────────────────────────────────────────────────
// Monde partagé
// ─────────────────────────────────────────────────────────────

let world: DemoWorld | null = null;

/**
 * L'établissement du chargement courant.
 *
 * Il naît au premier appel et meurt avec la page : rien n'est écrit sur le
 * disque du visiteur, donc un rechargement rend une démonstration neuve.
 */
export function demoWorld(): DemoWorld {
  world ??= createWorld(Date.now());
  return world;
}

/** Réservé aux tests : repart d'un établissement neuf. */
export function resetDemoWorld(): void {
  world = null;
}

// ─────────────────────────────────────────────────────────────
// Vues
// ─────────────────────────────────────────────────────────────

const menuView = (w: DemoWorld) => ({
  categories: w.categories
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      ...c,
      products: w.products
        .filter((p) => p.categoryId === c._id)
        .sort((a, b) => a.order - b.order),
    })),
  uncategorized: w.products.filter((p) => p.categoryId === null),
});

/**
 * Dernier battement d'un appareil allumé : toujours il y a une poignée de
 * secondes. Un appareil éteint garde, lui, l'heure où il s'est tu.
 */
const lastBeat = (row: { beating: boolean; lastSeenAt: string | null }): string | null =>
  row.beating ? new Date(Date.now() - 40_000).toISOString() : row.lastSeenAt;

const deviceView = (w: DemoWorld, d: DemoWorld["devices"][number]) => {
  const lastSeenAt = lastBeat(d);
  const elapsed = lastSeenAt ? Date.now() - Date.parse(lastSeenAt) : null;
  const online = d.paired && elapsed !== null && elapsed <= DEVICE_OFFLINE_AFTER_MS;
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    kindLabel: DEVICE_KIND_LABELS[d.kind as DeviceKind],
    paired: d.paired,
    pairing:
      d.pairingCode && d.pairingExpiresAt
        ? {
            code: d.pairingCode,
            expiresAt: d.pairingExpiresAt,
            expired: Date.parse(d.pairingExpiresAt) <= Date.now(),
          }
        : null,
    lastSeenAt,
    online,
    statusLabel: !d.paired
      ? "En attente d'appairage"
      : elapsed === null
        ? "Jamais connecté"
        : online
          ? "En ligne"
          : `Hors ligne depuis ${sinceLabel(elapsed)}`,
    active: d.active,
  };
};

const screenView = (w: DemoWorld, s: DemoWorld["screens"][number]) => {
  const lastSeenAt = lastBeat(s);
  const elapsed = lastSeenAt ? Date.now() - Date.parse(lastSeenAt) : null;
  const online = s.paired && elapsed !== null && elapsed <= SCREEN_OFFLINE_AFTER_MS;
  return {
    id: s.id,
    name: s.name,
    orientation: s.orientation,
    orientationLabel: SCREEN_ORIENTATION_LABELS[s.orientation],
    theme: s.theme,
    themeLabel: SCREEN_THEME_LABELS[s.theme],
    playlist: s.playlist,
    sceneCount: s.playlist.length,
    paired: s.paired,
    pairing:
      s.pairingCode && s.pairingExpiresAt
        ? {
            code: s.pairingCode,
            expiresAt: s.pairingExpiresAt,
            expired: Date.parse(s.pairingExpiresAt) <= Date.now(),
          }
        : null,
    lastSeenAt,
    online,
    statusLabel: !s.paired
      ? "En attente d'appairage"
      : elapsed === null
        ? "Jamais connecté"
        : online
          ? "En ligne"
          : `Hors ligne depuis ${sinceLabel(elapsed)}`,
    active: s.active,
  };
};

const domainView = (d: DemoWorld["domains"][number]) => {
  const label = d.hostname.split(".")[0] ?? "commander";
  return {
    id: d.id,
    hostname: d.hostname,
    url: `https://${d.hostname}`,
    status: d.status,
    statusLabel: d.statusLabel,
    isPrimary: d.isPrimary,
    addedAt: d.addedAt,
    lastCheckedAt: d.lastCheckedAt,
    detail: d.detail,
    dns: {
      type: "CNAME" as const,
      name: label,
      fullName: d.hostname,
      value: CNAME_TARGET,
      ttl: 3600,
    },
  };
};

const promoView = (w: DemoWorld, p: DemoWorld["promotions"][number]) => ({
  _id: p._id,
  name: p.name,
  description: p.description,
  kind: p.kind,
  value: p.value,
  code: p.code,
  channels: p.channels,
  startsAt: p.startsAtAgeMin === null ? null : new Date(w.bootAt - p.startsAtAgeMin * 60_000).toISOString(),
  endsAt: p.endsAtAgeMin === null ? null : new Date(w.bootAt - p.endsAtAgeMin * 60_000).toISOString(),
  active: p.active,
  usageCount: p.usageCount,
});

/**
 * Les alertes ne sont jamais stockées : elles se relisent sur l'état vivant
 * des ingrédients. C'est ce qui fait qu'une rupture déclarée depuis la liste
 * apparaît dans le bandeau d'alertes au rechargement de l'onglet.
 */
const alertsView = (w: DemoWorld) => ({
  ruptures: w.ingredients.filter((i) => i.isOut && i.active),
  belowPar: w.ingredients.filter((i) => !i.isOut && i.active && i.currentStock < i.parLevel),
  priceIncreases: w.priceIncreases,
});

const withBelowPar = (i: SupplyIngredient): SupplyIngredient => ({
  ...i,
  belowPar: i.currentStock < i.parLevel,
});

// ─────────────────────────────────────────────────────────────
// Aiguillage
// ─────────────────────────────────────────────────────────────

export function routeDemo(method: string, rawPath: string, body?: unknown): DemoResponse {
  const w = demoWorld();
  try {
    return dispatch(w, method.toUpperCase(), rawPath, body);
  } catch (err) {
    if (err instanceof Refusal) return refuse(err.status, err.message);
    throw err;
  }
}

function dispatch(w: DemoWorld, method: string, rawPath: string, body?: unknown): DemoResponse {
  const [pathPart = "", queryPart = ""] = rawPath.split("?");
  const path = pathPart.replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(queryPart);
  const seg = path.split("/").filter(Boolean);
  const b = (body ?? {}) as Record<string, unknown>;
  const period = (q.get("period") ?? "7d") as "1d" | "7d" | "30d";
  const id = () => `demo-${++w.seq}`;

  // ─── Établissement ───

  if (path === "/tenants/me" && method === "GET") return ok(w.tenant);

  if (path === "/tenants/me/settings" && method === "PATCH") {
    w.tenant.settings = { ...w.tenant.settings, ...(b as Partial<typeof w.tenant.settings>) };
    return ok(w.tenant);
  }

  if (path === "/tenants/me/hours" && method === "PATCH") {
    if (Array.isArray(b.hours)) w.tenant.hours = b.hours as typeof w.tenant.hours;
    if (Array.isArray(b.closures)) w.tenant.closures = b.closures as typeof w.tenant.closures;
    return ok(w.tenant);
  }

  // ─── Carte ───

  if (path === "/menu" && method === "GET") return ok(menuView(w));

  if (seg[0] === "categories") {
    if (method === "POST" && seg.length === 1) {
      const created = {
        _id: id(),
        tenantId: "t1",
        name: String(b.name ?? "Nouvelle catégorie"),
        order: w.categories.length,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      w.categories.push(created);
      return ok(created);
    }
    if (method === "POST" && seg[1] === "reorder") {
      const ids = (b.ids as string[]) ?? [];
      ids.forEach((cid, i) => {
        const cat = w.categories.find((c) => c._id === cid);
        if (cat) cat.order = i;
      });
      return ok({ ok: true });
    }
    const cat = w.categories.find((c) => c._id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!cat) throw new Refusal(404, "Catégorie introuvable");
      Object.assign(cat, b, { updatedAt: new Date().toISOString() });
      return ok(cat);
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!cat) throw new Refusal(404, "Catégorie introuvable");
      const attached = w.products.filter((p) => p.categoryId === cat._id);
      // Même règle que l'API : on refuse la suppression d'une catégorie encore
      // peuplée, et `force=true` détache les produits au lieu de les perdre.
      if (attached.length > 0 && q.get("force") !== "true") {
        throw new Refusal(409, `${attached.length} produit(s) rattaché(s) à cette catégorie`);
      }
      for (const p of attached) p.categoryId = null;
      w.categories = w.categories.filter((c) => c._id !== cat._id);
      return ok({ ok: true, detached: attached.length });
    }
  }

  if (seg[0] === "products") {
    if (method === "POST" && seg.length === 1) {
      const created = {
        _id: id(),
        tenantId: "t1",
        categoryId: (b.categoryId as string) ?? null,
        name: String(b.name ?? "Nouveau produit"),
        description: String(b.description ?? ""),
        price: Number(b.price ?? 0),
        variants: (b.variants as unknown[]) ?? [],
        optionGroups: [],
        removables: [],
        supplements: [],
        tags: (b.tags as string[]) ?? [],
        isNew: b.isNew === true,
        outOfStock: false,
        outOfStockSource: null,
        photoUrl: null,
        order: w.products.length,
        active: b.active !== false,
        updatedAt: new Date().toISOString(),
      };
      w.products.push(created);
      return ok(created);
    }
    const product = w.products.find((p) => p._id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!product) throw new Refusal(404, "Produit introuvable");
      Object.assign(product, b, { updatedAt: new Date().toISOString() });
      return ok(product);
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!product) throw new Refusal(404, "Produit introuvable");
      w.products = w.products.filter((p) => p._id !== product._id);
      return ok({ ok: true });
    }
    if (seg.length === 3 && seg[2] === "stock" && method === "POST") {
      if (!product) throw new Refusal(404, "Produit introuvable");
      product.outOfStock = b.outOfStock === true;
      product.outOfStockSource = product.outOfStock ? "manual" : null;
      product.updatedAt = new Date().toISOString();
      return ok(product);
    }
  }

  // ─── Commandes ───

  if (seg[0] === "orders") {
    if (method === "GET" && seg.length === 1) {
      const status = q.get("status");
      const since = q.get("since");
      const floor = since ? Date.parse(since) : Number.NaN;
      const rows = w.orders
        .filter((o) => (status ? o.status === status : true))
        .filter((o) => (Number.isFinite(floor) ? Date.parse(o.createdAt) >= floor : true))
        .sort((a, b2) => Date.parse(b2.createdAt) - Date.parse(a.createdAt));
      return ok({ rows, total: rows.length });
    }
    const order = w.orders.find((o) => o._id === seg[1]);
    if (method === "GET" && seg.length === 2) {
      return order ? ok(order) : refuse(404, "Commande introuvable");
    }
    if (seg.length === 3 && seg[2] === "status" && method === "PATCH") {
      if (!order) throw new Refusal(404, "Commande introuvable");
      return ok(advance(order, b.status as OrderStatus));
    }
    if (seg.length === 3 && seg[2] === "cancel" && method === "POST") {
      if (!order) throw new Refusal(404, "Commande introuvable");
      if (order.status === "delivered") {
        throw new Refusal(409, "Commande déjà servie — passer par un remboursement");
      }
      order.status = "cancelled";
      order.statusHistory = [
        ...order.statusHistory,
        { status: "cancelled", at: new Date().toISOString() },
      ];
      order.note = typeof b.reason === "string" && b.reason ? String(b.reason) : order.note;
      return ok(order);
    }
  }

  // ─── Statistiques ───

  if (seg[0] === "stats") {
    if (seg[1] === "overview") return ok(overview(w, period));
    if (seg[1] === "timeseries") return ok({ period, buckets: timeseries(w, period) });
    if (seg[1] === "top-products") {
      return ok(topProducts(w, period, Number(q.get("limit") ?? 5)));
    }
    if (seg[1] === "channels") return ok(channels(w, period));
    if (seg[1] === "heatmap") return ok(HEATMAP);
    if (seg[1] === "prep-times") return ok(prepTimes(w, period));
    if (seg[1] === "summary-live") return ok(summaryLive(w));
  }

  // ─── Approvisionnement ───

  if (seg[0] === "supply") {
    if (seg[1] === "alerts" && method === "GET") return ok(alertsView(w));

    if (seg[1] === "ingredients") {
      if (method === "GET" && seg.length === 2) return ok(w.ingredients.map(withBelowPar));
      if (method === "POST" && seg.length === 2) {
        const created: SupplyIngredient = {
          id: id(),
          name: String(b.name ?? "Nouvel ingrédient"),
          category: (b.category as SupplyIngredient["category"]) ?? "autre",
          unit: (b.unit as SupplyIngredient["unit"]) ?? "kg",
          allergens: (b.allergens as SupplyIngredient["allergens"]) ?? [],
          costPerUnitCents: Number(b.costPerUnitCents ?? 0),
          currentStock: Number(b.currentStock ?? 0),
          parLevel: Number(b.parLevel ?? 0),
          storage: (b.storage as SupplyIngredient["storage"]) ?? "sec",
          isOut: false,
          active: true,
          removable: b.removable === true,
          supplementPriceCents: (b.supplementPriceCents as number | null) ?? null,
          displayName: (b.displayName as string | null) ?? null,
          belowPar: Number(b.currentStock ?? 0) < Number(b.parLevel ?? 0),
          brands: [],
        };
        w.ingredients.push(created);
        return ok(created);
      }
      const ing = w.ingredients.find((i) => i.id === seg[2]);
      if (seg.length === 3 && method === "PATCH") {
        if (!ing) throw new Refusal(404, "Ingrédient introuvable");
        Object.assign(ing, b);
        return ok(withBelowPar(ing));
      }
      if (seg.length === 3 && method === "DELETE") {
        if (!ing) throw new Refusal(404, "Ingrédient introuvable");
        w.ingredients = w.ingredients.filter((i) => i.id !== ing.id);
        return ok({ ok: true });
      }
      if (seg.length === 4 && seg[3] === "out" && method === "POST") {
        if (!ing) throw new Refusal(404, "Ingrédient introuvable");
        ing.isOut = b.isOut === true;
        // Comme l'API : une rupture d'ingrédient coupe les produits dont la
        // recette en dépend. C'est la démonstration la plus parlante de tout
        // l'écran — un clic, et la carte se ferme d'elle-même.
        let productsUpdated = 0;
        for (const [pid, recipe] of Object.entries(w.boms)) {
          if (!recipe.lines.some(([lineIng]) => lineIng === ing.id)) continue;
          const product = w.products.find((p) => p._id === pid);
          if (!product) continue;
          if (ing.isOut && !product.outOfStock) {
            product.outOfStock = true;
            product.outOfStockSource = "ingredient";
            productsUpdated++;
          } else if (!ing.isOut && product.outOfStockSource === "ingredient") {
            product.outOfStock = false;
            product.outOfStockSource = null;
            productsUpdated++;
          }
        }
        return ok({ ingredient: withBelowPar(ing), productsUpdated });
      }
      if (seg.length === 4 && seg[3] === "brands" && method === "POST") {
        if (!ing) throw new Refusal(404, "Ingrédient introuvable");
        const brand = {
          id: id(),
          ingredientId: ing.id,
          name: String(b.name ?? "Marque"),
          preferred: b.preferred === true,
          notes: (b.notes as string | null) ?? null,
        };
        if (brand.preferred) for (const x of ing.brands) x.preferred = false;
        ing.brands.push(brand);
        return ok(brand);
      }
    }

    if (seg[1] === "brands" && seg[2]) {
      const owner = w.ingredients.find((i) => i.brands.some((x) => x.id === seg[2]));
      const brand = owner?.brands.find((x) => x.id === seg[2]);
      if (!owner || !brand) throw new Refusal(404, "Marque introuvable");
      if (method === "PATCH") {
        if (b.preferred === true) for (const x of owner.brands) x.preferred = false;
        Object.assign(brand, b);
        return ok(brand);
      }
      if (method === "DELETE") {
        owner.brands = owner.brands.filter((x) => x.id !== brand.id);
        return ok({ ok: true });
      }
    }

    if (seg[1] === "suppliers") {
      if (method === "GET" && seg.length === 2) return ok(w.suppliers);
      if (method === "POST" && seg.length === 2) {
        const created = {
          id: id(),
          name: String(b.name ?? "Nouveau fournisseur"),
          contactName: (b.contactName as string | null) ?? null,
          phone: (b.phone as string | null) ?? null,
          email: (b.email as string | null) ?? null,
          paymentTerms: (b.paymentTerms as string | null) ?? null,
          deliveryDays: (b.deliveryDays as string | null) ?? null,
          notes: (b.notes as string | null) ?? null,
          active: true,
          items: [],
        };
        w.suppliers.push(created);
        return ok(created);
      }
      const sup = w.suppliers.find((s) => s.id === seg[2]);
      if (seg.length === 3 && method === "PATCH") {
        if (!sup) throw new Refusal(404, "Fournisseur introuvable");
        // La liste des références ne se met pas à jour par ce chemin : l'API
        // rend le fournisseur SANS ses `items`, et les écraser par un tableau
        // absent viderait la carte du fournisseur à l'écran suivant.
        Object.assign(sup, omit(b, "items"));
        return ok(omit(sup as unknown as Record<string, unknown>, "items"));
      }
      if (seg.length === 3 && method === "DELETE") {
        if (!sup) throw new Refusal(404, "Fournisseur introuvable");
        w.suppliers = w.suppliers.filter((s) => s.id !== sup.id);
        return ok({ ok: true });
      }
      if (seg.length === 4 && seg[3] === "items" && method === "POST") {
        if (!sup) throw new Refusal(404, "Fournisseur introuvable");
        const ing = w.ingredients.find((i) => i.id === b.ingredientId);
        const item = {
          id: id(),
          supplierId: sup.id,
          ingredientId: String(b.ingredientId ?? ""),
          brandId: (b.brandId as string | null) ?? null,
          sku: (b.sku as string | null) ?? null,
          packQty: Number(b.packQty ?? 1),
          packPriceCents: Number(b.packPriceCents ?? 0),
          active: true,
          ingredient: ing ? { id: ing.id, name: ing.name, unit: ing.unit } : null,
          brand: null,
        };
        sup.items.push(item);
        return ok(item);
      }
    }

    if (seg[1] === "items" && seg[2]) {
      const sup = w.suppliers.find((s) => s.items.some((it) => it.id === seg[2]));
      const item = sup?.items.find((it) => it.id === seg[2]);
      if (!sup || !item) throw new Refusal(404, "Référence introuvable");
      if (seg[3] === "price-history" && method === "GET") {
        // Un seul prix connu : la démonstration n'a pas d'historique de
        // négociation, et en inventer un ferait dire à l'écran des choses que
        // la fixture ne sait pas justifier.
        return ok({
          current: { packPriceCents: item.packPriceCents, updatedAt: new Date().toISOString() },
          history: [],
        });
      }
      if (method === "PATCH") {
        Object.assign(item, b);
        return ok(item);
      }
    }

    if (seg[1] === "movements") {
      if (method === "GET") {
        const ingredientId = q.get("ingredientId");
        const limit = Number(q.get("limit") ?? 50);
        return ok(
          w.movements
            .filter((m) => (ingredientId ? m.ingredientId === ingredientId : true))
            .slice(0, Math.min(limit, 200)),
        );
      }
      if (method === "POST") {
        const ing = w.ingredients.find((i) => i.id === b.ingredientId);
        if (!ing) throw new Refusal(404, "Ingrédient introuvable");
        const type = String(b.type ?? "purchase") as (typeof w.movements)[number]["type"];
        const qty = Number(b.qty ?? 0);
        // Même arithmétique que l'API : un inventaire POSE le stock, une
        // entrée l'augmente, une casse ou une sortie le diminue.
        const signed = type === "count" ? qty - ing.currentStock : type === "purchase" ? qty : -qty;
        ing.currentStock = Math.max(0, Math.round((ing.currentStock + signed) * 100) / 100);
        w.movements.unshift({
          id: id(),
          ingredientId: ing.id,
          ingredientName: ing.name,
          unit: ing.unit,
          type,
          qty: signed,
          ref: (b.ref as string | null) ?? null,
          note: (b.note as string | null) ?? null,
          at: new Date().toISOString(),
        });
        return ok({ currentStock: ing.currentStock, belowPar: ing.currentStock < ing.parLevel });
      }
    }

    if (seg[1] === "costs" && method === "GET") {
      return ok(costsOf(w, (q.get("refs") ?? "").split(",").filter(Boolean)));
    }

    if (seg[1] === "products" && seg[2] && seg[3] === "bom") {
      if (method === "GET") return ok(bomOf(w, seg[2]));
      if (method === "PUT") {
        const lines = ((b.lines as { ingredientId: string; qty: number; unit: string }[]) ?? []).map(
          (l) => [l.ingredientId, l.qty, l.unit] as [string, number, string],
        );
        w.boms[seg[2]] = { lines, options: w.boms[seg[2]]?.options ?? [] };
        return ok(bomOf(w, seg[2]));
      }
    }

    if (seg[1] === "products" && seg[2] && seg[3] === "option-bom" && method === "PUT") {
      return ok(bomOf(w, seg[2]));
    }
  }

  // ─── Promotions ───

  if (seg[0] === "promotions") {
    if (method === "GET" && seg.length === 1) return ok(w.promotions.map((p) => promoView(w, p)));
    if (method === "POST" && seg.length === 1) {
      const created = {
        _id: id(),
        name: String(b.name ?? "Nouvelle promo"),
        description: String(b.description ?? ""),
        kind: (b.kind as "percent" | "amount" | "offered_item") ?? "percent",
        value: Number(b.value ?? 0),
        code: (b.code as string | null) ?? null,
        channels: (b.channels as ("online" | "pos" | "phone")[]) ?? ["online"],
        startsAtAgeMin: 0,
        endsAtAgeMin: null,
        active: b.active !== false,
        usageCount: 0,
      };
      w.promotions.unshift(created);
      return ok(promoView(w, created));
    }
    const promo = w.promotions.find((p) => p._id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!promo) throw new Refusal(404, "Promotion introuvable");
      // Les bornes de validité sont stockées en ANCIENNETÉ, pas en date : les
      // réécrire depuis le corps de la requête figerait la promotion sur une
      // date absolue, et la démonstration se périmerait de ce côté-là.
      Object.assign(promo, omit(b, "startsAt", "endsAt"));
      return ok(promoView(w, promo));
    }
    if (seg.length === 3 && seg[2] === "toggle" && method === "POST") {
      if (!promo) throw new Refusal(404, "Promotion introuvable");
      promo.active = !promo.active;
      return ok(promoView(w, promo));
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!promo) throw new Refusal(404, "Promotion introuvable");
      w.promotions = w.promotions.filter((p) => p._id !== promo._id);
      return ok({ ok: true });
    }
  }

  // ─── Avis clients ───

  if (seg[0] === "reviews") {
    if (method === "GET" && seg.length === 1) {
      const rows = q.get("filter") === "pending" ? w.reviews.filter((r) => !r.reply) : w.reviews;
      return ok(rows.slice().sort((a, b2) => Date.parse(b2.createdAt) - Date.parse(a.createdAt)));
    }
    if (method === "GET" && seg[1] === "summary") {
      const total = w.reviews.length;
      const sum = w.reviews.reduce((s, r) => s + r.rating, 0);
      const monthFloor = Date.now() - 30 * 24 * 3600_000;
      return ok({
        total,
        avg: total ? Math.round((sum / total) * 10) / 10 : 0,
        counts: REVIEW_COUNTS,
        pending: w.reviews.filter((r) => !r.reply).length,
        monthCount: w.reviews.filter((r) => Date.parse(r.createdAt) >= monthFloor).length,
      });
    }
    if (seg.length === 3 && seg[2] === "reply" && method === "POST") {
      const review = w.reviews.find((r) => r._id === seg[1]);
      if (!review) throw new Refusal(404, "Avis introuvable");
      const text = String(b.text ?? "").trim();
      if (!text) throw new Refusal(400, "Réponse vide");
      review.reply = { text, at: new Date().toISOString(), by: "gerant" };
      return ok(review);
    }
  }

  // ─── Équipe et pointage ───

  if (seg[0] === "staff") {
    if (method === "GET" && seg.length === 1) return ok(w.staff.filter((s) => s.active));
    if (method === "GET" && seg[1] === "shifts") {
      const from = new Date(q.get("from") ?? new Date(w.bootAt - 7 * 86_400_000).toISOString());
      const to = new Date(q.get("to") ?? new Date().toISOString());
      const shifts = shiftsBetween(w, from, to);
      const byStaff = new Map<string, number>();
      for (const s of shifts) byStaff.set(s.staffId, (byStaff.get(s.staffId) ?? 0) + (s.hours ?? 0));
      return ok({
        from: from.toISOString(),
        to: to.toISOString(),
        shifts,
        totals: w.staff
          .filter((m) => m.active)
          .map((m) => ({
            staffId: m._id,
            name: m.name,
            role: m.role,
            active: m.active,
            hours: Math.round((byStaff.get(m._id) ?? 0) * 2) / 2,
          })),
      });
    }
    if (method === "POST" && seg.length === 1) {
      const created = {
        _id: id(),
        tenantId: "t1",
        name: String(b.name ?? "Nouvel équipier"),
        role: (b.role as "gerant" | "caisse" | "cuisine") ?? "caisse",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        onDuty: null,
        lastClockOut: null,
      };
      w.staff.push(created);
      return ok(created);
    }
    const member = w.staff.find((s) => s._id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!member) throw new Refusal(404, "Équipier introuvable");
      // Le PIN ne se stocke pas en clair, même dans une démonstration : on le
      // laisse tomber ici comme l'API le hache avant de l'écrire.
      Object.assign(member, omit(b, "pin"), { updatedAt: new Date().toISOString() });
      return ok(member);
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!member) throw new Refusal(404, "Équipier introuvable");
      member.active = false; // suppression douce, comme l'API
      return ok({ ok: true });
    }
    if (seg.length === 3 && seg[2] === "clock" && method === "POST") {
      if (!member) throw new Refusal(404, "Équipier introuvable");
      const direction = b.direction === "out" ? "out" : "in";
      if (direction === "in") {
        if (member.onDuty) throw new Refusal(409, `${member.name} est déjà en poste`);
        member.onDuty = { shiftId: id(), clockIn: new Date().toISOString() };
        member.lastClockOut = null;
      } else {
        if (!member.onDuty) throw new Refusal(409, `${member.name} n'est pas en poste`);
        member.onDuty = null;
        member.lastClockOut = new Date().toISOString();
      }
      return ok(member);
    }
  }

  // ─── Écrans TV ───

  if (seg[0] === "screens") {
    if (method === "GET" && seg.length === 1) return ok(w.screens.map((s) => screenView(w, s)));
    if (method === "POST" && seg.length === 1) {
      const created = {
        id: id(),
        name: String(b.name ?? "Nouvel écran"),
        orientation: (b.orientation as "landscape" | "portrait") ?? "landscape",
        theme: (b.theme as "brand" | "dark" | "light") ?? "brand",
        // Comme l'API : un écran créé sans playlist en reçoit une, bâtie sur la
        // carte. Le restaurateur ne configure RIEN pour que l'écran serve.
        playlist:
          (b.playlist as unknown[]) ??
          w.categories.slice(0, 3).map((c) => ({
            kind: "category",
            categoryId: c._id,
            productIds: [],
            title: null,
            durationMs: 12_000,
          })),
        paired: false,
        beating: false,
        lastSeenAt: null,
        pairingCode: pairingCode(w),
        pairingExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        active: true,
      };
      w.screens.push(created);
      return ok(screenView(w, created));
    }
    const screen = w.screens.find((s) => s.id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!screen) throw new Refusal(404, "Écran introuvable");
      Object.assign(screen, b);
      return ok(screenView(w, screen));
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!screen) throw new Refusal(404, "Écran introuvable");
      w.screens = w.screens.filter((s) => s.id !== screen.id);
      return ok({ ok: true });
    }
    if (seg.length === 3 && seg[2] === "regenerate-code" && method === "POST") {
      if (!screen) throw new Refusal(404, "Écran introuvable");
      screen.paired = false;
      screen.beating = false;
      screen.pairingCode = pairingCode(w);
      screen.pairingExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return ok(screenView(w, screen));
    }
  }

  // ─── Caisses et écrans cuisine ───

  if (seg[0] === "devices") {
    if (method === "GET" && seg.length === 1) return ok(w.devices.map((d) => deviceView(w, d)));
    if (method === "POST" && seg.length === 1) {
      const created = {
        id: id(),
        name: String(b.name ?? "Nouveau poste"),
        kind: (b.kind as "pos" | "kds") ?? "pos",
        paired: false,
        beating: false,
        lastSeenAt: null,
        pairingCode: pairingCode(w),
        pairingExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        active: true,
      };
      w.devices.push(created);
      return ok(deviceView(w, created));
    }
    const device = w.devices.find((d) => d.id === seg[1]);
    if (seg.length === 2 && method === "PATCH") {
      if (!device) throw new Refusal(404, "Poste introuvable");
      Object.assign(device, b);
      return ok(deviceView(w, device));
    }
    if (seg.length === 2 && method === "DELETE") {
      if (!device) throw new Refusal(404, "Poste introuvable");
      w.devices = w.devices.filter((d) => d.id !== device.id);
      return ok({ ok: true });
    }
    if (seg.length === 3 && seg[2] === "regenerate-code" && method === "POST") {
      if (!device) throw new Refusal(404, "Poste introuvable");
      device.paired = false;
      device.beating = false;
      device.pairingCode = pairingCode(w);
      device.pairingExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      return ok(deviceView(w, device));
    }
  }

  // ─── Site web et noms de domaine ───

  if (seg[0] === "site" && seg[1] === "domains") {
    const addresses = () => ({
      subdomain: { hostname: SITE_SUBDOMAIN, url: `https://${SITE_SUBDOMAIN}` },
      domains: w.domains.map(domainView),
      provider: DOMAIN_PROVIDER,
    });
    if (method === "GET" && seg.length === 2) return ok(addresses());
    if (method === "POST" && seg.length === 2) {
      const hostname = String(b.hostname ?? "").trim().toLowerCase();
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname)) {
        throw new Refusal(400, "Nom de domaine invalide");
      }
      if (w.domains.some((d) => d.hostname === hostname)) {
        throw new Refusal(409, "Ce domaine est déjà rattaché à votre établissement");
      }
      const created = {
        id: id(),
        hostname,
        status: "pending_dns" as const,
        statusLabel: "En attente du DNS",
        isPrimary: false,
        addedAt: new Date().toISOString(),
        lastCheckedAt: null,
        detail: "Aucun enregistrement CNAME trouvé pour ce nom.",
      };
      w.domains.push(created);
      return ok({ domain: domainView(created) });
    }
    const domain = w.domains.find((d) => d.id === seg[2]);
    if (seg.length === 4 && seg[3] === "check" && method === "POST") {
      if (!domain) throw new Refusal(404, "Domaine introuvable");
      // La vérification aboutit : le visiteur doit voir la bascule
      // « en attente » → « actif », c'est tout l'intérêt du bouton.
      domain.status = "active";
      domain.statusLabel = "Actif";
      domain.detail = null;
      domain.lastCheckedAt = new Date().toISOString();
      return ok(domainView(domain));
    }
    if (seg.length === 3 && method === "DELETE") {
      if (!domain) throw new Refusal(404, "Domaine introuvable");
      w.domains = w.domains.filter((d) => d.id !== domain.id);
      return ok({ ok: true });
    }
  }

  // ─── Planning ───
  //
  // Cinq lectures et cinq écritures pour un seul écran : il pose des services,
  // les publie, duplique une semaine sur la suivante et confronte le prévu au
  // pointé. Tout est engendré pour la semaine DEMANDÉE (`?week=`) — une charge
  // utile figée afficherait la semaine de la capture, quel que soit le lundi
  // que le visiteur a sous les yeux.

  if (seg[0] === "planning") {
    const week = q.get("week");

    if (method === "GET" && seg[1] === "week" && seg.length === 2) {
      return ok(planningWeek(w, week));
    }
    if (method === "GET" && seg[1] === "week" && seg[2] === "coverage") {
      return ok(planningCoverage(w, week));
    }
    if (method === "GET" && seg[1] === "week" && seg[2] === "comparison") {
      return ok(planningComparison(w, week));
    }
    if (method === "GET" && seg[1] === "staff-costs") return ok(planningStaffCosts(w));
    // La saisie d'un coût horaire : sans elle, la démonstration montrerait un
    // écran qui refuse d'enregistrer — pire qu'un écran absent.
    if (method === "PUT" && seg[1] === "staff-costs" && seg[2]) {
      return ok(planningSetStaffCost(w, seg[2], (b.hourlyCostCents as number | null) ?? null));
    }

    if (method === "POST" && seg[1] === "week" && seg[2] === "publish") {
      const monday = weekAnchor(w, (b.week as string) ?? null);
      const rows = shiftsOfWeek(w, monday);
      const drafts = rows.filter((s) => s.status === "brouillon");
      for (const s of drafts) s.status = PLANNING_STATUS_PUBLISHED;
      return ok({
        published: drafts.length,
        message:
          drafts.length === 0
            ? "Rien à publier : tous les services de la semaine le sont déjà."
            : `${drafts.length} service(s) publié(s) — l'équipe voit désormais la semaine.`,
      });
    }

    if (method === "POST" && seg[1] === "week" && seg[2] === "duplicate") {
      const from = weekAnchor(w, (b.from as string) ?? null);
      const to = weekAnchor(w, (b.to as string) ?? null);
      const source = shiftsOfWeek(w, from);
      const target = shiftsOfWeek(w, to);
      const offset = Math.round((to.getTime() - from.getTime()) / 86_400_000);
      const copied = source.map((s) => {
        const shifted = new Date(`${s.date}T12:00:00`);
        shifted.setDate(shifted.getDate() + offset);
        return {
          ...s,
          id: id(),
          date: ymd(shifted),
          // Une semaine dupliquée arrive en BROUILLON : recopier des services
          // déjà publiés engagerait l'équipe sans que personne l'ait relu.
          status: "brouillon" as const,
        };
      });
      w.planning[ymd(to)] = b.replace === true ? copied : [...target, ...copied];
      return ok({
        copied: copied.length,
        message: `${copied.length} service(s) copié(s) en brouillon sur la semaine du ${ymd(to)}.`,
      });
    }

    if (seg[1] === "shifts") {
      if (method === "POST" && seg.length === 2) {
        const date = String(b.date ?? "");
        const monday = weekAnchor(w, date);
        const rows = shiftsOfWeek(w, monday);
        const member = w.staff.find((m) => m._id === b.staffId);
        if (!member) throw new Refusal(404, "Équipier introuvable");
        const created = withDerived(
          {
            id: id(),
            staffId: member._id,
            staffName: member.name,
            date,
            start: String(b.start ?? "18:00"),
            end: String(b.end ?? "23:00"),
            position: (b.position as PlanningPosition) ?? "polyvalent",
            service: "soir",
            note: String(b.note ?? ""),
            status: (b.status as PlanningStatus) ?? "brouillon",
            minutes: 0,
            hours: 0,
            costCents: null,
          },
          member.role,
        );
        rows.push(created);
        return ok(created);
      }

      const found = findShift(w, seg[2]);
      if (!found) throw new Refusal(404, "Service introuvable");
      if (method === "PATCH") {
        const member = w.staff.find((m) => m._id === (b.staffId ?? found.shift.staffId));
        Object.assign(found.shift, omit(b, "id"), {
          staffName: member?.name ?? found.shift.staffName,
        });
        Object.assign(found.shift, withDerived(found.shift, member?.role));
        return ok(found.shift);
      }
      if (method === "DELETE") {
        w.planning[found.week] = (w.planning[found.week] ?? []).filter(
          (s) => s.id !== found.shift.id,
        );
        return ok({ ok: true });
      }
    }
  }

  // ─── Abonnement ───

  if (path === "/billing/me" && method === "GET") return ok(w.billing);

  // ─── Encaissement en ligne ───
  //
  // La démonstration montre un restaurant NON raccordé : c'est l'état de
  // départ de tout nouveau client, et celui que l'écran doit savoir présenter
  // sans que rien ne paraisse cassé. Le raccordement, lui, part chez Stripe —
  // il n'a pas de sens hors ligne, d'où le refus explicite plutôt qu'une
  // fausse page d'inscription.
  if (path === "/encaissement/me" && (method === "GET" || method === "POST")) {
    return ok({
      etat: "absent",
      etatLabel: "Non raccordé",
      peutEncaisser: false,
      raison:
        "Raccordez votre compte pour encaisser les commandes en ligne. Vos clients règlent au comptoir en attendant.",
      compte: null,
      disponible: true,
    });
  }
  if (path === "/encaissement/me/synchroniser" && method === "POST") {
    return ok({
      etat: "absent",
      etatLabel: "Non raccordé",
      peutEncaisser: false,
      raison:
        "Raccordez votre compte pour encaisser les commandes en ligne. Vos clients règlent au comptoir en attendant.",
      compte: null,
      disponible: true,
    });
  }
  if (path === "/encaissement/me/raccordement" && method === "POST") {
    return refuse(
      503,
      "Le raccordement d’un compte se fait chez Stripe : indisponible en démonstration.",
    );
  }

  return refuse(
    404,
    `Route absente de la démonstration : ${method} ${path}. Elle existe côté API — ajoutez-la à lib/demo/router.ts.`,
  );
}

/**
 * Avancement de statut, règle offline « le plus avancé gagne » (contrats
 * partagés) : un rejeu vers un statut déjà dépassé est ignoré sans erreur.
 */
function advance(order: DemoOrder, next: OrderStatus | undefined): DemoOrder {
  if (!next) throw new Refusal(400, "Statut manquant");
  const kept = mostAdvancedStatus(order.status, next);
  if (kept === order.status) return order;
  order.status = kept;
  order.statusHistory = [...order.statusHistory, { status: kept, at: new Date().toISOString() }];
  if (kept === "delivered" && order.payment.method === "counter" && order.payment.status === "pending") {
    order.payment.status = "paid";
  }
  return order;
}

/**
 * Code d'appairage de la même FORME que celui de l'API : six caractères pris
 * dans l'alphabet non ambigu des contrats (ni O ni 0, ni I ni 1 — le code se
 * lit à trois mètres sur un téléviseur puis se recopie sur un téléphone). Il
 * est ici déterministe : rien à protéger dans une démonstration, et un tirage
 * reproductible se déboguera plus facilement.
 */
function pairingCode(w: DemoWorld): string {
  let code = "";
  let n = w.seq * 7919;
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[n % PAIRING_CODE_ALPHABET.length];
    n = Math.floor(n / PAIRING_CODE_ALPHABET.length) + 31;
  }
  return code;
}
