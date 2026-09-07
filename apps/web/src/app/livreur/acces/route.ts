import { NextRequest, NextResponse } from "next/server";
import {
  DELIVERY_SESSION_TTL_MS,
  DeliveryAccessSecretSchema,
  DeliverySessionExchangeSchema,
  DeliverySessionViewSchema,
} from "@sm/contracts";

const COOKIE_PATH = "/livreur";
const BODY_LIMIT = 1_024;
const API_TIMEOUT_MS = 10_000;

function cookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Secure-sm_delivery_access"
    : "sm_delivery_access";
}

function privateResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie, Origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function failure(status: number, code: string, message: string) {
  return privateResponse(NextResponse.json({ code, message }, { status }));
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const,
    path: COOKIE_PATH, priority: "high" as const };
}

function clearSession(response: NextResponse) {
  response.cookies.set(cookieName(), "", { ...cookieOptions(), maxAge: 0 });
  return response;
}

function readToken(request: NextRequest): string | null {
  const name = cookieName();
  // Refuse ambiguous cookie paths/domains instead of selecting one identity.
  const copies = (request.headers.get("cookie") ?? "").split(";")
    .filter(part => part.trim().startsWith(`${name}=`));
  if (copies.length !== 1) return null;
  const token = request.cookies.get(name)?.value;
  return DeliveryAccessSecretSchema.safeParse(token).success ? token! : null;
}

function normalizedOrigin(raw: string | null): string | null {
  if (!raw || raw.includes(",")) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get("x-forwarded-host");
  const protocol = request.headers.get("x-forwarded-proto");
  if (host === null && protocol === null) {
    // NextURL normalizes 127.0.0.1 / ::1 to localhost. Keep the browser's Host
    // for the same-origin comparison; the platform allowlist still validates it.
    return normalizedOrigin(`${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`);
  }
  if (!host || (protocol !== "https" && protocol !== "http")) return null;
  return normalizedOrigin(`${protocol}://${host}`);
}

function configuredPlatformOrigin(origin: string): boolean {
  const configured = normalizedOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? null);
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const origins = new Set<string>(configured ? [configured] : []);
  if (environment === "staging") {
    origins.add("https://staging.snackmanager.fr");
    origins.add("https://web-staging-6f5f.up.railway.app");
  } else if (environment === "production") {
    origins.add("https://snackmanager.fr");
    origins.add("https://www.snackmanager.fr");
    origins.add("https://web-production-99b58c.up.railway.app");
  }
  if (origins.has(origin)) return true;
  if (process.env.NODE_ENV !== "production") {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return false;
}

function rejectOrigin(request: NextRequest, mutation: boolean) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return failure(403, "ORIGIN_REFUSED", "Cette demande doit venir de la page livreur.");
  }
  const raw = request.headers.get("origin");
  const expected = requestOrigin(request);
  if (!expected || !configuredPlatformOrigin(expected)
    || (process.env.NODE_ENV === "production" && !expected.startsWith("https://"))
    || ((mutation || raw !== null) && normalizedOrigin(raw) !== expected)) {
    return failure(403, "ORIGIN_REFUSED", "Cette demande doit venir de la page livreur.");
  }
  return null;
}

async function boundedJson(request: NextRequest): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    let size = 0;
    let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}

async function api(request: NextRequest, path: string, method: string, token?: string, body?: unknown) {
  const origin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  return fetch(`${origin.replace(/\/+$/, "")}/delivery-access/${path}`, {
    method, cache: "no-store", redirect: "error",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function unavailable() {
  return failure(503, "SERVICE_UNAVAILABLE", "Connexion impossible pour le moment. Réessayez depuis cette page.");
}

function refused(response: Response) {
  if (response.status === 429) {
    const result = failure(429, "RATE_LIMITED", "Trop de tentatives. Patientez un instant avant de réessayer.");
    const after = response.headers.get("retry-after");
    if (after && /^\d{1,3}$/.test(after)) result.headers.set("Retry-After", String(Math.min(300, Math.max(1, Number(after)))));
    return result;
  }
  if ([400, 401, 403, 404, 409, 410].includes(response.status)) {
    return failure(401, "INVITATION_UNAVAILABLE", "Ce lien n’est plus utilisable. Demandez un nouveau lien au restaurant.");
  }
  return unavailable();
}

export async function GET(request: NextRequest) {
  const rejection = rejectOrigin(request, false);
  if (rejection) return rejection;
  const token = readToken(request);
  if (!token) return clearSession(privateResponse(new NextResponse(null, { status: 204 })));
  try {
    const response = await api(request, "session", "GET", token);
    if ([401, 403, 404].includes(response.status)) {
      return clearSession(failure(401, "ACCESS_UNAVAILABLE", "Cet accès a expiré ou a été retiré par le restaurant."));
    }
    if (!response.ok) return unavailable();
    const session = DeliverySessionViewSchema.safeParse(await response.json());
    if (!session.success) return unavailable();
    if (Date.parse(session.data.expiresAt) <= Date.now()) {
      return clearSession(failure(401, "ACCESS_UNAVAILABLE", "Cet accès a expiré. Demandez un nouveau lien au restaurant."));
    }
    return privateResponse(NextResponse.json(session.data));
  } catch { return unavailable(); }
}

export async function POST(request: NextRequest) {
  const rejection = rejectOrigin(request, true);
  if (rejection) return rejection;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, "INVALID_REQUEST", "La demande d’association est invalide.");
  }
  const exchange = DeliverySessionExchangeSchema.safeParse(await boundedJson(request));
  if (!exchange.success) return failure(400, "INVALID_REQUEST", "Le lien d’association est invalide.");
  try {
    const response = await api(request, "exchange", "POST", undefined, exchange.data);
    if (!response.ok) return refused(response);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join(",") !== "session,token") return unavailable();
    const result = body as { token: unknown; session: unknown };
    const token = DeliveryAccessSecretSchema.safeParse(result.token);
    const session = DeliverySessionViewSchema.safeParse(result.session);
    if (!token.success || !session.success) return unavailable();
    const remaining = Date.parse(session.data.expiresAt) - Date.now();
    if (remaining < 1_000 || remaining > DELIVERY_SESSION_TTL_MS + 60_000) return unavailable();
    // The opaque credential never enters the response JSON or client props.
    const outgoing = privateResponse(NextResponse.json(session.data));
    outgoing.cookies.set(cookieName(), token.data, { ...cookieOptions(),
      maxAge: Math.floor(Math.min(remaining, DELIVERY_SESSION_TTL_MS) / 1_000),
      expires: new Date(Math.min(Date.parse(session.data.expiresAt), Date.now() + DELIVERY_SESSION_TTL_MS)),
    });
    return outgoing;
  } catch { return unavailable(); }
}

export async function DELETE(request: NextRequest) {
  const rejection = rejectOrigin(request, true);
  if (rejection) return rejection;
  const token = readToken(request);
  if (!token) return clearSession(privateResponse(new NextResponse(null, { status: 204 })));
  try {
    const response = await api(request, "logout", "POST", token);
    if (response.status === 204 || [401, 403, 404].includes(response.status)) {
      return clearSession(privateResponse(new NextResponse(null, { status: 204 })));
    }
    return unavailable();
  } catch { return unavailable(); }
}
