"use client";

import { useRouter } from "next/navigation";
import type { BrandMode } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { SMTabBar } from "@/components/ui/SMTabBar";

export function OrderTabBar({ slug, activeKey, panelId, theme, loyaltyHref, onSelect, hidden = false, minimizable = true, demo = false, disabled = false }: {
  slug: string; activeKey: string; panelId: string; theme: BrandMode; loyaltyHref?: string | null;
  onSelect?: (key: string) => void; hidden?: boolean; minimizable?: boolean; demo?: boolean; disabled?: boolean;
}) {
  const router = useRouter();
  function select(key: string) {
    if (disabled) return;
    if (onSelect && key !== "loyalty") { onSelect(key); return; }
    if (key === "loyalty" && loyaltyHref) { router.push(loyaltyHref); return; }
    const base = `/r/${encodeURIComponent(slug)}`;
    router.push(demo ? `${base}?demo=1${key === "menu" ? "" : `&vue=${key}`}`
      : `${base}${key === "search" ? "/recherche" : key === "orders" ? "/commandes" : "/carte"}`);
  }
  return <SMTabBar activeKey={activeKey} theme={theme} hidden={hidden} disabled={disabled} minimizable={minimizable} onSelect={select}
    items={[
      { key: "menu", label: "Carte", panelId, icon: color => <Icon name="grid" size={24} style={{ color }} /> },
      { key: "search", label: "Rechercher", panelId, icon: color => <Icon name="search" size={24} style={{ color }} /> },
      { key: "orders", label: "Commandes", panelId, icon: color => <Icon name="ticket" size={24} style={{ color }} /> },
      ...(loyaltyHref ? [{ key: "loyalty", label: "Fidélité", panelId, icon: (color: string) => <Icon name="gift" size={24} style={{ color }} /> }] : []),
    ]} />;
}
