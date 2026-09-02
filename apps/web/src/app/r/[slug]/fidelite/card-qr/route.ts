import { toString as qrToString } from "qrcode";
import { NextRequest } from "next/server";
import {
  LoyaltyPublicApiError,
  loadCustomerLoyaltyCard,
} from "@/components/loyalty/public-api";
import {
  LOYALTY_SLUG_PATTERN,
  LOYALTY_QR_TOKEN_PATTERN,
  loyaltyCardCookieName,
} from "../card-session/session-cookie";
import {
  takeLoyaltyCardReadQuota,
  trustedLoyaltyClientIdentity,
} from "../card-session/rate-limit";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!LOYALTY_SLUG_PATTERN.test(slug)) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  const qrToken = request.cookies.get(loyaltyCardCookieName(slug))?.value;
  if (!qrToken || !LOYALTY_QR_TOKEN_PATTERN.test(qrToken)) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  const relayClientIdentity = trustedLoyaltyClientIdentity(request);
  if (!relayClientIdentity) {
    return new Response(null, { status: 503, headers: PRIVATE_HEADERS });
  }

  const quota = takeLoyaltyCardReadQuota(slug, qrToken, relayClientIdentity);
  if (!quota.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        ...PRIVATE_HEADERS,
        "Retry-After": String(quota.retryAfterSeconds),
      },
    });
  }

  try {
    // Une carte bloquée ou un QR révoqué ne doit plus pouvoir être affiché.
    await loadCustomerLoyaltyCard(
      slug,
      qrToken,
      request.signal,
      relayClientIdentity,
    );
    const svg = await qrToString(qrToken, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360,
      color: { dark: "#111111", light: "#ffffff" },
    });
    return new Response(svg, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "image/svg+xml; charset=utf-8",
      },
    });
  } catch (cause) {
    const status = cause instanceof LoyaltyPublicApiError ? cause.status : 503;
    return new Response(null, { status, headers: PRIVATE_HEADERS });
  }
}
