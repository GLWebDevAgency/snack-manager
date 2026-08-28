/**
 * Client des routes PUBLIQUES de la commande en ligne (aucun compte, aucun JWT).
 *
 * Le tenant est toujours résolu par son `slug` d’URL — jamais par un `tenantId`
 * envoyé depuis le navigateur. Aucun prix n’est transmis à la création de
 * commande : l’API recalcule tout depuis le menu courant.
 *
 * Routes consommées :
 *   GET  /public/tenants/:slug/site            page publique en un appel
 *   GET  /public/tenants/:slug/menu            repli si /site absent
 *   GET  /public/tenants/:slug                 repli identité tenant
 *   GET  /public/tenants/:slug/slots?date=     créneaux de retrait
 *   POST /public/tenants/:slug/orders          création de commande
 *   POST /public/orders/:id/payment-intent     paiement Stripe (optionnel)
 *   GET  /public/orders/:id                    suivi (statut)
 *   GET  /public/orders/:id/ticket             récapitulatif du suivi
 *
 * ─── UN PORT, DEUX BRANCHEMENTS ───
 *
 * Tout passe par un `Transport` : un objet qui reçoit une méthode, un chemin
 * et un corps, et rend un statut et un corps. Le branchement normal est
 * `httpTransport` (fetch). La démonstration de la vitrine en fournit un autre,
 * qui répond aux mêmes routes depuis une fixture, en mémoire (voir
 * `demo/transport.ts`) — ni ce module, ni le tunnel, ni le panier ne savent
 * lequel des deux ils ont sous les pieds. C’est le même patron que le port de
 * transport de `packages/client-core` (ADR 0001), appliqué ici à la couche
 * réseau du site public.
 *
 * Le transport RÉSEAU reste le défaut, partout : aucune adresse, aucune
 * variable d’environnement ne peut faire basculer un client vers la fixture —
 * il faut qu’une route ait explicitement construit l’autre.
 */

import type {
  OrderStatus,
  OrderTicket,
  PaymentIntentResponse,
  PublicSiteHours,
  PublicSiteResponse,
  PublicSiteReview,
  SlotsResponse,
} from "@sm/contracts";
import { hoursOfDay, isOpenAt, parisParts } from "./helpers";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

type FetchOptions = {
  /** Durée de cache serveur en secondes ; `0` ⇒ toujours frais. */
  revalidate?: number;
  signal?: AbortSignal;
};

// ─────────────────────────────────────────────────────────────
// Port de transport
// ─────────────────────────────────────────────────────────────

export type TransportRequest = {
  method: "GET" | "POST";
  /** Chemin d’API, query comprise (« /public/tenants/x/slots?date=… »). */
  path: string;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Cache serveur en secondes ; `0` ou absent ⇒ toujours frais. */
  revalidate?: number | undefined;
};

export type TransportResponse = { status: number; body: unknown };

export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

