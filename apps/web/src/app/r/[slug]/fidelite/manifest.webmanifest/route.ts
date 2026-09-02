import { logoPour } from "@sm/contracts";
import { loadPublicLoyalty } from "@/components/loyalty/public-api";

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
      icons: logo
        ? [{ src: logo, sizes: "512x512", type: "image/png", purpose: "any" }]
        : [
            {
              src: `${path}/icon.svg`,
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
