import type { Metadata, Viewport } from "next";
import { ADLaM_Display } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "@/components/marketing/marketing.css";
import { SplashAuPremierPassage } from "@/components/brand/SplashAuPremierPassage";
import { RemonterAuChangementDePage } from "@/components/marketing/RemonterAuChangementDePage";

const TITLE = "Snack Manager — Logiciels, menus et visibilité pour restaurants";
const DESCRIPTION = "Caisse, commande directe, menus papier et TV, site internet et visibilité Google : des solutions pour votre restaurant, avec ou sans nos logiciels.";

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
    "logiciel caisse restaurant",
    "logiciel restaurant",
    "caisse tactile restaurant indépendant",
    "KDS cuisine",
    "click and collect restaurant",
    "commande en ligne restaurant",
    "menus papier et TV restaurant",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "Snack Manager",
    title: "Snack Manager — Gérez votre restaurant. Faites vivre votre carte.",
    description: "Logiciels pour le service, menus papier et TV, site internet et visibilité locale. Un accompagnement disponible avec ou sans nos logiciels.",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "Logiciels et accompagnement pour les restaurateurs indépendants.",
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
