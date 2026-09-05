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
 *   POST /public/orders/:id/payment-counter    retrait : changement autorisé par le serveur
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
  CreatePublicOrder,
  MediaVue,
  OrderStatus,
  OrderTicket,
  PaymentIntentResponse,
  PublicSiteHours,
  PublicSiteResponse,
  PublicSiteReview,
  SlotsResponse,
  DeliveryQuote,
  DeliveryQuoteRequest,
  PublicDeliverySettings,
  OrderDelivery,
  OrderType,
  Fulfillment,
  PaymentStatus,
  PaymentMethod,
  CounterPaymentResponse,
} from "@sm/contracts";
import { featuredProductIdsOf, marqueEffective, WebsiteUrlSchema, type Brand } from "@sm/contracts";
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

export type MenuCategory = { id: string; name: string; products: MenuProduct[]; featuredProductIds?: string[]; featuredConfigured?: boolean };

export type SiteTenant = {
  slug: string;
  name: string;
  /** Site vitrine indépendant ; lien volontaire, jamais une redirection. */
  websiteUrl?: string | null;
  /** Le masque d'identité — résolu une fois pour toutes (repli Nuit sinon). */
  brand: Brand;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: PublicSiteHours[];
};

/** Agrégat consommé par le site public, le tunnel et l’embed. */
export type Site = {
  /** Conserve l'intention éditoriale quand les catégories visibles sont vides. */
  featuredConfigured?: boolean;
  tenant: SiteTenant;
  categories: MenuCategory[];
  /**
   * La médiathèque du restaurant, telle que `/site` la rend déjà — et jusqu'ici
   * jetée à la porte du navigateur.
   *
   * Elle n'est PAS lue pour les photos de plats : `photoUrl` est un dérivé
   * résolu côté serveur, et le rester évite de faire voyager le catalogue
   * jusqu'à chaque carte. Elle sert au seul champ que le masque ne peut pas
   * porter lui-même : `brand.hero` ne stocke qu'une URL, sans point d'intérêt,
   * et c'est en la retrouvant ici qu'on rend le cadrage voulu par le
   * restaurateur (voir `hero.ts`).
   */
  medias: MediaVue[];
  slots: SlotsResponse | null;
  reviews: { avg: number; count: number; latest: PublicSiteReview[] };
  ordering: { paused: boolean; message: string | null };
  delivery?: PublicDeliverySettings;
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
      return { id, name: String(cat?.name ?? ""), products,
        featuredProductIds: featuredProductIdsOf(cat?.featuredProductIds),
        featuredConfigured: cat?.featuredConfigured === true || (typeof cat?.featuredRevision === "number" && cat.featuredRevision > 0),
      };
    })
    // Une catégorie vide n’a rien à dire au client (ni au référencement).
    .filter((c) => c.id !== "" && c.products.length > 0);
}

