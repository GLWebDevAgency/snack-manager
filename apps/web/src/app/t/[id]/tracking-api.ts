import type { OrderTicket, OrderTracking } from "@sm/contracts";
import { API_URL, PublicApiError } from "@/components/order/api";

/**
 * Accès aux routes publiques de suivi, jeton compris.
 *
 * `GET /public/orders/:id` et `…/ticket` exigent désormais
 * `?t=<trackingToken>` : l’ObjectId seul ne peut pas tenir lieu de secret, ses
 * premiers octets étant un horodatage et ses derniers un compteur. Sans jeton
 * valide, l’API répond 404 — et non 403, qui confirmerait la commande.
 *
 * Ces lecteurs vivent avec la page plutôt que dans le client public commun :
 * ils sont les seuls appels de tout le site à porter un secret d’URL.
 */

async function getJson<T>(path: string, token: string): Promise<T> {
  const url = `${API_URL}${path}?t=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    // Un statut de cuisine ne se met jamais en cache.
    cache: "no-store",
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = (body as { message?: unknown } | null)?.message;
    const message =
      typeof raw === "string" && raw.trim() ? raw : `Erreur ${res.status}`;
    throw new PublicApiError(res.status, message);
  }
  return body as T;
}

/** Statut d’avancement — la seule donnée indispensable au client. */
export function loadTracking(
  id: string,
  token: string,
): Promise<OrderTracking> {
  return getJson<OrderTracking>(
    `/public/orders/${encodeURIComponent(id)}`,
    token,
  );
}

/** Récapitulatif nominatif (lignes, totaux, restaurant) — bonus, jamais bloquant. */
export function loadTicket(id: string, token: string): Promise<OrderTicket> {
  return getJson<OrderTicket>(
    `/public/orders/${encodeURIComponent(id)}/ticket`,
    token,
  );
}

/**
 * Jeton lu depuis l’URL. Next livre `string | string[] | undefined` : un lien
 * recopié deux fois (`?t=a&t=b`) ne doit pas faire planter la page, on garde
 * la première valeur.
 */
export function readToken(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}
