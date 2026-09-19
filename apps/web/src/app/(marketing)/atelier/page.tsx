import type { Metadata } from "next";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { euros } from "@/components/marketing/content";
import { MENUS_OFFERS } from "@/components/marketing/menu-offers";
import { urlAbsolue } from "@/lib/site";
import { lireReseaux } from "@/lib/reseaux";
import { ATELIER_SECTIONS } from "./content";
import { AtelierBody } from "./sections";

/**
 * Page Atelier — route `/atelier`, les services d'agence, sur le modèle de
 * `/caisse` (voir son `page.tsx` pour les arbitrages communs : en-tête et
 * pied de page rendus ici, lien d'évitement en premier dans l'ordre de
 * tabulation).
 */

const ATELIER_PATH = "/atelier";

/**
 * Les deux montants cités chez Google sont DÉRIVÉS de la grille — la leçon du
 * 21/08/2026 : une révision de tarifs ne peut pas laisser ce fichier annoncer
 * l'ancien montant.
 */
const PRIX_MENU = euros(MENUS_OFFERS[0].priceCents);

export const metadata: Metadata = {
  title: "Menus papier, menus TV et communication restaurant — Snack Manager",
  description: `Création de menus papier et TV dès ${PRIX_MENU} HT. Retouches, analyse de carte, identité, site et présence en ligne. Prestations définies au devis ; impression et livraison distinctes.`,
  keywords: [
    "création menu restaurant",
    "menu papier trois volets",
    "menu TV restaurant",
    "agence communication restaurant",
    "gestion fiche google restaurant",
    "réseaux sociaux restaurant",
  ],
  alternates: { canonical: ATELIER_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: ATELIER_PATH,
    siteName: "Snack Manager",
    title: "Votre carte, sur papier et sur écran — L’Atelier Snack Manager",
    description: `Menus papier et TV dès ${PRIX_MENU} HT, créations et mises à jour ponctuelles. Impression, livraison et matériel distincts.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Menus papier, TV et communication — Snack Manager",
    description: "Une carte adaptée à votre restaurant, des prestations définies et un prix expliqué avant le travail.",
  },
  robots: { index: true, follow: true },
};

export default async function AtelierPage() {
  // Les réseaux sont lus ici plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. API muette → rangée absente, page affichée quand même.
  const reseaux = await lireReseaux();

  return (
    <>
      <a href={`#${ATELIER_SECTIONS[0].id}`} className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <AtelierBody />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }} />
    </>
  );
}

/**
 * Fil d'Ariane seul — même retenue que les pages par application : le produit,
 * sa FAQ et le catalogue d'offres sont déclarés ailleurs, et un second
 * catalogue déclaré ici demanderait à Google de choisir la mauvaise page.
 */
function structuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
      { "@type": "ListItem", position: 2, name: "L’Atelier", item: urlAbsolue(ATELIER_PATH) },
    ],
  };
}
