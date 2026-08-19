import type { Metadata, Viewport } from "next";
import { ADLaM_Display } from "next/font/google";
import "@/components/marketing/marketing.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://snackmanager.fr";

const TITLE = "Snack Manager — On fait tourner votre restaurant. Pas l'inverse.";
const DESCRIPTION =
  "Caisse, cuisine, commande en ligne et back-office pour snacks indépendants. À vos couleurs, sans engagement, lancement accompagné — jusqu'à 1 à 2 postes économisés par mois.";

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
  return <div className={`mk ${adlam.variable}`}>{children}</div>;
}
