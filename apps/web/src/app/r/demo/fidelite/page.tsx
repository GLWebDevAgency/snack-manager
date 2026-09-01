import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoLoyaltyCard } from "@/components/loyalty/DemoLoyaltyCard";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "Carte fidélité — démonstration Snack Manager",
  description: "Démonstration fictive de l'application de fidélité Snack Manager.",
  robots: { index: false, follow: false },
};

export default async function DemoLoyaltyPage({ searchParams }: Props) {
  const query = await searchParams;
  if (query.demo !== "1") notFound();
  return <DemoLoyaltyCard />;
}
