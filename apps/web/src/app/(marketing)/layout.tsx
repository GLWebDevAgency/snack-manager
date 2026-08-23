import type { Metadata, Viewport } from "next";
import { ADLaM_Display } from "next/font/google";
import { PRICE_RANGE } from "@/components/marketing/content";
import { SITE_URL } from "@/lib/site";
import "@/components/marketing/marketing.css";
import { SplashAuPremierPassage } from "@/components/brand/SplashAuPremierPassage";
import { RemonterAuChangementDePage } from "@/components/marketing/RemonterAuChangementDePage";

const TITLE = "Snack Manager — Plus de commandes, moins de galère, zéro commission";
/**
 * LA DESCRIPTION EST DU TEXTE AFFICHÉ, ET ELLE OBÉIT AUX MÊMES RÈGLES QUE LA
 * PAGE — c'est elle que Google met sous le lien et que les messageries collent
 * dans l'aperçu.
 *
 * Elle portait deux énoncés que la refonte a chassés du corps de la page et
 * qui avaient survécu ici. « Jusqu'à 1 à 2 postes économisés par mois » est un
 * chiffre de RÉSULTAT alors que nous n'avons qu'un restaurant pilote : c'est
 * la phrase d'`Intro.tsx` (« parfois deux ») que le plan a fait tomber parce
 * qu'aucun calcul ne la produit, et le simulateur dit désormais « on vous rend
 * les heures », jamais « on enlève un poste ». Et « sans engagement » servi
 * seul est exactement la contradiction que le fondateur a tranchée : la clause
 * ne s'écrit qu'en entier (`ENGAGEMENT`, content.ts), forfait de mise en route
 * compris, ou elle ne s'écrit pas — un aperçu de 160 signes ne peut pas la
 * porter en entier, donc il ne la porte pas du tout.
 *
 * Ne restent que des affirmations vérifiables au premier écran : les quatre
 * applications, le zéro commission de la section 6, la personnalisation
 * annoncée par le hero, l'accompagnement daté de la section 8 et les trois
 * tarifs affichés.
 *
 * LES TROIS TARIFS NE SONT PLUS RECOPIÉS ICI. Ce fichier vit hors de
 * `components/marketing/`, donc une révision de grille menée dans `content.ts`
 * le laissait intact : le résultat Google a annoncé l'ancienne grille pendant
 * que la page affichait la nouvelle — un prix périmé lisible sans même ouvrir
 * le site. La fourchette est désormais dérivée (`PRICE_RANGE`, content.ts).
 */
const DESCRIPTION = `Caisse, cuisine, commande en ligne et back-office pour snacks indépendants. Zéro commission, à vos couleurs, lancement accompagné. ${PRICE_RANGE}.`;

/**
 * Le logotype « Snack Manager » de la maquette est composé en ADLaM Display.
 * Chargée ici (et pas dans le layout racine) : la police ne concerne que la
 * vitrine, pas la caisse ni le back-office.
 */
const adlam = ADLaM_Display({
  variable: "--font-adlam",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Snack Manager",
  keywords: [
    "logiciel caisse snack",
    "logiciel restaurant",
    "caisse tactile fast-food",
    "KDS cuisine",
    "click and collect restaurant",
    "commande en ligne restaurant",
    "logiciel snack halal",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "Snack Manager",
    title: "Snack Manager — le système d'exploitation des snacks indépendants",
    description: "Caisse, cuisine, commande en ligne et back-office réunis. À vos couleurs, lancement accompagné.",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "Caisse, cuisine, commande en ligne et back-office pour snacks indépendants.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

/**
 * Groupe de routes marketing : porte les métadonnées publiques et la feuille
 * de style portée de la maquette. L'accent y est le laiton de marque #c9a15a
 * — jamais l'accent d'un tenant, qui n'est injecté que sous /admin.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mk ${adlam.variable}`}>
      {/*
        L'ÉCRAN D'OUVERTURE — POSÉ ICI, DONC SUR LES QUATRE ROUTES PUBLIQUES.

        `toujours` : il se rejoue À CHAQUE CHARGEMENT DE PAGE. J'avais d'abord
        posé « une fois par session », pour ne pas l'imposer au visiteur qui
        navigue. C'était le mauvais arbitrage : sur un rechargement, l'animation
        semblait avoir disparu, et une ouverture qu'on ne peut pas revoir n'est
        pas une ouverture.

        Ce que `toujours` ne fait PAS, et c'est ce qui rend le choix tenable :
        la navigation interne (`next/link`) ne remonte pas ce layout. Passer de
        la landing aux tarifs puis au blog ne le rejoue donc pas — seuls un
        rechargement ou une arrivée directe le déclenchent. C'est exactement la
        frontière qu'on veut.

        Il ne bloque rien : la page est rendue dessous, ce n'est qu'un calque
        qui s'efface. Voir `SplashAuPremierPassage` pour les trois gardes.
      */}
      <SplashAuPremierPassage duree={3.6} toujours />
      {/*
        Remonte en haut au changement de route. Sans lui, cliquer sur « Offres »
        depuis la landing déposait le visiteur au BAS de la page — le
        `scroll-behavior: smooth` des ancres s'appliquant aussi au
        repositionnement que Next opère à chaque navigation. Voir le fichier,
        qui documente la cause et l'expérience qui l'a isolée.
      */}
      <RemonterAuChangementDePage />
      {children}
    </div>
  );
}
