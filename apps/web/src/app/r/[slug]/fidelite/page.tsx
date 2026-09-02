import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { LoyaltyCardApp } from "@/components/loyalty/LoyaltyCardApp";
import { LoyaltyPublicApiError, loadPublicLoyalty } from "@/components/loyalty/public-api";

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
 * viewport et la page se partagent UN seul appel. Un programme introuvable
 * retombe sur l'absence de couleur plutôt que d'échouer au rendu — c'est
 * `notFound()` qui tranchera dans la page.
 */
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  return {
    width: "device-width",
    initialScale: 1,
    ...(catalog
      ? {
          themeColor: catalog.restaurant.brand.palette.ground,
          colorScheme: catalog.restaurant.brand.mode,
        }
      : {}),
  };
}

export default async function LoyaltyCustomerPage({ params }: Props) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch((cause: unknown) => {
    if (cause instanceof LoyaltyPublicApiError && cause.status === 404) notFound();
    throw cause;
  });
  return <LoyaltyCardApp catalog={catalog} />;
}
