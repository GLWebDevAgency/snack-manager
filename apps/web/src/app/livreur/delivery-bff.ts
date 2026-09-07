import { NextRequest, NextResponse } from "next/server";
import { DeliveryAccessSecretSchema } from "@sm/contracts";

/** Server-only transport shared by the delivery access and mission Route Handlers. */
const COOKIE_PATH = "/livreur";
const BODY_LIMIT = 1_024;
const API_TIMEOUT_MS = 10_000;

export function cookieName() {
  return process.env.NODE_ENV === "production"
    ? "__Secure-sm_delivery_access"
    : "sm_delivery_access";
}

export function privateResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie, Origin");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function failure(status: number, code: string, message: string) {
  return privateResponse(NextResponse.json({ code, message }, { status }));
}

export function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const,
    path: COOKIE_PATH, priority: "high" as const };
}

export function clearSession(response: NextResponse) {
  response.cookies.set(cookieName(), "", { ...cookieOptions(), maxAge: 0 });
  return response;
}

export function readToken(request: NextRequest): string | null {
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

export function rejectOrigin(request: NextRequest, mutation: boolean) {
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

export async function boundedJson(request: NextRequest): Promise<unknown> {
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

export async function api(request: NextRequest, path: string, method: string, token?: string, body?: unknown) {
  const origin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  return fetch(`${origin.replace(/\/+$/, "")}/delivery-access/${path}`, {
    method, cache: "no-store", redirect: "error",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

export function unavailable() {
  return failure(503, "SERVICE_UNAVAILABLE", "Connexion impossible pour le moment. Réessayez depuis cette page.");
}

export function rateLimited(response: Response) {
  const result = failure(429, "RATE_LIMITED", "Trop de tentatives. Patientez un instant avant de réessayer.");
  const after = response.headers.get("retry-after");
  if (after && /^\d{1,3}$/.test(after)) result.headers.set("Retry-After", String(Math.min(300, Math.max(1, Number(after)))));
  return result;
}

function expiredSession() {
  return clearSession(failure(401, "ACCESS_UNAVAILABLE", "Cet accès a expiré ou a été retiré par le restaurant."));
}

/** Cookie scope and origin checks remain identical on every delivery endpoint. */
export function missionSession(request: NextRequest, mutation: boolean) {
  const rejection = rejectOrigin(request, mutation);
  if (rejection) return { response: rejection } as const;
  const token = readToken(request);
  if (!token) return { response: expiredSession() } as const;
  return { token } as const;
}

/** Do not let Object.fromEntries silently pick one of two query values. */
export function uniqueQuery(request: NextRequest): Record<string, string> | null {
  const entries = [...request.nextUrl.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return null;
  return Object.fromEntries(entries);
}

export function invalidMissionRequest() {
  return failure(400, "INVALID_REQUEST", "La demande de mission est invalide. Actualisez les missions.");
}

const MISSION_CONFLICTS: Readonly<Record<string, string>> = {
  DELIVERY_MISSION_CHANGED: "Cette mission a changé. Actualisez-la avant de continuer.",
  DELIVERY_MISSION_OPERATION_CONFLICT: "Cette tentative ne correspond pas à l’action enregistrée. Actualisez la mission et contactez le restaurant.",
  DELIVERY_OPERATOR_CHANGED: "L’accès du livreur a changé. Actualisez la mission et contactez le restaurant.",
  DELIVERY_MISSION_LIMIT: "Cette mission nécessite une vérification par le restaurant avant de continuer.",
  "delivery.mission.not_ready": "La cuisine doit marquer la commande prête avant le départ.",
  "delivery.mission.payment_blocked": "Le restaurant doit vérifier le paiement. Ne partez pas avec cette commande.",
  "delivery.mission.unassigned": "Cette mission doit être affectée à un livreur avant le départ.",
  "delivery.mission.departed": "Le départ est déjà confirmé. Actualisez la mission.",
  "delivery.mission.closed": "Cette mission est terminée ou annulée. Actualisez les missions.",
  "delivery.mission.invalid": "Cette commande ne peut pas devenir une mission de livraison.",
};

/** Unknown errors never disclose an order, a payment credential or an upstream header. */
async function missionFailure(response: Response) {
  if (response.status === 401) return expiredSession();
  if (response.status === 404) return failure(404, "MISSION_UNAVAILABLE", "Cette mission n’est plus disponible pour cet accès. Actualisez les missions.");
  if (response.status === 403) return failure(403, "MISSION_REFUSED", "Cet accès ne permet pas cette action. Actualisez les missions.");
  if (response.status === 400) return invalidMissionRequest();
  if (response.status === 429) return rateLimited(response);
  if (response.status === 409) {
    let code = "MISSION_CONFLICT";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "code" in body && typeof body.code === "string"
        && Object.hasOwn(MISSION_CONFLICTS, body.code)) code = body.code;
    } catch { /* An unreadable conflict is ambiguous, never a terminal proof. */ }
    return failure(409, code, MISSION_CONFLICTS[code] ?? "La mission a changé ou cette action ne peut pas être confirmée. Actualisez-la avant de continuer.");
  }
  return unavailable();
}

type ViewSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

export async function missionApiResponse<T>(request: NextRequest, options: {
  path: string; method: "GET" | "POST"; token: string; schema: ViewSchema<T>;
  body?: unknown; matches?: (value: T) => boolean;
}) {
  try {
    const response = await api(request, options.path, options.method, options.token, options.body);
    if (response.status !== 200) return await missionFailure(response);
    const parsed = options.schema.safeParse(await response.json());
    if (!parsed.success || (options.matches && !options.matches(parsed.data))) return unavailable();
    return privateResponse(NextResponse.json(parsed.data));
  } catch { return unavailable(); }
}
