import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { loadSite, PublicApiError } from "@/components/order/api";
import { Storefront } from "@/components/order/Storefront";

/**
 * Tunnel embarquable — `/embed/[slug]`.
 *
 * Exactement le même parcours que `/r/[slug]`, sans en-tête de vitrine ni pied
 * de page : cette route est faite pour vivre dans une iframe sur le site du
 * restaurant (chargée par `public/w.js`).
 *
 * Intégration côté hôte :
 *   <iframe src="https://…/embed/classfood" style="width:100%;border:0"></iframe>
 * ou, plus simplement, le widget flottant :
 *   <script src="https://…/w.js" data-tenant="classfood" defer></script>
 *
 * L’embed dialogue avec son hôte par `postMessage` :
 *   { source:"snackmanager", type:"ready" }
 *   { source:"snackmanager", type:"resize", height:<px> }
 *   { source:"snackmanager", type:"close" }
 *
 * Cette route n’est pas indexée : c’est `/r/[slug]` qui porte le référencement,
 * et deux pages au même contenu se cannibaliseraient.
 */

type Params = {
  params: Promise<{ slug: string }>;
  /** `?close=1` : affiche une croix dans l’en-tête (iframe posée à la main). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "Commander en ligne",
  robots: { index: false, follow: false },
};

/**
 * Le `themeColor` suit le MASQUE du restaurant, pas notre noir.
 *
 * Il était écrit `#000000` : sur iOS, la barre d'état de l'hôte se peignait
 * en noir au-dessus d'un tunnel crème, et l'intégration se voyait. Le fond du
 * masque (`brand.palette.ground`) est exactement ce que peint la page.
 *
 * Le site est rechargé ici — comme le fait déjà `generateMetadata` de
 * `/r/[slug]` : l'appel traverse le cache de requête de Next, et un tunnel
 * introuvable retombe simplement sur le noir plutôt que d'échouer au rendu.
 */
export async function generateViewport({ params }: Params): Promise<Viewport> {
  const { slug } = await params;
  const site = await loadSite(slug).catch(() => null);
  return {
    width: "device-width",
    initialScale: 1,
    // L’iframe est déjà contrainte par l’hôte : pas de zoom parasite au tap.
    maximumScale: 5,
    themeColor: site?.tenant.brand.palette.ground ?? "#000000",
  };
}

export default async function EmbedPage({ params, searchParams }: Params) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  let site;
  try {
    site = await loadSite(slug);
  } catch (err) {
    if (err instanceof PublicApiError && err.status === 404) notFound();
    throw err;
  }
  if (!site) notFound();

  return (
    <Storefront site={site} mode="embed" showClose={query.close === "1"} />
  );
}
