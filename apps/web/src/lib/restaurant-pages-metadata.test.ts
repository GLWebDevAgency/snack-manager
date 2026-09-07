import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { publicRestaurantMetadata } from "./restaurant-metadata";

const mocks = vi.hoisted(() => ({ site: vi.fn(), ticket: vi.fn(), loyalty: vi.fn() }));
vi.mock("@/components/order/api", () => ({ loadSite: mocks.site }));
vi.mock("@/components/order/Storefront", () => ({ Storefront: () => null }));
vi.mock("@/components/order/Tracking", () => ({ Tracking: () => null }));
vi.mock("@/components/loyalty/LoyaltyCardApp", () => ({ LoyaltyCardApp: () => null }));
vi.mock("@/components/loyalty/public-api", () => ({ loadPublicLoyalty: mocks.loyalty }));
vi.mock("@/components/masque/polices", () => ({ classesPolices: "fonts" }));
vi.mock("@/app/t/[id]/tracking-api", () => ({
  loadTicket: mocks.ticket,
  readToken: (value: string | undefined) => value?.trim() || null,
}));

import { generateMetadata as restaurant } from "@/app/r/[slug]/page";
import { generateMetadata as embed } from "@/app/embed/[slug]/page";
import { generateMetadata as tracking } from "@/app/t/[id]/page";
import { generateMetadata as loyalty } from "@/app/r/[slug]/fidelite/page";

const params = { params: Promise.resolve({ slug: "classfood" }), searchParams: Promise.resolve({}) };
const trackingParams = (token?: string) => ({
  params: Promise.resolve({ id: "private-order-id" }), searchParams: Promise.resolve({ t: token }),
});

beforeEach(() => {
  mocks.site.mockReset().mockResolvedValue({
    tenant: { slug: "classfood", name: "Classfood", address: "", logoUrl: null, brand: DIRECTIONS.soleil },
    categories: [], medias: [],
  });
  mocks.ticket.mockReset().mockResolvedValue({ header: { slug: "classfood" } });
  mocks.loyalty.mockReset().mockResolvedValue({
    restaurant: { slug: "classfood", name: "Classfood", brand: DIRECTIONS.soleil },
    program: { name: "Ma carte" },
  });
});

describe("générateurs de métadonnées publics", () => {
  it.each([restaurant, embed])("pose l'icône restaurant sans installer la commande", async (generate) => {
    expect(await generate(params)).toMatchObject({
      manifest: null, icons: { icon: [{ url: "/r/classfood/icon.svg" }], apple: [] },
    });
  });

  it.each([restaurant, embed])("laisse le layout neutre protéger les erreurs de catalogue", async (generate) => {
    mocks.site.mockRejectedValue(new Error("404 or upstream outage"));
    const metadata = await generate(params);
    expect(metadata.manifest ?? null).toBeNull();
    expect(metadata.icons ?? publicRestaurantMetadata.icons).toEqual(publicRestaurantMetadata.icons);
    expect(JSON.stringify(metadata)).not.toContain("/r/classfood/icon.svg");
  });

  it("ne place que le slug public du ticket dans l'icône du suivi", async () => {
    const metadata = await tracking(trackingParams("private-token"));
    expect(metadata).toMatchObject({
      icons: { icon: [{ url: "/r/classfood/icon.svg" }] },
      referrer: "no-referrer", robots: { index: false, follow: false }, manifest: null,
    });
    expect(JSON.stringify(metadata)).not.toMatch(/private-token|private-order-id/);
  });

  it("n'interroge rien pour un suivi sans jeton", async () => {
    expect(await tracking(trackingParams())).toMatchObject({
      icons: publicRestaurantMetadata.icons, referrer: "no-referrer",
    });
    expect(mocks.ticket).not.toHaveBeenCalled();
  });

  it.each([null, {}, { header: {} }, { header: { slug: "../other?t=secret" } }])(
    "reste neutre si le ticket ne donne pas de slug valide", async (ticket) => {
      mocks.ticket.mockResolvedValue(ticket);
      expect(await tracking(trackingParams("private-token"))).toMatchObject({
        icons: publicRestaurantMetadata.icons, referrer: "no-referrer",
      });
    },
  );

  it("reste neutre lorsque le ticket est indisponible", async () => {
    mocks.ticket.mockRejectedValue(new Error("upstream"));
    expect(await tracking(trackingParams("private-token"))).toMatchObject({
      icons: publicRestaurantMetadata.icons, robots: { index: false, follow: false },
    });
  });

  it("laisse la fidélité réactiver sa propre installation", async () => {
    expect(await loyalty(params)).toMatchObject({
      manifest: "/r/classfood/fidelite/manifest.webmanifest",
      icons: { icon: "/r/classfood/fidelite/icon.svg" },
      appleWebApp: { capable: true, title: "Classfood" },
    });
  });

  it("une fidélité inactive n'hérite d'aucune installation plateforme", async () => {
    mocks.loyalty.mockRejectedValue(new Error("404"));
    expect(await loyalty(params)).toEqual({ title: "Programme fidélité indisponible", robots: { index: false } });
  });

  it("tous les layouts d'erreur restent neutres sans requête réseau", async () => {
    for (const layout of [await import("@/app/r/layout"), await import("@/app/embed/layout"), await import("@/app/t/layout")]) {
      expect(layout.metadata).toBe(publicRestaurantMetadata);
    }
    expect(mocks.site).not.toHaveBeenCalled();
    expect(mocks.ticket).not.toHaveBeenCalled();
    expect(mocks.loyalty).not.toHaveBeenCalled();
  });
});
