import { platformManifest } from "@/lib/platform-manifest";

// Même contenu statique que l'ancienne convention, sans injection de lien
// implicite dans les pages restaurant. Le proxy garde sa frontière de domaine.
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(platformManifest()), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
