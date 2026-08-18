import type { Metadata, Viewport } from "next";
import "@/components/marketing/marketing.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://snackmanager.fr";

const TITLE = "Snack Manager — On fait tourner votre restaurant. Pas l'inverse.";
const DESCRIPTION =
  "Caisse, cuisine, commande en ligne et back-office pour snacks indépendants. 0 % de commission, à vos couleurs, sans engagement — jusqu'à 1 à 2 postes économisés par mois.";

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
    "commande en ligne sans commission",
    "logiciel snack halal",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "Snack Manager",
    title: "Snack Manager — le système d'exploitation des snacks indépendants",
    description:
      "Caisse, cuisine, commande en ligne et back-office réunis. 0 % de commission, marque blanche, lancement accompagné.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Snack Manager — On fait tourner votre restaurant. Pas l'inverse.",
    description: "Caisse, cuisine, commande en ligne et back-office pour snacks indépendants. 0 % de commission.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

/**
 * Groupe de routes marketing : porte les métadonnées publiques et la feuille de
 * style « SM Brass ». L'accent y est le laiton de marque #c9a15a — jamais
 * l'accent d'un tenant, qui n'est injecté que sous /admin.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="mk">{children}</div>;
}
