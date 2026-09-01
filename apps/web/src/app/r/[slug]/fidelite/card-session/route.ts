import { NextRequest, NextResponse } from "next/server";
import { LoyaltyCustomerCardResolveSchema } from "@sm/contracts";
import {
  LoyaltyPublicApiError,
  loadCustomerLoyaltyCard,
} from "@/components/loyalty/public-api";
import {
  LOYALTY_SLUG_PATTERN,
  LOYALTY_QR_TOKEN_PATTERN,
  loyaltyCardCookieName,
  loyaltyCardCookiePath,
} from "./session-cookie";
import {
  takeLoyaltyCardReadQuota,
  takeLoyaltySessionInitQuota,
  trustedLoyaltyClientIdentity,
  type LoyaltyCardQuota,
} from "./rate-limit";

const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

type Context = { params: Promise<{ slug: string }> };

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

function rejectCrossSite(request: NextRequest): NextResponse | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return noStore(NextResponse.json({ message: "Origine refusée" }, { status: 403 }));
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return noStore(NextResponse.json({ message: "Origine refusée" }, { status: 403 }));
  }
  return null;
}

async function slugOf(context: Context): Promise<string | null> {
  const { slug } = await context.params;
  return LOYALTY_SLUG_PATTERN.test(slug) ? slug : null;
}

function clearCookie(response: NextResponse, slug: string): NextResponse {
  response.cookies.set(loyaltyCardCookieName(slug), "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: loyaltyCardCookiePath(slug),
    maxAge: 0,
  });
  return response;
}

function apiFailure(cause: unknown): NextResponse {
  if (cause instanceof LoyaltyPublicApiError) {
    return noStore(
      NextResponse.json({ message: cause.message }, { status: cause.status }),
    );
  }
  return noStore(
    NextResponse.json(
      { message: "Le service fidélité est momentanément indisponible" },
      { status: 503 },
    ),
  );
}

function quotaFailure(quota: Exclude<LoyaltyCardQuota, { allowed: true }>): NextResponse {
  if (quota.reason === "unverified-client") {
    return noStore(
      NextResponse.json(
        { message: "La vérification de sécurité est momentanément indisponible." },
        { status: 503 },
      ),
    );
  }
  const response = noStore(
    NextResponse.json(
      { message: "Trop de tentatives. Réessayez dans un instant." },
      { status: 429 },
    ),
  );
  response.headers.set("Retry-After", String(quota.retryAfterSeconds ?? 60));
  return response;
}

function enforceReadQuota(
  slug: string,
  qrToken: string,
  clientIdentity: string,
): NextResponse | null {
  const quota = takeLoyaltyCardReadQuota(slug, qrToken, clientIdentity);
  return quota.allowed ? null : quotaFailure(quota);
}

function enforceSessionInitQuota(
  request: NextRequest,
  slug: string,
  qrToken: string,
): NextResponse | null {
  const quota = takeLoyaltySessionInitQuota(request, slug, qrToken);
  return quota.allowed ? null : quotaFailure(quota);
}

export async function GET(request: NextRequest, context: Context) {
  const slug = await slugOf(context);
  if (!slug) return noStore(new NextResponse(null, { status: 404 }));

  const qrToken = request.cookies.get(loyaltyCardCookieName(slug))?.value;
  if (!qrToken) return noStore(new NextResponse(null, { status: 204 }));
  if (!LOYALTY_QR_TOKEN_PATTERN.test(qrToken)) {
    return clearCookie(noStore(new NextResponse(null, { status: 404 })), slug);
  }
  const relayClientIdentity = trustedLoyaltyClientIdentity(request);
  if (!relayClientIdentity) {
    return quotaFailure({ allowed: false, reason: "unverified-client" });
  }

  const limited = enforceReadQuota(slug, qrToken, relayClientIdentity);
  if (limited) return limited;

  try {
    return noStore(
      NextResponse.json(
        await loadCustomerLoyaltyCard(
          slug,
          qrToken,
          request.signal,
          relayClientIdentity,
        ),
      ),
    );
  } catch (cause) {
    const response = apiFailure(cause);
    return cause instanceof LoyaltyPublicApiError && cause.status === 404
      ? clearCookie(response, slug)
      : response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  const rejected = rejectCrossSite(request);
  if (rejected) return rejected;

  const slug = await slugOf(context);
  if (!slug) return noStore(new NextResponse(null, { status: 404 }));
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return noStore(
      NextResponse.json({ message: "Corps JSON attendu" }, { status: 415 }),
    );
  }

  const parsed = LoyaltyCustomerCardResolveSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return noStore(
      NextResponse.json({ message: "Carte fidélité invalide" }, { status: 400 }),
    );
  }

  const relayClientIdentity = trustedLoyaltyClientIdentity(request);
  if (!relayClientIdentity) {
    return quotaFailure({ allowed: false, reason: "unverified-client" });
  }

  const limited = enforceSessionInitQuota(request, slug, parsed.data.qrToken);
  if (limited) return limited;

  try {
    const card = await loadCustomerLoyaltyCard(
      slug,
      parsed.data.qrToken,
      request.signal,
      relayClientIdentity,
    );
    const response = noStore(NextResponse.json(card));
    response.cookies.set(loyaltyCardCookieName(slug), parsed.data.qrToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: loyaltyCardCookiePath(slug),
      maxAge: COOKIE_MAX_AGE_SECONDS,
      priority: "high",
    });
    return response;
  } catch (cause) {
    return apiFailure(cause);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const rejected = rejectCrossSite(request);
  if (rejected) return rejected;

  const slug = await slugOf(context);
  if (!slug) return noStore(new NextResponse(null, { status: 404 }));
  return clearCookie(noStore(new NextResponse(null, { status: 204 })), slug);
}