/** Le vrai réseau — le seul branchement par défaut. */
export const httpTransport: Transport = {
  async send({ method, path, body, signal, revalidate }) {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      ...(revalidate === undefined || revalidate === 0
        ? { cache: "no-store" as const }
        : { next: { revalidate } }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

/** Message d’erreur lisible : l’API renvoie `{ message }` (string ou tableau Zod). */
function messageOf(body: unknown, status: number): string {
  const raw = (body as { message?: unknown } | null)?.message;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  if (status === 404) return "Restaurant introuvable";
  if (status >= 500) return "Le service est momentanément indisponible";
  return `Erreur ${status}`;
}

// ─────────────────────────────────────────────────────────────
// Modèle de menu normalisé (l’API expose `optionGroups: unknown[]`)
// ─────────────────────────────────────────────────────────────

export type MenuChoice = { key: string; name: string; priceDelta: number };

export type MenuGroup = {
  key: string;
  name: string;
  type: "single" | "multi";
  min: number;
  /** `null` = pas de plafond. */
  max: number | null;
  choices: MenuChoice[];
  /** Règles surchargées par variante (ex. nb de viandes selon la taille). */
  perVariant: Record<
    string,
    { min?: number; max?: number; priceDelta?: number }
  > | null;
};

export type MenuVariant = { key: string; name: string; price: number };

export type MenuProduct = {
  id: string;
  name: string;
  description: string;
  /** Centimes — ignoré si `variants` non vide. */
  price: number;
  variants: MenuVariant[];
  groups: MenuGroup[];
  /**
   * Retraits dérivés de la recette du produit : « sans tomate » n'apparaît
   * que sur un produit qui en contient. `key` part en commande, `label`
   * s'affiche.
   */
  removables: { key: string; label: string }[];
  /** Ingrédients ajoutables, prix résolu côté serveur à la commande. */
  supplements: { key: string; label: string; priceCents: number }[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  photoUrl: string | null;
  /** Prix affiché en carte : « dès X » quand il y a des variantes. */
  fromPrice: number;
  /** Le produit ouvre-t-il la fiche de configuration ? */
  configurable: boolean;
};

export type MenuCategory = { id: string; name: string; products: MenuProduct[] };

export type SiteTenant = {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: PublicSiteHours[];
};

/** Agrégat consommé par le site public, le tunnel et l’embed. */
export type Site = {
  tenant: SiteTenant;
  categories: MenuCategory[];
  slots: SlotsResponse | null;
  reviews: { avg: number; count: number; latest: PublicSiteReview[] };
  ordering: { paused: boolean; message: string | null };
  openNow: boolean;
  todayHours: PublicSiteHours | null;
  timezone: string;
};

// ─── Normalisation ───

function toGroup(raw: unknown): MenuGroup | null {
  const g = raw as Partial<MenuGroup> & {
    max?: number | null;
    choices?: unknown[];
  };
  if (!g || typeof g.key !== "string" || !Array.isArray(g.choices)) return null;
  const choices = g.choices
    .map((c) => {
      const choice = c as Partial<MenuChoice>;
      if (typeof choice?.key !== "string") return null;
      return {
        key: choice.key,
        name: String(choice.name ?? choice.key),
        priceDelta: Number(choice.priceDelta ?? 0),
      };
    })
    .filter((c): c is MenuChoice => c !== null);
  if (choices.length === 0) return null;
  const max = typeof g.max === "number" && g.max > 0 ? g.max : null;
  return {
    key: g.key,
    name: String(g.name ?? g.key),
    type: g.type === "single" ? "single" : "multi",
    min: Number(g.min ?? 0),
    // Un groupe « single » sans plafond explicite reste un choix unique.
    max: max ?? (g.type === "single" ? 1 : null),
    choices,
    perVariant:
      g.perVariant && typeof g.perVariant === "object" ? g.perVariant : null,
  };
}

function toProduct(raw: unknown): MenuProduct | null {
  const p = raw as Record<string, unknown>;
  const id = String(p?._id ?? p?.id ?? "");
  if (!id) return null;

  const variants: MenuVariant[] = Array.isArray(p.variants)
    ? p.variants
        .map((v) => {
          const variant = v as Partial<MenuVariant>;
          if (typeof variant?.key !== "string") return null;
          return {
            key: variant.key,
            name: String(variant.name ?? variant.key),
            price: Number(variant.price ?? 0),
          };
        })
        .filter((v): v is MenuVariant => v !== null)
    : [];

  const groups: MenuGroup[] = Array.isArray(p.optionGroups)
    ? p.optionGroups.map(toGroup).filter((g): g is MenuGroup => g !== null)
    : [];

  const price = Number(p.price ?? 0);

  // Le contrat a évolué de `string[]` vers `{key,label}[]` : on accepte les
  // deux le temps que tous les caches se vident.
  const removables = Array.isArray(p.removables)
    ? p.removables
        .map((r) =>
          typeof r === "string"
            ? { key: r, label: r }
            : {
                key: String((r as { key?: unknown }).key ?? ""),
                label: String((r as { label?: unknown }).label ?? ""),
              },
        )
        .filter((r) => r.key !== "")
    : [];

  const supplements = Array.isArray(p.supplements)
    ? p.supplements
        .map((s) => {
          const o = s as { key?: unknown; label?: unknown; priceCents?: unknown };
          return {
            key: String(o.key ?? ""),
            label: String(o.label ?? ""),
            priceCents: Number(o.priceCents ?? 0),
          };
        })
        .filter((s) => s.key !== "")
    : [];

  return {
    id,
    name: String(p.name ?? ""),
    description: String(p.description ?? ""),
    price,
    variants,
    groups,
    removables,
    supplements,
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    isNew: p.isNew === true,
    outOfStock: p.outOfStock === true,
    photoUrl: typeof p.photoUrl === "string" ? p.photoUrl : null,
    fromPrice:
      variants.length > 0
        ? Math.min(...variants.map((v) => v.price))
        : price,
    configurable:
      variants.length > 0 ||
      groups.length > 0 ||
      removables.length > 0 ||
      supplements.length > 0,
  };
}

function toCategories(raw: unknown): MenuCategory[] {
  const source = (raw as { categories?: unknown })?.categories;
  if (!Array.isArray(source)) return [];
  return source
    .map((c) => {
      const cat = c as Record<string, unknown>;
      const id = String(cat?._id ?? cat?.id ?? "");
      const products = Array.isArray(cat?.products)
        ? cat.products.map(toProduct).filter((p): p is MenuProduct => p !== null)
        : [];
      return { id, name: String(cat?.name ?? ""), products };
    })
    // Une catégorie vide n’a rien à dire au client (ni au référencement).
    .filter((c) => c.id !== "" && c.products.length > 0);
}


// ─────────────────────────────────────────────────────────────
// Formes échangées
// ─────────────────────────────────────────────────────────────

/** Forme du repli `GET /public/tenants/:slug` (API antérieure à `/site`). */
type PublicTenantLegacy = {
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: PublicSiteHours[];
  onlineOrderingPaused?: boolean;
  pauseMessage?: string | null;
};

const SITE_TTL = 60; // secondes — SEO et vitesse d’affichage, fraîcheur suffisante

export type OrderLinePayload = {
  productId: string;
  variantKey?: string;
  options: { groupKey: string; choiceKey: string }[];
  removed: string[];
  note?: string;
  qty: number;
};

export type CreateOrderPayload = {
  clientId: string;
  channel: "online";
  type: "pickup";
  lines: OrderLinePayload[];
  payment: { method: "online" | "counter" };
  pickup: { slot: string; customerName: string; customerPhone?: string };
  note?: string;
  /**
   * Le code promo saisi, s'il y en a un.
   *
   * Le MONTANT n'est jamais transmis : comme les prix, la remise est résolue
   * par le serveur contre la promotion en base. Un panier modifié dans le
   * navigateur n'obtient rien — et l'écran ne peut donc pas afficher le gain
   * avant validation, ce que la mention sous le total dit déjà.
   */
  promoCode?: string;
};

/** Commande créée telle que renvoyée par l’API (projection utile au client). */
export type CreatedOrder = {
  _id: string;
  number: number;
  status: OrderStatus;
  totals: {
    subtotal: number;
    /** La promotion retenue par le serveur, avec son libellé — `null` sinon. */
    discount: { amount: number; reason: string } | null;
    total: number;
  };
  pickup: { slot: string; customerName: string } | null;
  /**
   * Secret de suivi remis une seule fois, à la création. L’identifiant de
   * commande ne suffit pas à consulter le suivi : un ObjectId Mongo est
   * partiellement prévisible, et ces pages exposent le nom et le téléphone
   * du client. Il doit accompagner tout lien `/t/:id`.
   */
  trackingToken: string;
};

/** Réponse « commande en ligne suspendue par le gérant ». */
export type PausedResponse = { paused: true; message: string | null };

export function isPaused(
  res: CreatedOrder | PausedResponse,
): res is PausedResponse {
  return (res as PausedResponse).paused === true;
}

export type TrackingState = {
  _id: string;
  number: number;
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: string }[];
  pickupSlot: string | null;
};

/** `?t=` — sans jeton valide l’API répond 404, jamais 403. */
const withToken = (path: string, token: string) =>
  `${path}?t=${encodeURIComponent(token)}`;

// ─────────────────────────────────────────────────────────────
// Le client, branché sur un transport
// ─────────────────────────────────────────────────────────────

/**
 * Client des routes publiques.
 *
 * Sans argument, il parle au RÉSEAU : c’est le seul comportement par défaut, et
 * les fonctions exportées plus bas (`loadSite`, `createOrder`, …) en sont les
 * raccourcis. La démonstration de la vitrine en construit un second sur son
 * transport en mémoire — explicitement, depuis sa propre route.
 */
export function orderingApi(transport: Transport = httpTransport) {
  async function getJson<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const res = await transport.send({
      method: "GET",
      path,
      signal: opts.signal,
      revalidate: opts.revalidate,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new PublicApiError(res.status, messageOf(res.body, res.status));
    }
    return res.body as T;
  }

  async function postJson<T>(path: string, payload: unknown): Promise<T> {
    const res = await transport.send({ method: "POST", path, body: payload });
    if (res.status < 200 || res.status >= 300) {
      throw new PublicApiError(res.status, messageOf(res.body, res.status));
    }
    return res.body as T;
  }

  /**
   * Charge tout ce qu’il faut pour afficher un restaurant.
   *
   * Chemin nominal : `GET /public/tenants/:slug/site` (un seul aller-retour).
   * Repli : une API plus ancienne n’expose pas encore `/site` — on recompose
   * l’agrégat à partir de `/public/tenants/:slug` + `/menu` (+ `/slots` si
   * disponible). Un déploiement d’API en retard ne doit pas éteindre la vitrine
   * du client : c’est sa page Google.
   */
  async function loadSite(slug: string): Promise<Site | null> {
    try {
      const site = await getJson<PublicSiteResponse>(
        `/public/tenants/${encodeURIComponent(slug)}/site`,
        { revalidate: SITE_TTL },
      );
      return {
        tenant: {
          slug: site.tenant.slug,
          name: site.tenant.name,
          logoUrl: site.tenant.logoUrl,
          brandColor: site.tenant.brandColor,
          address: site.tenant.address,
          phones: site.tenant.phones ?? [],
          hours: site.tenant.hours ?? [],
        },
        categories: toCategories(site.menu),
        slots: site.slots ?? null,
        reviews: site.reviews ?? { avg: 0, count: 0, latest: [] },
        ordering: site.ordering ?? { paused: false, message: null },
        openNow: site.openNow === true,
        todayHours: site.todayHours ?? null,
        timezone: site.timezone ?? "Europe/Paris",
      };
    } catch (err) {
      if (err instanceof PublicApiError && err.status === 404) {
        return loadSiteLegacy(slug);
      }
      throw err;
    }
  }

  async function loadSiteLegacy(slug: string): Promise<Site | null> {
    const base = `/public/tenants/${encodeURIComponent(slug)}`;
    const [tenant, menu, slots] = await Promise.all([
      getJson<PublicTenantLegacy>(base, { revalidate: SITE_TTL }).catch(
        (err: unknown) => {
          if (err instanceof PublicApiError && err.status === 404) return null;
          throw err;
        },
      ),
      getJson<unknown>(`${base}/menu`, { revalidate: SITE_TTL }).catch(() => null),
      getJson<SlotsResponse>(`${base}/slots`).catch(() => null),
    ]);
    if (!tenant) return null; // slug inconnu : 404 franc

    const hours = tenant.hours ?? [];
    const paused = tenant.onlineOrderingPaused === true;

    return {
      tenant: {
        slug: tenant.slug,
        name: tenant.name,
        logoUrl: tenant.logoUrl ?? null,
        brandColor: tenant.brandColor ?? "#c9a15a",
        address: tenant.address ?? "",
        phones: tenant.phones ?? [],
        hours,
      },
      categories: toCategories(menu),
      slots,
      // Les avis ne sont pas exposés par l’API historique : section masquée.
      reviews: { avg: 0, count: 0, latest: [] },
      ordering: { paused, message: paused ? (tenant.pauseMessage ?? null) : null },
      openNow: isOpenAt(hours),
      todayHours: hoursOfDay(hours, parisParts().weekday),
      timezone: "Europe/Paris",
    };
  }

  /**
   * Accent de marque seul (page de suivi : le ticket ne porte pas la couleur).
   * Un échec retombe sur l’accent par défaut — jamais sur une page cassée.
   */
  async function loadBrandColor(slug: string): Promise<string> {
    try {
      const tenant = await getJson<{ brandColor?: string }>(
        `/public/tenants/${encodeURIComponent(slug)}`,
        { revalidate: SITE_TTL },
      );
      return tenant.brandColor ?? "#c9a15a";
    } catch {
      return "#c9a15a";
    }
  }

  /** Créneaux frais (appelé au moment du choix, jamais servi depuis le cache). */
  function loadSlots(
    slug: string,
    date?: string,
    signal?: AbortSignal,
  ): Promise<SlotsResponse> {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    return getJson<SlotsResponse>(
      `/public/tenants/${encodeURIComponent(slug)}/slots${query}`,
      { signal },
    );
  }

  function createOrder(
    slug: string,
    payload: CreateOrderPayload,
  ): Promise<CreatedOrder | PausedResponse> {
    return postJson<CreatedOrder | PausedResponse>(
      `/public/tenants/${encodeURIComponent(slug)}/orders`,
      payload,
    );
  }

  /**
   * Le jeton de suivi accompagne l'appel, comme sur le suivi et le ticket.
   *
   * Cette route était la seule à ouvrir une commande sur son seul identifiant :
   * elle confirmait son existence et en révélait le montant à qui devinait un
   * ObjectId — que `tracking.ts` décrit précisément comme devinable.
   */
  function createPaymentIntent(
    orderId: string,
    token: string,
  ): Promise<PaymentIntentResponse> {
    return postJson<PaymentIntentResponse>(
      withToken(`/public/orders/${encodeURIComponent(orderId)}/payment-intent`, token),
      {},
    );
  }

  function loadTracking(
    id: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<TrackingState> {
    return getJson<TrackingState>(
      withToken(`/public/orders/${encodeURIComponent(id)}`, token),
      { signal },
    );
  }

  /** Récapitulatif complet de la commande (lignes, totaux, restaurant). */
  function loadTicket(id: string, token: string): Promise<OrderTicket> {
    return getJson<OrderTicket>(
      withToken(`/public/orders/${encodeURIComponent(id)}/ticket`, token),
    );
  }

  return {
    loadSite,
    loadBrandColor,
    loadSlots,
    createOrder,
    createPaymentIntent,
    loadTracking,
    loadTicket,
  };
}

export type OrderingApi = ReturnType<typeof orderingApi>;

// ─────────────────────────────────────────────────────────────
// Raccourcis réseau — ce que consomment les pages et le tunnel
// ─────────────────────────────────────────────────────────────

/** Le client réseau, unique et partagé. */
export const networkApi: OrderingApi = orderingApi();

export const loadSite = networkApi.loadSite;
export const loadBrandColor = networkApi.loadBrandColor;
export const loadSlots = networkApi.loadSlots;
export const createOrder = networkApi.createOrder;
export const createPaymentIntent = networkApi.createPaymentIntent;
export const loadTracking = networkApi.loadTracking;
export const loadTicket = networkApi.loadTicket;
