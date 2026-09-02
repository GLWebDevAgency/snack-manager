import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * POST /api/contact — lead du site vitrine.
 *
 * Chaîne de traitement :
 *   1. validation stricte (le client n'est jamais cru) ;
 *   2. transfert authentifié au guichet d'ingestion de l'API ;
 *   3. succès uniquement après l'accusé d'une écriture MongoDB durable.
 *
 * La limitation qui protège réellement l'écriture est atomique et partagée
 * dans Redis côté API. Next ne donne pas ici de source IP dont la chaîne de
 * confiance soit démontrable : utiliser le premier `X-Forwarded-For` ferait
 * seulement croire à une protection qu'un appelant peut faire tourner.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const LEADS_PATH = process.env.LEADS_ENDPOINT ?? "/public/leads";

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLOTS = new Set(["matin", "entre-services", "apres-21h"]);

const MAX = { name: 120, restaurant: 160, phone: 32, email: 180, message: 2000 } as const;

/* ── Validation ────────────────────────────────────────────────────── */

type Lead = {
  name: string;
  restaurant: string | null;
  phone: string;
  email: string | null;
  callbackSlot: string;
  message: string | null;
  /**
   * « Vous vendez déjà sur Uber Eats ou Deliveroo ? » — la case à cocher du
   * formulaire. C'est un signal de qualification, pas une commande : on regarde
   * les pages du restaurateur avec lui pendant l'appel. Aucun prix, aucune
   * promesse, aucun délai n'est attaché à ce booléen, ni ici ni dans la page.
   */
  platforms: boolean;
  source: "site-vitrine";
};

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parse(body: unknown): { lead: Lead } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Requête invalide." };
  }
  const b = body as Record<string, unknown>;

  const name = str(b.name, MAX.name);
  const phone = str(b.phone, MAX.phone);
  const email = str(b.email, MAX.email);
  const slot = str(b.callbackSlot, 40);

  if (name.length < 2) return { error: "Indiquez votre nom." };
  if (!PHONE_RE.test(phone)) return { error: "Numéro de téléphone invalide." };
  if (email && !EMAIL_RE.test(email)) return { error: "Adresse e-mail invalide." };

  return {
    lead: {
      name,
      restaurant: str(b.restaurant, MAX.restaurant) || null,
      phone,
      email: email || null,
      callbackSlot: SLOTS.has(slot) ? slot : "matin",
      message: str(b.message, MAX.message) || null,
      // Une case décochée n'est pas envoyée par le navigateur : tout ce qui
      // n'est pas strictement `true` vaut « non », y compris un "on" en chaîne
      // ou un champ absent. Un booléen mal formé ne doit pas faire échouer un
      // rappel — le nom et le téléphone sont les seuls champs qui le peuvent.
      platforms: b.platforms === true,
      source: "site-vitrine",
    },
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: 400 });
  }

  const parsed = parse(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { lead } = parsed;
  const correlationId = randomUUID();
  const ingestToken = process.env.SM_CONTACT_INGEST_TOKEN?.trim();
  if (!ingestToken) {
    logFailure({ correlationId, outcome: "configuration-absente" });
    return unavailable();
  }

  try {
    const res = await fetch(`${API_URL}${LEADS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ingestToken}`,
        "X-SM-Correlation-Id": correlationId,
      },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) return NextResponse.json({ ok: true, stored: true });

    logFailure({ correlationId, outcome: "api-refus", status: res.status });
    if (res.status === 429) {
      return NextResponse.json(
        { ok: false, error: "Trop de demandes ont été reçues. Réessayez dans quelques minutes." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Impossible d'enregistrer votre demande pour le moment. Réessayez dans un instant.",
      },
      { status: 502 },
    );
  } catch {
    // Ne jamais recopier `Error.message` : une URL, un SDK ou un proxy peut y
    // inclure le corps envoyé — donc les coordonnées que l'on protège.
    logFailure({ correlationId, outcome: "api-indisponible" });
    return unavailable();
  }
}

type ContactFailure = {
  correlationId: string;
  outcome: "configuration-absente" | "api-refus" | "api-indisponible";
  status?: number;
};

/** Cette fonction ne PEUT PAS recevoir un lead : la PII reste hors des logs. */
function logFailure(event: ContactFailure) {
  console.warn("[contact] demande non persistée", {
    correlationId: event.correlationId,
    outcome: event.outcome,
    status: event.status ?? null,
  });
}

function unavailable() {
  return NextResponse.json(
    {
      ok: false,
      error: "Impossible d'enregistrer votre demande pour le moment. Réessayez dans un instant.",
    },
    { status: 503 },
  );
}
