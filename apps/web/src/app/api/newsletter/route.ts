import { NextRequest, NextResponse } from "next/server";
import { boundedJson, rejectsOrigin } from "./request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const FIELDS = new Set(["email", "consent", "newsletterWebsite"]);
const UNAVAILABLE = "L’inscription est indisponible pour le moment. Réessayez un peu plus tard.";

function response(body: object, status: number) {
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  } });
}

function invalid() {
  return response({ ok: false, error: "Vérifiez votre adresse e-mail et votre consentement." }, 400);
}

/** Public browser facade. Only the server owns the source and ingestion secret. */
export async function POST(request: NextRequest) {
  if (rejectsOrigin(request)) {
    return response({ ok: false, error: "Cette demande doit être envoyée depuis le site Snack Manager." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return response({ ok: false, error: "Format de demande invalide." }, 415);
  }

  // The shared reader enforces 1 KiB on declared AND streamed bytes, before JSON parsing.
  const raw = await boundedJson(request);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((field) => !FIELDS.has(field)) || body.consent !== true
    || typeof body.email !== "string"
    || (body.newsletterWebsite !== undefined && body.newsletterWebsite !== "")) return invalid();
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return invalid();

  const token = process.env.SM_CONTACT_INGEST_TOKEN?.trim();
  const configuredApi = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!token || !configuredApi) return response({ ok: false, error: UNAVAILABLE }, 503);

  try {
    const api = new URL(configuredApi);
    if (!["http:", "https:"].includes(api.protocol) || api.username || api.password || api.search || api.hash) {
      return response({ ok: false, error: UNAVAILABLE }, 503);
    }
    const upstream = await fetch(`${api.toString().replace(/\/+$/, "")}/public/newsletter`, {
      method: "POST", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, consent: true, source: "site-vitrine" }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (upstream.status === 429) {
      const result = response({ ok: false, error: "Trop de demandes ont été reçues. Patientez quelques minutes avant de réessayer." }, 429);
      const retry = upstream.headers.get("retry-after");
      if (retry && /^\d{1,3}$/.test(retry)) result.headers.set("Retry-After", String(Math.min(300, Math.max(1, Number(retry)))));
      return result;
    }
    if (upstream.status === 400) return invalid();
    if (upstream.status !== 202) return response({ ok: false, error: UNAVAILABLE }, 503);

    const acknowledgement: unknown = await upstream.json();
    if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)
      || Object.keys(acknowledgement).some((key) => key !== "ok" && key !== "pending")
      || (acknowledgement as Record<string, unknown>).ok !== true
      || (acknowledgement as Record<string, unknown>).pending !== true) {
      return response({ ok: false, error: UNAVAILABLE }, 503);
    }
    // Acknowledged double-opt-in request, never a confirmed subscription.
    return response({ ok: true, pending: true }, 202);
  } catch {
    // Provider bodies, URLs, error messages and email addresses stay out of logs.
    return response({ ok: false, error: UNAVAILABLE }, 503);
  }
}
