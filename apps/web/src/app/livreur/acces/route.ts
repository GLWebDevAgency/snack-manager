import { NextRequest, NextResponse } from "next/server";
import {
  DELIVERY_SESSION_TTL_MS,
  DeliveryAccessSecretSchema,
  DeliverySessionExchangeSchema,
  DeliverySessionViewSchema,
} from "@sm/contracts";

import {
  api, boundedJson, clearSession, cookieName, cookieOptions, failure,
  privateResponse, rateLimited, readToken, rejectOrigin, unavailable,
} from "../delivery-bff";

function refused(response: Response) {
  if (response.status === 429) return rateLimited(response);
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
