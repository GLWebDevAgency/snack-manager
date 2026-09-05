import type { Metadata } from "next";
import { CommerceOffers } from "@/components/marketing/CommerceOffers";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { MODULE_MONTHLY_CENTS } from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { lireReseaux } from "@/lib/reseaux";
import { COMMANDE_SECTIONS } from "./content";
import { CommandeBody } from "./sections";

/**
 * Page Commande en ligne — route `/commande-en-ligne`, troisième page par
 * application, sur le modèle de `/caisse` (voir son `page.tsx` pour les
 * arbitrages communs).
 */

const COMMANDE_PATH = "/commande-en-ligne";

const PRIX_MODULE = `${MODULE_MONTHLY_CENTS / 100} €/mois`;

export const metadata: Metadata = {
  title: "Commande en ligne sans commission — Snack Manager",
  description: `Le click & collect à vos couleurs, avec back-office et pilote fidélité accompagné inclus, même sans notre caisse. ${PRIX_MODULE} HT, compris dans Boost. Livraison restaurant en validation pilote.`,
  keywords: [
    "click and collect restaurant sans commission",
    "commande en ligne snack",
    "click and collect kebab",
    "site de commande restaurant indépendant",
    "fidélité restaurant en ligne",
  ],
  alternates: { canonical: COMMANDE_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: COMMANDE_PATH,
    siteName: "Snack Manager",
    title: "Commande en ligne sans commission — Snack Manager",
    description: `Vos clients commandent chez vous, au prix de la carte. ${PRIX_MODULE}, compris dans Boost.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Commande en ligne sans commission — Snack Manager",
    description: "Le click & collect à vos couleurs : commande, créneau, cuisine — zéro commission.",
  },
  robots: { index: true, follow: true },
};

export default async function CommandePage() {
  const reseaux = await lireReseaux();

  return (
    <>
      <a href={`#${COMMANDE_SECTIONS[0].id}`} className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <CommandeBody />
        <CommerceOffers />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }} />
    </>
  );
}

/** Fil d'Ariane seul — même retenue que les deux autres pages par
 *  application : le produit, sa FAQ et le catalogue sont déclarés ailleurs. */
function structuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
      { "@type": "ListItem", position: 2, name: "La commande en ligne", item: urlAbsolue(COMMANDE_PATH) },
    ],
  };
}
