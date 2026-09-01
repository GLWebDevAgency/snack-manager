import { loadPublicLoyalty } from "@/components/loyalty/public-api";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });
  const accent = /^#[0-9a-f]{6}$/i.test(catalog.restaurant.brandColor)
    ? catalog.restaurant.brandColor
    : "#c9a15a";
  const initial = escapeXml(catalog.restaurant.name.trim().charAt(0).toUpperCase() || "R");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#090909"/><circle cx="256" cy="256" r="174" fill="${accent}"/><text x="256" y="302" text-anchor="middle" font-family="system-ui,sans-serif" font-size="190" font-weight="900" fill="#111">${initial}</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
