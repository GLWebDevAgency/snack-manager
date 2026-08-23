import type { Metadata } from "next";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PLAN_MONTHLY_CENTS } from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { lireReseaux } from "@/lib/reseaux";
import { CUISINE_SECTIONS } from "./content";
import { CuisineBody } from "./sections";

/**
 * Page Écran cuisine — route `/cuisine`, deuxième page par application,
 * construite sur le modèle de `/caisse` (voir son `page.tsx` pour les
 * arbitrages communs : en-tête et pied rendus ici, lien d'évitement,
 * données structurées réduites au fil d'Ariane).
 */

const CUISINE_PATH = "/cuisine";

const PRIX_ENTREE = `${PLAN_MONTHLY_CENTS.essentiel / 100} €/mois`;

export const metadata: Metadata = {
  title: "Écran cuisine (KDS) pour snack — Snack Manager",
  description: `L'écran cuisine des snacks : chaque commande arrive à sa place, avec le son, lisible de loin — et la coupure ne vide pas l'écran. Compris dans toutes les formules, dès ${PRIX_ENTREE}.`,
  keywords: [
    "écran cuisine restaurant",
    "KDS snack",
    "kitchen display system français",
    "écran commande cuisine fast-food",
    "gestion tickets cuisine",
  ],
  alternates: { canonical: CUISINE_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: CUISINE_PATH,
    siteName: "Snack Manager",
    title: "Écran cuisine (KDS) pour snack — Snack Manager",
    description: `Chaque commande à sa place, lisible de loin, même sans internet. Compris dans toutes les formules, dès ${PRIX_ENTREE}.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Écran cuisine (KDS) pour snack — Snack Manager",
    description: "L'écran qui tient la cuisine : une seule file, trois colonnes, le son à l'arrivée.",
  },
  robots: { index: true, follow: true },
};

export default async function CuisinePage() {
  const reseaux = await lireReseaux();

  return (
    <>
      <a href={`#${CUISINE_SECTIONS[0].id}`} className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <CuisineBody />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }} />
    </>
  );
}

/** Fil d'Ariane seul — même retenue que `/caisse` : le produit et sa FAQ
 *  sont déclarés par la landing, le catalogue par `/offres`. */
function structuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
      { "@type": "ListItem", position: 2, name: "L'écran cuisine", item: urlAbsolue(CUISINE_PATH) },
    ],
  };
}
