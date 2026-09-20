import { randomUUID } from "node:crypto";
import { SiteLeadCreateSchema } from "@sm/contracts";
import { NextResponse } from "next/server";
import { boundedJson, rejectsOrigin } from "@/lib/public-form-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailableMessage = "Impossible d'enregistrer votre demande pour le moment. Réessayez dans un instant.";
const fieldErrors: Record<string, string> = {
  name: "Indiquez votre nom (entre 2 et 120 caractères).",
  restaurant: "Le nom du restaurant ne doit pas dépasser 160 caractères.",
  phone: "Numéro de téléphone invalide.",
  email: "Adresse e-mail invalide.",
  callbackSlot: "Choisissez un créneau de rappel proposé.",
  message: "Votre message ne doit pas dépasser 2 000 caractères.",
  need: "Choisissez un besoin proposé.",
};

function optionalText(value: unknown): unknown {
  if (value == null) return null;
  return typeof value === "string" ? value.trim() || null : value;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Success acknowledges durable storage, never receipt by an email inbox. */
export async function POST(request: Request) {
  if (rejectsOrigin(request)) return json({ ok: false, error: "Origine de la demande invalide." }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Activez JavaScript pour envoyer le formulaire." }, 415);
  }
  const body = await boundedJson(request, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Requête invalide ou trop volumineuse." }, 400);
  }
  const input = body as Record<string, unknown>;
  // Pick the public fields explicitly: browser autofill can add unrelated keys.
  // Never truncate a visitor's message or accept client-chosen CRM state.
  const parsed = SiteLeadCreateSchema.safeParse({
    requestId: input.requestId ?? randomUUID(),
    name: input.name,
    restaurant: optionalText(input.restaurant),
    phone: input.phone,
    email: optionalText(input.email),
    callbackSlot: input.callbackSlot ?? "matin",
    need: optionalText(input.need),
    message: optionalText(input.message),
    platforms: input.platforms === true,
    source: "site-vitrine",
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return json({ ok: false, error: fieldErrors[field] ?? "Requête invalide. Rechargez la page et réessayez." }, 400);
  }

  const lead = parsed.data;
  const correlationId = randomUUID();
  const ingestToken = process.env.SM_CONTACT_INGEST_TOKEN?.trim();
  const apiUrl = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL)?.trim().replace(/\/+$/, "");
  if (!ingestToken || !apiUrl) {
    logFailure(correlationId, "configuration-absente");
    return json({ ok: false, error: unavailableMessage }, 503);
  }
  try {
    const res = await fetch(`${apiUrl}${process.env.LEADS_ENDPOINT ?? "/public/leads"}`, {
      method: "POST", redirect: "error", cache: "no-store",
      headers: {
        Accept: "application/json", "Content-Type": "application/json",
        Authorization: `Bearer ${ingestToken}`, "X-SM-Correlation-Id": correlationId,
      },
      body: JSON.stringify(lead), signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const ack: unknown = await res.json();
      if (ack && typeof ack === "object" && "ok" in ack && ack.ok === true
        && "stored" in ack && ack.stored === true && "requestId" in ack && ack.requestId === lead.requestId) {
        return json({ ok: true, stored: true, requestId: lead.requestId });
      }
      logFailure(correlationId, "accuse-invalide", res.status);
      return json({ ok: false, error: unavailableMessage }, 502);
    }
    logFailure(correlationId, "api-refus", res.status);
    if (res.status === 429) return json({ ok: false, error: "Trop de demandes ont été reçues. Réessayez dans quelques minutes." }, 429);
    if (res.status === 409) return json({ ok: false, error: "Cette référence correspond déjà à une autre demande. Rechargez la page et réessayez." }, 409);
    return json({ ok: false, error: unavailableMessage }, 502);
  } catch {
    // Error messages can include URLs, credentials or the submitted payload.
    logFailure(correlationId, "api-indisponible");
    return json({ ok: false, error: unavailableMessage }, 503);
  }
}

function logFailure(correlationId: string, outcome: "configuration-absente" | "api-refus" | "api-indisponible" | "accuse-invalide", status?: number) {
  console.warn("[contact] demande sans accusé confirmé", { correlationId, outcome, status: status ?? null });
}
