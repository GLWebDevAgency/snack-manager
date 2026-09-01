import "server-only";

import { cache } from "react";
import {
  LoyaltyCustomerCardSchema,
  LoyaltyPublicProgramSchema,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from "@sm/contracts";
import { publicRelayHeaders } from "./relay-proof";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class LoyaltyPublicApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LoyaltyPublicApiError";
  }
}

function messageOf(body: unknown, status: number): string {
  const raw = (body as { message?: unknown } | null)?.message;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  if (status === 404) return "Carte fidélité introuvable ou indisponible";
  return status >= 500 ? "Le service fidélité est momentanément indisponible" : `Erreur ${status}`;
}

/** Catalogue public cacheable : aucune donnée membre. */
export const loadPublicLoyalty = cache(async (slug: string): Promise<LoyaltyPublicProgram> => {
  const response = await fetch(
    `${API_URL}/public/tenants/${encodeURIComponent(slug)}/loyalty`,
    { headers: { Accept: "application/json" }, next: { revalidate: 60 } },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new LoyaltyPublicApiError(response.status, messageOf(body, response.status));
  return LoyaltyPublicProgramSchema.parse(body);
});

/**
 * Résolution serveur de la carte. Le QR reste dans le JSON d'un POST no-store,
 * jamais dans une URL. Le navigateur passe par le relais same-origin afin que
 * le secret puisse ensuite vivre dans un cookie HttpOnly.
 */
export async function loadCustomerLoyaltyCard(
  slug: string,
  qrToken: string,
  signal?: AbortSignal,
  relayClientIdentity?: string | null,
): Promise<LoyaltyCustomerCard> {
  let relayHeaders: Record<string, string>;
  try {
    relayHeaders = publicRelayHeaders(slug, relayClientIdentity ?? null, qrToken);
  } catch {
    throw new LoyaltyPublicApiError(
      503,
      "La vérification de sécurité est momentanément indisponible",
    );
  }
  const response = await fetch(
    `${API_URL}/public/tenants/${encodeURIComponent(slug)}/loyalty/card`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...relayHeaders,
      },
      body: JSON.stringify({ qrToken }),
      cache: "no-store",
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new LoyaltyPublicApiError(response.status, messageOf(body, response.status));
  return LoyaltyCustomerCardSchema.parse(body);
}
