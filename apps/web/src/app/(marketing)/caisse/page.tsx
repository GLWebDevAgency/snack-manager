import type { Metadata } from "next";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { PLAN_MONTHLY_CENTS } from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { lireReseaux } from "@/lib/reseaux";
import { CAISSE_SECTIONS } from "./content";
import { CaisseBody } from "./sections";

/**
 * Page Caisse — route `/caisse`, la première page PAR APPLICATION.
 *
 * La landing convainc, `/offres` détaille les prix ; cette page répond à une
 * INTENTION DE RECHERCHE — « logiciel caisse snack », « caisse fast-food sans
 * commission » — et détaille une seule application pour qui veut vérifier.
 * Les pages « écran cuisine » et « commande en ligne » se construiront sur ce
 * modèle : mêmes trois fichiers, même registre, mêmes règles.
 *
 * L'en-tête, le pied de page et le lien d'évitement sont rendus ICI et pas
 * dans le layout — même arbitrage que `/offres` : un `.mk-skip` remonté dans
 * le layout passerait derrière les liens de l'en-tête dans l'ordre de
 * tabulation, et n'éviterait plus rien.
 */

const CAISSE_PATH = "/caisse";

/**
 * Métadonnées : mêmes règles que la page — aucun chiffre de résultat, jamais
 * « sans engagement » servi seul. Le prix est DÉRIVÉ de la grille : une
 * révision de tarifs ne peut pas laisser ce fichier annoncer l'ancien montant
 * (la leçon du 21/08/2026, apprise sur la description de la landing).
 */
const PRIX_ENTREE = `${PLAN_MONTHLY_CENTS.essentiel / 100} €/mois`;

export const metadata: Metadata = {
  title: "Logiciel de caisse pour snack — Snack Manager",
  description: `La caisse des snacks et fast-foods indépendants : commande, envoi cuisine, encaissement — espèces, carte, titre-restaurant. Fonctionne sans internet. Dès ${PRIX_ENTREE}, zéro commission.`,
  keywords: [
    "logiciel caisse snack",
    "caisse enregistreuse fast-food",
    "caisse kebab",
    "logiciel caisse sans commission",
    "caisse tactile restaurant tablette",
  ],
  alternates: { canonical: CAISSE_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: CAISSE_PATH,
    siteName: "Snack Manager",
    title: "Logiciel de caisse pour snack — Snack Manager",
    description: `Commande, cuisine, encaissement — même sans internet. Dès ${PRIX_ENTREE}, zéro commission.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Logiciel de caisse pour snack — Snack Manager",
    description: "La caisse qui tient le rush : commande, cuisine, encaissement, même sans internet.",
  },
  robots: { index: true, follow: true },
};

export default async function CaissePage() {
  // Les réseaux sont lus ici plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. API muette → rangée absente, page affichée quand même.
  const reseaux = await lireReseaux();

  return (
    <>
      <a href={`#${CAISSE_SECTIONS[0].id}`} className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <CaisseBody />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }} />
    </>
  );
}

/**
 * ═══ DONNÉES STRUCTURÉES — LA MÊME RETENUE QU'`/offres` ═══
 *
 * La landing publie déjà LE `SoftwareApplication` et sa `FAQPage` ; `/offres`
 * publie l'`OfferCatalog`. Republier ici un produit homonyme à une troisième
 * URL, c'est demander à Google de choisir la mauvaise page. Cette route ne
 * déclare donc que sa seule information propre : elle est une page fille de
 * l'accueil.
 */
function structuredData(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
      { "@type": "ListItem", position: 2, name: "La caisse", item: urlAbsolue(CAISSE_PATH) },
    ],
  };
}
