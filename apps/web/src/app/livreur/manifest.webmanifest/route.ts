import type { MetadataRoute } from "next";

/** An application of its own, never the restaurant storefront or the platform home. */
export function GET() {
  const manifest: MetadataRoute.Manifest = {
    id: "/livreur",
    name: "SM Livreur",
    short_name: "SM Livreur",
    description: "Votre restaurant, vos missions et vos remises depuis votre téléphone.",
    lang: "fr",
    dir: "ltr",
    start_url: "/livreur",
    scope: "/livreur",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, { headers: {
    "Content-Type": "application/manifest+json",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  } });
}
