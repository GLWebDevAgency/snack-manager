import { loadPublicLoyalty } from "@/components/loyalty/public-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });
  const path = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
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
      background_color: "#000000",
      theme_color: /^#[0-9a-f]{6}$/i.test(catalog.restaurant.brandColor)
        ? catalog.restaurant.brandColor
        : "#000000",
      icons: [
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
