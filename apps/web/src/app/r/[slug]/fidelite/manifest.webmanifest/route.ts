import { logoPour } from "@sm/contracts";
import { loadPublicLoyalty } from "@/components/loyalty/public-api";

/**
 * Le type MIME d'une icône, DÉDUIT de son extension.
 *
 * Le manifeste déclarait tout logo comme `image/png` en `512x512` : un SVG y
 * était annoncé raster, et un logo de 300 px annoncé 512. Android refuse
 * l'icône dont le type déclaré ne correspond pas au fichier servi — le client
 * installait la carte du restaurant et retrouvait une pastille grise.
 *
 * Une extension inconnue (une URL signée sans suffixe, par exemple) est
 * traitée en PNG : c'est le format que produit notre chaîne de dépôt, et le
 * pire cas reste une icône que le système redimensionne lui-même.
 */
function iconeDe(src: string): { src: string; sizes: string; type: string; purpose: string } {
  const chemin = src.split("?")[0] ?? src;
  const ext = /\.([a-z0-9]+)$/i.exec(chemin)?.[1]?.toLowerCase();
  if (ext === "svg") return { src, sizes: "any", type: "image/svg+xml", purpose: "any" };
  const type =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return { src, sizes: "512x512", type, purpose: "any" };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });
  const path = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
  // L'installation prend le masque du restaurant, pas la marque grise de Snack Manager.
  const brand = catalog.restaurant.brand;
  const ground = brand.palette.ground;
  const logo = logoPour(brand, "mark");
  /*
   * L'ICÔNE GÉNÉRÉE EST TOUJOURS LÀ, en seconde entrée `any maskable`.
   *
   * Elle ne remplaçait le logo qu'en son ABSENCE — un restaurant qui posait
   * son logo perdait donc la seule icône masquable du manifeste, et Android
   * rognait son carré dans un cercle, coupant l'enseigne. Le logo garde la
   * première place (c'est lui qu'on veut voir), l'icône générée assure le
   * gabarit masquable derrière lui.
   */
  const genere = {
    src: `${path}/icon.svg`,
    sizes: "any",
    type: "image/svg+xml",
    purpose: "any maskable",
  };
  return Response.json(
    {
      id: path,
      name: `${catalog.restaurant.name} · Fidélité`,
      short_name: catalog.restaurant.name.slice(0, 30),
      description: `Carte et récompenses fidélité ${catalog.restaurant.name}.`,
      lang: "fr",
      dir: "ltr",
      start_url: path,
      scope: path,
      display: "standalone",
      background_color: ground,
      theme_color: ground,
      icons: logo ? [iconeDe(logo), genere] : [genere],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