function featuredConfigurationOf(raw: unknown): boolean {
  const menu = raw as { featuredConfigured?: unknown; categories?: unknown } | null;
  if (menu?.featuredConfigured === true) return true;
  return Array.isArray(menu?.categories) && menu.categories.some((value: unknown) => {
    const category = value as { featuredConfigured?: unknown; featuredProductIds?: unknown; featuredRevision?: unknown } | null;
    return category?.featuredConfigured === true
      || (typeof category?.featuredRevision === "number" && category.featuredRevision > 0)
      || featuredProductIdsOf(category?.featuredProductIds).length > 0;
  });
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

/** Même type que le pipe Zod API : aucun contrat navigateur parallèle ne dérive. */
export type CreateOrderPayload = CreatePublicOrder;

/** Commande créée telle que renvoyée par l’API (projection utile au client). */
export type CreatedOrder = {
  _id: string;
  number: number;
  status: OrderStatus;
  /** Autorité serveur, y compris au rejeu d'un POST dont la réponse s'est perdue. */
  payment?: { method: PaymentMethod; status: PaymentStatus };
  type?: OrderType;
  delivery?: OrderDelivery | null;
  totals: {
    subtotal: number;
    deliveryFee?: number;
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
  fulfillment?: Fulfillment;
  delivery?: { dispatchedAt: string | null; deliveredAt: string | null; estimatedMinutes: number } | null;
  payment?: { status: PaymentStatus; method: PaymentMethod; refundedCents: number; pendingRefundCents: number };
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
          websiteUrl: WebsiteUrlSchema.safeParse(site.tenant.websiteUrl).data ?? null,
          brand: marqueEffective({
            brand: site.tenant.brand ?? null,
            brandColor: site.tenant.brandColor,
            logoUrl: site.tenant.logoUrl,
          }),
          logoUrl: site.tenant.logoUrl,
          brandColor: site.tenant.brandColor,
          address: site.tenant.address,
          phones: site.tenant.phones ?? [],
          hours: site.tenant.hours ?? [],
        },
        categories: toCategories(site.menu),
        featuredConfigured: featuredConfigurationOf(site.menu),
        medias: site.medias ?? [],
        slots: site.slots ?? null,
        reviews: site.reviews ?? { avg: 0, count: 0, latest: [] },
        ordering: site.ordering ?? { paused: false, message: null },
        delivery: site.delivery,
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
        // Cette forme n'a jamais porté de masque : repli déduit de l'accent seul.
        brand: marqueEffective({
          brand: null,
          brandColor: tenant.brandColor,
          logoUrl: tenant.logoUrl,
        }),
        logoUrl: tenant.logoUrl ?? null,
        brandColor: tenant.brandColor ?? "#c9a15a",
        address: tenant.address ?? "",
        phones: tenant.phones ?? [],
        hours,
      },
      categories: toCategories(menu),
      featuredConfigured: featuredConfigurationOf(menu),
      // Cette forme n'a jamais exposé de médiathèque : aucun point d'intérêt à
      // retrouver, la bande d'accueil se recadrera au centre.
      medias: [],
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
   * Le masque seul (page de suivi : le ticket ne porte pas la marque).
   * Un échec retombe sur le masque de repli — jamais sur une page cassée.
   */
  async function loadBrand(slug: string): Promise<Brand> {
    try {
      const tenant = await getJson<{ brand?: Brand | null; brandColor?: string; logoUrl?: string | null }>(
        `/public/tenants/${encodeURIComponent(slug)}`,
        { revalidate: SITE_TTL },
      );
      return marqueEffective({ brand: tenant.brand ?? null, brandColor: tenant.brandColor ?? null, logoUrl: tenant.logoUrl ?? null });
    } catch {
      return marqueEffective({ brand: null, brandColor: null, logoUrl: null });
    }
  }

  /** Créneaux frais (appelé au moment du choix, jamais servi depuis le cache). */
  function loadSlots(
    slug: string,
    date?: string,
    signal?: AbortSignal,
    fulfillment: Fulfillment = "pickup",
  ): Promise<SlotsResponse> {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (fulfillment === "delivery") params.set("fulfillment", fulfillment);
    const query = params.size ? `?${params}` : "";
    return getJson<SlotsResponse>(
      `/public/tenants/${encodeURIComponent(slug)}/slots${query}`,
      { signal },
    );
  }

  function quoteDelivery(slug: string, payload: DeliveryQuoteRequest): Promise<DeliveryQuote> {
    return postJson<DeliveryQuote>(`/public/tenants/${encodeURIComponent(slug)}/delivery/quote`, payload);
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

  function switchToCounterPayment(orderId: string, token: string): Promise<CounterPaymentResponse> {
    return postJson<CounterPaymentResponse>(
      withToken(`/public/orders/${encodeURIComponent(orderId)}/payment-counter`, token), {},
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
    loadBrand,
    loadSlots,
    quoteDelivery,
    createOrder,
    createPaymentIntent,
    switchToCounterPayment,
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
export const loadBrand = networkApi.loadBrand;
export const loadSlots = networkApi.loadSlots;
export const createOrder = networkApi.createOrder;
export const createPaymentIntent = networkApi.createPaymentIntent;
export const switchToCounterPayment = networkApi.switchToCounterPayment;
export const loadTracking = networkApi.loadTracking;
export const loadTicket = networkApi.loadTicket;
