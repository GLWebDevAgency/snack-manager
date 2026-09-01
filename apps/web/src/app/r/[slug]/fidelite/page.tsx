import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoyaltyCardApp } from "@/components/loyalty/LoyaltyCardApp";
import { LoyaltyPublicApiError, loadPublicLoyalty } from "@/components/loyalty/public-api";

type Props = { params: Promise<{ slug: string }> };

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return { title: "Programme fidélité indisponible", robots: { index: false } };
  const title = `${catalog.program.name} — ${catalog.restaurant.name}`;
  const description = `Consultez votre solde et les récompenses du programme fidélité ${catalog.restaurant.name}.`;
  return {
    title,
    description,
    alternates: { canonical: `${siteOrigin()}/r/${catalog.restaurant.slug}/fidelite` },
    manifest: `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite/manifest.webmanifest`,
    icons: { icon: `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite/icon.svg` },
    appleWebApp: { capable: true, title: catalog.restaurant.name, statusBarStyle: "black-translucent" },
    openGraph: { title, description, type: "website", locale: "fr_FR" },
  };
}

export default async function LoyaltyCustomerPage({ params }: Props) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch((cause: unknown) => {
    if (cause instanceof LoyaltyPublicApiError && cause.status === 404) notFound();
    throw cause;
  });
  return <LoyaltyCardApp catalog={catalog} />;
}
