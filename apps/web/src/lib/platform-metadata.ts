import type { Metadata } from "next";

/**
 * Métadonnées de la plateforme, explicitement remplaçables par les enfants.
 * Les fichiers restent aux mêmes URL publiques et leurs octets sont inchangés.
 * Ne pas recréer app/favicon.ico : Next l'ajoute même aux metadata restaurant
 * qui redéfinissent icons. Les assets public/ sont revalidés (max-age=0), sans
 * les suffixes de hash que généraient les anciennes conventions de fichiers.
 */
export const platformMetadata: Metadata = {
  title: "Snack Manager",
  description: "La suite qui fait tourner votre snack — caisse, cuisine, commande en ligne.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
