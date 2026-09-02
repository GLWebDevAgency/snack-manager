import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { loadSite, PublicApiError } from "@/components/order/api";
import { cityOf, euros } from "@/components/order/helpers";
import { restaurantJsonLd, serializeJsonLd } from "@/components/order/jsonld";
import { Storefront } from "@/components/order/Storefront";

/**
 * Site public d’un restaurant — `/r/[slug]`.
 *
 * C’est la vitrine référencée : rendu côté serveur, carte complète dans le HTML,
 * balises Open Graph et données structurées schema.org. Le tunnel de commande
 * s’ouvre par-dessus, sans changement de page.
 *
 * Le domaine personnalisé du restaurant (« maboite.fr ») est réécrit vers cette
 * route par `src/proxy.ts` — l’URL vue par le client reste la sienne.
 */

type Params = { params: Promise<{ slug: string }> };

/** Base publique du site — sert aux URL canoniques et aux images Open Graph. */
function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    "http://localhost:3000"
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const site = await loadSite(slug).catch(() => null);
  if (!site) return { title: "Restaurant introuvable" };

  const city = cityOf(site.tenant.address);
  const title = city
    ? `${site.tenant.name} — Commander en ligne à ${city}`
    : `${site.tenant.name} — Commander en ligne`;
  const cheapest = site.categories
    .flatMap((c) => c.products)
    .filter((p) => !p.outOfStock && p.fromPrice > 0)
    .reduce((min, p) => Math.min(min, p.fromPrice), Number.POSITIVE_INFINITY);
  const from = Number.isFinite(cheapest) ? ` Dès ${euros(cheapest)}.` : "";
  const description =
    `Click & collect chez ${site.tenant.name}${city ? ` à ${city}` : ""} : ` +
    `commandez en ligne, récupérez sur place à l’heure choisie. Sans compte.${from}`;

  const url = `${siteOrigin()}/r/${site.tenant.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: site.tenant.name,
      title,
      description,
      url,
      locale: "fr_FR",
      ...(site.tenant.logoUrl ? { images: [site.tenant.logoUrl] } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

/**
 * La barre du navigateur mobile prend la couleur du MASQUE, pas notre noir.
 *
 * `/embed/[slug]` le faisait déjà ; la VITRINE référencée — celle qu'on
 * partage et qu'on épingle — ne le faisait pas. Chrome Android peignait donc
 * son chrome avec la couleur du thème par défaut au-dessus d'une carte crème.
 * `colorScheme` fait suivre l'ascenseur du document et les contrôles natifs
 * dès la première image, avant même la peinture de la racine cliente.
 *
 * L'appel à `loadSite` traverse le cache de requête de Next — c'est le même
 * `fetch` mémorisé que sert déjà `generateMetadata`. Un restaurant introuvable
 * ne pose aucune couleur : `notFound()` tranchera dans la page.
 */
export async function generateViewport({ params }: Params): Promise<Viewport> {
  const { slug } = await params;
  const site = await loadSite(slug).catch(() => null);
  return {
    width: "device-width",
    initialScale: 1,
    ...(site
      ? {
          themeColor: site.tenant.brand.palette.ground,
          colorScheme: site.tenant.brand.mode,
        }
      : {}),
  };
}

export default async function RestaurantPage({ params }: Params) {
  const { slug } = await params;

  let site;
  try {
    site = await loadSite(slug);
  } catch (err) {
    // 404 côté API = restaurant inconnu ; toute autre panne remonte à error.tsx.
    if (err instanceof PublicApiError && err.status === 404) notFound();
    throw err;
  }
  if (!site) notFound();

  const jsonLd = serializeJsonLd(
    restaurantJsonLd(site, `${siteOrigin()}/r/${site.tenant.slug}`),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <Storefront site={site} mode="site" />
    </>
  );
}
