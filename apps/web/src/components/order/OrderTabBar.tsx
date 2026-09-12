"use client";

import { useRouter } from "next/navigation";
import type { BrandMode } from "@sm/contracts";
import { customerAppDestinations, customerAppPath, type CustomerAppView } from "@sm/client-core";
import { Icon } from "@/components/ui";
import { SMTabBar } from "@/components/ui/SMTabBar";

export function OrderTabBar({ slug, activeKey, panelId, theme, loyaltyHref, onSelect, hidden = false, minimizable = true, demo = false, disabled = false, orderingAvailable = true, accountEnabled = true }: {
  slug: string; activeKey: string; panelId: string; theme: BrandMode; loyaltyHref?: string | null;
  onSelect?: (key: string) => void; hidden?: boolean; minimizable?: boolean; demo?: boolean; disabled?: boolean;
  orderingAvailable?: boolean; accountEnabled?: boolean;
}) {
  const router = useRouter();
  function select(key: string) {
    if (disabled) return;
    // The explicit demo has its own volatile loyalty fixture route.
    if (demo && key === "loyalty" && loyaltyHref) { router.push(loyaltyHref); return; }
    if (onSelect) { onSelect(key); return; }
    if (key === "loyalty" && loyaltyHref) { router.push(loyaltyHref); return; }
    const base = `/r/${encodeURIComponent(slug)}`;
    router.push(demo ? `${base}?demo=1${key === "menu" ? "" : `&vue=${key}`}`
      : customerAppPath(slug, key as CustomerAppView));
  }
  return <SMTabBar activeKey={activeKey} theme={theme} hidden={hidden} disabled={disabled} minimizable={minimizable} onSelect={select}
    items={customerAppDestinations({ ordering: orderingAvailable, loyalty: !!loyaltyHref, account: accountEnabled && !demo })
      .map(item => ({ key: item.key, label: item.label, panelId, icon: color => <Icon
        name={item.key === "menu" ? "grid" : item.key === "search" ? "search" : item.key === "orders" ? "ticket" : item.key === "loyalty" ? "gift" : "user"}
        size={24} style={{ color }} /> }))} />;
}
