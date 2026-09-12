import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { LoyaltyCardApp } from "@/components/loyalty/LoyaltyCardApp";
import { loadPublicLoyalty } from "@/components/loyalty/public-api";
import { Storefront } from "@/components/order/Storefront";
import { resumeFidelite } from "@/components/order/fidelite";
import { customerSurface, loadCustomerPublicSurfaces } from "@/components/customer-account/customer-public-surfaces";

type Props = { params: Promise<{ slug: string }> };

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return { title: "Programme fidélité indisponible", robots: { index: false } };
  const title = `${catalog.program.name} — ${catalog.restaurant.name}`;
  const description = `Consultez votre solde et les récompenses du programme fidélité ${catalog.restaurant.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `${siteOrigin()}/r/${catalog.restaurant.slug}/fidelite` },
    manifest: `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite/manifest.webmanifest`,
    icons: { icon: `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite/icon.svg` },
    /*
     * LA BARRE D'ÉTAT SUIT LE MODE DU MASQUE.
     *
     * `black-translucent` était écrit en dur : iOS y peint l'heure et la
     * batterie en BLANC et laisse la page passer sous l'encoche. Installée
     * depuis une carte claire (Brasserie, Atelier, Marché, Soleil), la PWA
     * s'ouvrait donc sur du blanc illisible au-dessus d'un fond crème.
     * `default` rend la barre opaque et son texte sombre — le bon réglage
     * partout où le masque est clair.
     */
    appleWebApp: {
      capable: true,
      title: catalog.restaurant.name,
      statusBarStyle: catalog.restaurant.brand.mode === "dark" ? "black-translucent" : "default",
    },
    openGraph: { title, description, type: "website", locale: "fr_FR" },
  };
}

/**
 * La barre du navigateur mobile prend la couleur du MASQUE, pas notre noir.
 *
 * Sans `themeColor`, Chrome Android et Safari peignaient leur chrome avec la
 * couleur du thème par défaut au-dessus d'une carte crème : la couture se
 * voyait au pixel près, sur la surface la plus regardée du programme.
 * `colorScheme` fait suivre les contrôles natifs et l'ascenseur avant même que
 * la racine cliente ne soit peinte.
 *
 * `loadPublicLoyalty` est mémorisé par `cache()` : `generateMetadata`, ce
 * viewport et la page se partagent UN seul appel. Si la fidélité ne répond
 * pas, la vitrine saine peut encore fournir sa marque. La page distingue
 * ensuite l'absence explicite d'une indisponibilité temporaire.
 */
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const { site, catalog } = await loadCustomerPublicSurfaces(slug);
  const brand = catalog.state === 'available' ? catalog.value.restaurant.brand : site.state === 'available' ? site.value.tenant.brand : undefined;
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    ...(brand
      ? {
          themeColor: brand.palette.ground,
          colorScheme: brand.mode,
        }
      : {}),
  };
}

export default async function LoyaltyCustomerPage({ params }: Props) {
  const { slug } = await params;
  const surface = customerSurface(await loadCustomerPublicSurfaces(slug));
  if (surface.kind === 'storefront') return <Storefront site={surface.site} loyalty={resumeFidelite(surface.catalog ?? null)}
    loyaltyCatalog={surface.catalog} unavailableService={surface.unavailableService} />;
  if (surface.kind === 'loyalty') return <LoyaltyCardApp catalog={surface.catalog} orderingAvailable={false}
    unavailableService={surface.unavailableService} />;
  notFound();
}
