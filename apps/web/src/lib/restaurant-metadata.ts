import type { Metadata } from "next";

/** Aucun logo plateforme sur une surface publique dont l'enseigne est inconnue.
 * Une icône embarquée évite aussi le GET implicite /favicon.ico du navigateur.
 */
const neutralIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171717"/><path d="M17 24h30l3 29H14z M24 24v-7a8 8 0 0 1 16 0v7" fill="none" stroke="#fafafa" stroke-width="4" stroke-linejoin="round"/></svg>')}`;

export const publicRestaurantMetadata: Metadata = {
  // Next peut utiliser le layout seul pour une 404 : neutraliser aussi le
  // titre/texte commercial, pas uniquement les liens de fichiers.
  title: "Restaurant",
  description: null,
  manifest: null,
  appleWebApp: null,
  icons: {
    icon: [{ url: neutralIcon, type: "image/svg+xml", sizes: "any" }],
    apple: [],
    shortcut: [],
  },
};

/** Même alphabet que la résolution de domaines ; jamais de chemin/jeton ici. */
export function isRestaurantSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(value);
}

export function restaurantMetadata(slug: unknown): Metadata {
  if (!isRestaurantSlug(slug)) return publicRestaurantMetadata;
  return {
    ...publicRestaurantMetadata,
    icons: {
      icon: [{ url: `/r/${slug}/icon.svg`, type: "image/svg+xml", sizes: "any" }],
      apple: [],
      shortcut: [],
    },
  };
}
