import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return { load: vi.fn(), ApiError };
});

vi.mock("@/components/loyalty/public-api", () => ({
  loadCustomerLoyaltyCard: api.load,
  LoyaltyPublicApiError: api.ApiError,
}));

const TOKEN = "A".repeat(43);
const CARD = {
  restaurant: { slug: "classfood", name: "Classfood", brandColor: "#c9a15a" },
  program: {
    name: "La carte Classfood",
    status: "active",
    mechanism: "points",
    unitLabelSingular: "point",
    unitLabelPlural: "points",
    termsSummary: "Conditions du programme",
  },
  member: {
    alias: "Maya",
    balanceUnits: 125,
  },
  rewards: [],
  activity: [],
};

function context(slug = "classfood") {
  return { params: Promise.resolve({ slug }) };
}

function request(
  method: "GET" | "POST" | "DELETE",
  options: {
    body?: unknown;
    cookie?: string;
    origin?: string;
    fetchSite?: string;
    realIp?: string;
    forwardedFor?: string;
  } = {},
) {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.origin) headers.set("Origin", options.origin);
  if (options.fetchSite) headers.set("Sec-Fetch-Site", options.fetchSite);
  if (options.realIp) headers.set("X-Real-IP", options.realIp);
  if (options.forwardedFor) headers.set("X-Forwarded-For", options.forwardedFor);
  return new NextRequest("https://commande.classfood.example/r/classfood/fidelite/card-session", {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("relais de carte fidélité", () => {
  beforeEach(async () => {
    api.load.mockReset().mockResolvedValue(CARD);
    const { resetLoyaltyCardQuotaForTests } = await import("./rate-limit");
    resetLoyaltyCardQuotaForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("valide le QR avant de le placer dans un cookie HttpOnly à portée minimale", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request("POST", {
        body: { qrToken: TOKEN },
        origin: "https://commande.classfood.example",
        fetchSite: "same-origin",
        realIp: "203.0.113.10",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`sm_loyalty_classfood=${TOKEN}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/r/classfood/fidelite");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual(CARD);
    expect(api.load).toHaveBeenCalledWith(
      "classfood",
      TOKEN,
      expect.any(AbortSignal),
      "edge-ip:203.0.113.10",
    );
  });

  it("rouvre une carte enregistrée sans exposer le QR dans l’URL", async () => {
    const { GET } = await import("./route");
    const incoming = request("GET", {
      cookie: `sm_loyalty_classfood=${TOKEN}`,
      realIp: "203.0.113.10",
    });
    const response = await GET(incoming, context());

    expect(response.status).toBe(200);
    expect(incoming.url).not.toContain(TOKEN);
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
    expect(api.load).toHaveBeenCalledWith(
      "classfood",
      TOKEN,
      expect.any(AbortSignal),
      "edge-ip:203.0.113.10",
    );
  });

  it("répond sans contenu lorsqu’aucune carte n’est enregistrée", async () => {
    const { GET } = await import("./route");
    const response = await GET(request("GET"), context());
    expect(response.status).toBe(204);
    expect(api.load).not.toHaveBeenCalled();
  });

  it("efface automatiquement un QR révoqué", async () => {
    api.load.mockRejectedValueOnce(new api.ApiError(404, "Carte indisponible"));
    const { GET } = await import("./route");
    const response = await GET(
      request("GET", {
        cookie: `sm_loyalty_classfood=${TOKEN}`,
        realIp: "203.0.113.10",
      }),
      context(),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    { origin: "https://attaque.example" },
    { fetchSite: "cross-site" },
  ])("refuse une mutation intersite avant de lire le QR", async (headers) => {
    const { POST } = await import("./route");
    const response = await POST(
      request("POST", { body: { qrToken: TOKEN }, ...headers }),
      context(),
    );
    expect(response.status).toBe(403);
    expect(api.load).not.toHaveBeenCalled();
  });

  it("refuse un jeton mal formé sans appel backend", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request("POST", { body: { qrToken: "trop-court" } }),
      context(),
    );
    expect(response.status).toBe(400);
    expect(api.load).not.toHaveBeenCalled();
  });

  it("borne l’initialisation par IP edge, secret et restaurant", async () => {
    const { POST } = await import("./route");
    const {
      LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT,
      takeLoyaltySessionInitQuota,
    } = await import("./rate-limit");
    const incoming = request("POST", {
      body: { qrToken: TOKEN },
      realIp: "203.0.113.10",
      forwardedFor: "198.51.100.1",
    });
    for (let index = 0; index < LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT; index += 1) {
      expect(takeLoyaltySessionInitQuota(incoming, "classfood", TOKEN).allowed).toBe(true);
    }

    const limited = await POST(
      request("POST", {
        body: { qrToken: TOKEN },
        realIp: "203.0.113.10",
        forwardedFor: "192.0.2.200",
      }),
      context(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Cache-Control")).toContain("no-store");
    expect(api.load).not.toHaveBeenCalled();

    expect(
      (
        await POST(
          request("POST", {
            body: { qrToken: `B${TOKEN.slice(1)}` },
            realIp: "203.0.113.10",
          }),
          context(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await POST(
          request("POST", { body: { qrToken: TOKEN }, realIp: "203.0.113.10" }),
          context("autre-resto"),
        )
      ).status,
    ).toBe(200);
  });

  it("échoue fermé sans identité edge au lieu de partager un bucket unknown", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request("POST", {
        body: { qrToken: TOKEN },
        forwardedFor: "192.0.2.99",
      }),
      context(),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(api.load).not.toHaveBeenCalled();

    const { GET } = await import("./route");
    const remembered = await GET(
      request("GET", { cookie: `sm_loyalty_classfood=${TOKEN}` }),
      context(),
    );
    expect(remembered.status).toBe(503);
    expect(api.load).not.toHaveBeenCalled();
  });

  it("retire explicitement la carte de l’appareil", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      request("DELETE", {
        origin: "https://commande.classfood.example",
        fetchSite: "same-origin",
      }),
      context(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(api.load).not.toHaveBeenCalled();
  });
});
