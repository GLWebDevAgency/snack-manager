import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return { load: vi.fn(), ApiError };
});

vi.mock("@/components/loyalty/public-api", () => ({
  loadCustomerLoyaltyCard: mocks.load,
  LoyaltyPublicApiError: mocks.ApiError,
}));

const TOKEN = "B".repeat(43);
const context = { params: Promise.resolve({ slug: "classfood" }) };

function request(cookie?: string, realIp?: string) {
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (realIp) headers.set("X-Real-IP", realIp);
  return new NextRequest("https://commande.classfood.example/r/classfood/fidelite/card-qr", {
    headers,
  });
}

describe("QR client depuis la session HttpOnly", () => {
  beforeEach(async () => {
    mocks.load.mockReset().mockResolvedValue({ member: { alias: "Maya" } });
    const { resetLoyaltyCardQuotaForTests } = await import("../card-session/rate-limit");
    resetLoyaltyCardQuotaForTests();
  });

  it("rend un SVG scannable sans recopier le secret en clair", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      request(`sm_loyalty_classfood=${TOKEN}`, "203.0.113.42"),
      context,
    );
    const svg = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain(TOKEN);
    expect(mocks.load).toHaveBeenCalledWith(
      "classfood",
      TOKEN,
      expect.any(AbortSignal),
      "edge-ip:203.0.113.42",
    );
  });

  it("refuse l’absence de carte et le cookie d’un autre restaurant", async () => {
    const { GET } = await import("./route");
    expect((await GET(request(), context)).status).toBe(404);
    expect(
      (await GET(request(`sm_loyalty_concurrent=${TOKEN}`), context)).status,
    ).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("ne rend plus un QR révoqué", async () => {
    mocks.load.mockRejectedValueOnce(new mocks.ApiError(404, "révoqué"));
    const { GET } = await import("./route");
    const response = await GET(
      request(`sm_loyalty_classfood=${TOKEN}`, "203.0.113.42"),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("borne aussi la validation backend déclenchée par l’image QR", async () => {
    const { GET } = await import("./route");
    const {
      LOYALTY_CARD_READ_RATE_LIMIT,
      takeLoyaltyCardReadQuota,
      trustedLoyaltyClientIdentity,
    } = await import("../card-session/rate-limit");
    const cookie = `sm_loyalty_classfood=${TOKEN}`;
    const identity = trustedLoyaltyClientIdentity(request(undefined, "203.0.113.42"));
    expect(identity).not.toBeNull();

    for (let index = 0; index < LOYALTY_CARD_READ_RATE_LIMIT; index += 1) {
      expect(takeLoyaltyCardReadQuota("classfood", TOKEN, identity!).allowed).toBe(true);
    }
    const limited = await GET(request(cookie, "203.0.113.42"), context);

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("échoue fermé sans identité edge vérifiée", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      request(`sm_loyalty_classfood=${TOKEN}`),
      context,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
