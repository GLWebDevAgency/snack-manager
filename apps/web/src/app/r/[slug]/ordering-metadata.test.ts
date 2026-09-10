import type { Metadata } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { publicRestaurantMetadata } from "@/lib/restaurant-metadata";

const mocks = vi.hoisted(() => ({ loadSite: vi.fn() }));
vi.mock("@/components/order/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/order/api")>(),
  loadSite: mocks.loadSite,
}));
// Next supplies the server boundary and compiled font classes. The metadata
// generators and all of their identity/URL helpers remain real modules.
vi.mock("server-only", () => ({}));
vi.mock("@/components/masque/polices", () => ({ classesPolices: "fonts" }));

import * as carte from "./carte/page";
import * as commandes from "./commandes/page";
import * as recherche from "./recherche/page";

type Route = {
  metadata?: Metadata;
  generateMetadata?: (props: { params: Promise<{ slug: string }> }) => Promise<Metadata>;
};

const routes: { path: string; route: Route; title: string; indexed: boolean }[] = [
  { path: "carte", route: carte, title: "Classfood — Commander en ligne", indexed: true },
  { path: "commandes", route: commandes, title: "Mes commandes", indexed: false },
  { path: "recherche", route: recherche, title: "Rechercher un produit", indexed: false },
];

async function metadataFor(route: Route, slug: string): Promise<Metadata> {
  return route.generateMetadata
    ? route.generateMetadata({ params: Promise.resolve({ slug }) })
    : route.metadata ?? {};
}

beforeEach(() => {
  mocks.loadSite.mockReset().mockImplementation(async (slug: string) => {
    if (slug === "introuvable") throw new Error("Catalogue introuvable");
    return {
      tenant: {
        slug,
        name: slug === "classfood" ? "Classfood" : "Autre restaurant",
        address: "",
        logoUrl: null,
        brand: DIRECTIONS.soleil,
      },
      categories: [],
      medias: [],
    };
  });
});

describe.each(routes)("métadonnées de /r/[slug]/$path", ({ route, title, indexed }) => {
  it("conserve l’installation et l’identité du restaurant avec le titre propre à la route", async () => {
    const metadata = await metadataFor(route, "classfood");

    expect(metadata).toMatchObject({
      title,
      robots: { index: indexed, follow: true },
      manifest: "/r/classfood/manifest.webmanifest",
      icons: {
        icon: [{ url: "/r/classfood/icon.svg", type: "image/svg+xml" }],
        apple: [{ url: "/r/classfood/icon.png?size=180", sizes: "180x180", type: "image/png" }],
      },
      appleWebApp: { capable: true, title: "Classfood", statusBarStyle: "default" },
    });
    expect(mocks.loadSite).toHaveBeenCalledExactlyOnceWith("classfood");
  });

  it("résout l’identité du slug courant sans reprendre celle de la précédente enseigne", async () => {
    await metadataFor(route, "classfood");
    const metadata = await metadataFor(route, "autre-restaurant");

    expect(metadata).toMatchObject({
      manifest: "/r/autre-restaurant/manifest.webmanifest",
      icons: { icon: [{ url: "/r/autre-restaurant/icon.svg" }] },
      appleWebApp: { title: "Autre restaurant" },
    });
    expect(JSON.stringify(metadata)).not.toMatch(/classfood/i);
  });

  it("laisse le layout neutre protéger un catalogue introuvable après une enseigne valide", async () => {
    await metadataFor(route, "classfood");
    const metadata = await metadataFor(route, "introuvable");

    expect(metadata.manifest ?? publicRestaurantMetadata.manifest).toBeNull();
    expect(metadata.appleWebApp ?? publicRestaurantMetadata.appleWebApp).toBeNull();
    expect(metadata.icons ?? publicRestaurantMetadata.icons).toEqual(publicRestaurantMetadata.icons);
    expect(JSON.stringify(metadata)).not.toMatch(/classfood|\/r\//i);
    expect(mocks.loadSite).toHaveBeenLastCalledWith("introuvable");
  });
});
