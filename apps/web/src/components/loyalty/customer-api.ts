import {
  LoyaltyCustomerCardSchema,
  type LoyaltyCustomerCard,
} from "@sm/contracts";

export class LoyaltyCustomerSessionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LoyaltyCustomerSessionError";
  }
}

function endpoint(slug: string): string {
  return `/r/${encodeURIComponent(slug)}/fidelite/card-session`;
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function messageOf(body: unknown, status: number): string {
  const raw = (body as { message?: unknown } | null)?.message;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (status === 404) return "Carte fidélité introuvable ou indisponible";
  return status >= 500
    ? "Le service fidélité est momentanément indisponible"
    : `Erreur ${status}`;
}

async function cardFrom(response: Response): Promise<LoyaltyCustomerCard> {
  const body = await bodyOf(response);
  if (!response.ok) {
    throw new LoyaltyCustomerSessionError(
      response.status,
      messageOf(body, response.status),
    );
  }
  return LoyaltyCustomerCardSchema.parse(body);
}

/** Valide le QR puis le conserve dans un cookie HttpOnly limité à cette app. */
export async function rememberCustomerLoyaltyCard(
  slug: string,
  qrToken: string,
  signal?: AbortSignal,
): Promise<LoyaltyCustomerCard> {
  return cardFrom(
    await fetch(endpoint(slug), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ qrToken }),
      cache: "no-store",
      credentials: "same-origin",
      signal,
    }),
  );
}

/** Rouvre la carte sans rendre le secret QR accessible au JavaScript. */
export async function loadRememberedCustomerLoyaltyCard(
  slug: string,
  signal?: AbortSignal,
): Promise<LoyaltyCustomerCard | null> {
  const response = await fetch(endpoint(slug), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 204 || response.status === 404) return null;
  return cardFrom(response);
}

export async function forgetCustomerLoyaltyCard(
  slug: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(endpoint(slug), {
    method: "DELETE",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok && response.status !== 204) {
    const body = await bodyOf(response);
    throw new LoyaltyCustomerSessionError(
      response.status,
      messageOf(body, response.status),
    );
  }
}
