import { BrandSchema, logoPour } from "@sm/contracts";
import { z } from "zod";
import { API_URL } from "@/components/order/api";
import { dessinerIconeLogo } from "@/components/loyalty/icone-carte";
import { logoIncorpore } from "@/components/loyalty/logo-incorpore";
import { isRestaurantSlug } from "@/lib/restaurant-metadata";

const PublicBrand = z.object({ slug: z.string(), brand: BrandSchema });
const unavailable = (status: number) => new Response(null, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

/** Icône publique de l'enseigne, sans dépendance au catalogue ni à la fidélité.
 * Le cache est court pour refléter un changement de marque. Ni les pannes de
 * fiche ni un logo temporairement indisponible ne figent un repli en cache.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isRestaurantSlug(slug)) return unavailable(404);

  let tenant;
  try {
    const response = await fetch(`${API_URL}/public/tenants/${slug}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return unavailable(response.status === 404 ? 404 : 503);
    const parsed = PublicBrand.safeParse(await response.json());
    if (!parsed.success || parsed.data.slug !== slug) return unavailable(503);
    tenant = parsed.data;
  } catch {
    return unavailable(503);
  }

  const brand = tenant.brand;
  const logo = logoPour(brand, "mark");
  const embedded = logo ? await logoIncorpore(logo) : null;
  const composed = embedded ? dessinerIconeLogo(brand, embedded) : null;
  // Sac de commande simple, sans texte/nom injecté : seuls des hex validés
  // par BrandSchema sont interpolés. Le vrai logo est toujours prioritaire.
  const svg = composed ?? (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<rect width="512" height="512" rx="96" fill="${brand.palette.ground}"/>` +
    `<path d="M144 200h224l24 224H120z" fill="${brand.palette.accent}"/>` +
    `<path d="M200 216v-64a56 56 0 0 1 112 0v64" fill="none" stroke="${brand.palette.onAccent}" stroke-width="24" stroke-linecap="round"/>` +
    `</svg>`
  );
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": logo && !composed ? "no-store" : "public, max-age=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; sandbox",
    },
  });
}
