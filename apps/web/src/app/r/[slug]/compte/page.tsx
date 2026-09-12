import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Storefront } from "@/components/order/Storefront";
import { resumeFidelite } from "@/components/order/fidelite";
import { LoyaltyCardApp } from "@/components/loyalty/LoyaltyCardApp";
import { customerSurface, loadCustomerPublicSurfaces } from "@/components/customer-account/customer-public-surfaces";

type Props = { params: Promise<{ slug: string }> };
export const metadata: Metadata = { title: "Mon compte", robots: { index: false, follow: false } };
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const { site, catalog } = await loadCustomerPublicSurfaces(slug);
  const brand = site.state === 'available' ? site.value.tenant.brand : catalog.state === 'available' ? catalog.value.restaurant.brand : undefined;
  return { width: "device-width", initialScale: 1, viewportFit: "cover",
    ...(brand ? { themeColor: brand.palette.ground, colorScheme: brand.mode } : {}) };
}

/** Public shell only: the protected session is read by the account controller
 * on the client. A service outage never masquerades as a different offer. */
export default async function AccountCustomerPage({ params }: Props) {
  const { slug } = await params;
  const surface = customerSurface(await loadCustomerPublicSurfaces(slug));
  if (surface.kind === 'storefront') return <Storefront site={surface.site} loyalty={resumeFidelite(surface.catalog ?? null)}
    loyaltyCatalog={surface.catalog} unavailableService={surface.unavailableService} />;
  if (surface.kind === 'loyalty') return <LoyaltyCardApp catalog={surface.catalog} orderingAvailable={false} initialView="account"
    unavailableService={surface.unavailableService} />;
  notFound();
}
