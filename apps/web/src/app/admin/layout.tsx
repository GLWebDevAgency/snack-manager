"use client";

/**
 * Shell du back-office (spec backoffice-restaurant §3) : sidebar overlay
 * rétractable 66↔232px (ne pousse pas le contenu), topbar, thème tenant.
 * L'accent de marque est injecté au runtime : fetch /tenants/me →
 * --cf-accent / --cf-on-accent sur <html> (marque grise, spec DS §4).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { OrderStatus } from "@sm/contracts";
import { api, ApiError, clearToken, getToken, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtDateFr } from "@/lib/format";
import { useTenantSocket } from "@/lib/ws";
import { IconBtn, Icon, ToastProvider, useToast, type IconName } from "@/components/ui";

const RAIL = 66;
const PANEL = 232;
const NAV_STORE = "sm-bo-nav";

const NAV: { id: string; href: string; label: string; icon: IconName }[] = [
  { id: "dashboard", href: "/admin/dashboard", label: "Tableau de bord", icon: "home" },
  { id: "orders", href: "/admin/orders", label: "Commandes", icon: "ticket" },
  { id: "menu", href: "/admin/menu", label: "Menu & prix", icon: "grid" },
  { id: "ingredients", href: "/admin/ingredients", label: "Ingrédients & stocks", icon: "fries" },
  { id: "promos", href: "/admin/promos", label: "Promos", icon: "tag" },
  { id: "hours", href: "/admin/hours", label: "Horaires", icon: "clock" },
  { id: "stats", href: "/admin/stats", label: "Statistiques", icon: "chart" },
  { id: "team", href: "/admin/team", label: "Équipe & pointage", icon: "user" },
  { id: "reviews", href: "/admin/reviews", label: "Avis clients", icon: "star" },
];

export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <>{children}</>;
  return (
    <ToastProvider>
      <Shell>{children}</Shell>
    </ToastProvider>
  );
}

/** Store minimal pour lire un état navigateur sans mismatch d'hydratation. */
const navSubscribe = (cb: () => void) => {
  window.addEventListener(NAV_STORE, cb);
  return () => window.removeEventListener(NAV_STORE, cb);
};
const emptySubscribe = () => () => {};

function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  const [tenant, setTenant] = useState<TenantMe | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [togglingOnline, setTogglingOnline] = useState(false);

  // ── Session (token localStorage ; null côté serveur) ──
  const hasToken = useSyncExternalStore(
    emptySubscribe,
    () => Boolean(getToken()),
    () => false,
  );

  // ── Sidebar ouverte/fermée — persistée dans localStorage["sm-bo-nav"] ──
  const open = useSyncExternalStore(
    navSubscribe,
    () => localStorage.getItem(NAV_STORE) !== "closed",
    () => true, // défaut : ouverte (spec §3.2)
  );
  const toggleNav = () => {
    localStorage.setItem(NAV_STORE, open ? "closed" : "open");
    window.dispatchEvent(new Event(NAV_STORE));
  };

  // ── Garde session + redirection /admin → /admin/dashboard ──
  // `mounted` évite de rediriger sur le rendu d'hydratation : localStorage
  // n'existe pas côté serveur, donc `hasToken` y vaut toujours false.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!hasToken) router.replace("/admin/login");
    else if (pathname === "/admin") router.replace("/admin/dashboard");
  }, [mounted, hasToken, pathname, router]);

  // ── Tenant + thème (accent marque sur <html>) ──
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    api
      .get<TenantMe>("/tenants/me")
      .then((t) => {
        if (cancelled) return;
        setTenant(t);
        const root = document.documentElement.style;
        root.setProperty("--cf-accent", t.brandColor || "#c9a15a");
        root.setProperty("--cf-on-accent", "#fff");
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/admin/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasToken, router]);

  // ── Badge « Commandes » : nombre de commandes au statut new, live ──
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    api
      .get<{ _id: string }[]>("/orders?status=new")
      .then((orders) => {
        if (!cancelled && Array.isArray(orders))
          setNewIds(new Set(orders.map((o) => o._id)));
      })
      .catch(() => {}); // badge à 0 si l'appel échoue — non bloquant
    return () => {
      cancelled = true;
    };
  }, [hasToken]);

  useTenantSocket({
    "order.created": (payload) => {
      const o = payload as { _id?: string; status?: OrderStatus };
      if (o?._id && (o.status ?? "new") === "new")
        setNewIds((prev) => new Set(prev).add(o._id!));
    },
    "order.updated": (payload) => {
      const o = payload as { _id?: string; status?: OrderStatus };
      if (!o?._id) return;
      setNewIds((prev) => {
        if (o.status === "new" ? prev.has(o._id!) : !prev.has(o._id!))
          return prev;
        const next = new Set(prev);
        if (o.status === "new") next.add(o._id!);
        else next.delete(o._id!);
        return next;
      });
    },
  });
  const newCount = newIds.size;

  // ── Pilule Ouvert/Fermé ↔ settings.onlineOrderingPaused ──
  const paused = tenant?.settings?.onlineOrderingPaused ?? false;
  async function toggleOnline() {
    if (!tenant || togglingOnline) return;
    setTogglingOnline(true);
    const next = !paused;
    try {
      const updated = await api.patch<TenantMe>("/tenants/me/settings", {
        onlineOrderingPaused: next,
      });
      setTenant(
        updated ?? {
          ...tenant,
          settings: { ...tenant.settings, onlineOrderingPaused: next },
        },
      );
      toast(
        next
          ? "Commande en ligne en pause — établissement « Fermé »"
          : "Commande en ligne réactivée — établissement « Ouvert »",
        { icon: "check" },
      );
    } catch {
      toast("Impossible de changer l'état — réessayez");
    } finally {
      setTogglingOnline(false);
    }
  }

  // ── Titre / sous-titre de la topbar ──
  const active = useMemo(
    () => NAV.find((n) => pathname.startsWith(n.href)),
    [pathname],
  );
  const now = new Date();
  const subtitle = `${fmtDateFr(now)} · service du ${now.getHours() < 16 ? "midi" : "soir"}`;

  const initial = (tenant?.name?.trim()?.[0] ?? "S").toUpperCase();
  const city =
    tenant?.address
      ?.split(",")
      .pop()
      ?.trim()
      .replace(/^\d{4,5}\s*/, "") ||
    tenant?.slug ||
    "";

  if (!hasToken) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* ── Sidebar : rail 66px dans le flux, panneau absolu en OVERLAY ── */}
      <div className="relative z-[45] shrink-0" style={{ width: RAIL }}>
        <aside
          className="absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-line bg-fill px-3 py-[18px]"
          style={{
            width: open ? PANEL : RAIL,
            transition:
              "width .28s var(--sm-ease), box-shadow .28s var(--sm-ease)",
            boxShadow: open ? "18px 0 44px rgba(0,0,0,0.45)" : "none",
          }}
        >
          {/* En-tête : logo tuile accent + nom tenant */}
          <div className="mb-3 flex items-center gap-2.5 px-1">
            <div
              className="grid size-[30px] shrink-0 place-items-center rounded-[8px] bg-accent text-[15px] font-extrabold text-white"
              aria-hidden
            >
              {initial}
            </div>
            <div
              className="min-w-0 truncate whitespace-nowrap text-lg font-semibold text-ink transition-opacity duration-200"
              style={{ opacity: open ? 1 : 0 }}
            >
              {tenant?.name ?? "…"}
            </div>
          </div>

          {open ? (
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-[rgba(244,238,225,0.4)]">
              Gestion
            </div>
          ) : (
            <div
              className="mx-1 mb-2.5 h-px shrink-0 bg-[rgba(244,238,225,0.12)]"
              aria-hidden
            />
          )}

          {/* Navigation */}
          <nav
            className="cf-scroll flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden"
            aria-label="Navigation principale"
          >
            {NAV.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const badge = item.id === "orders" && newCount > 0;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  title={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={cx(
                    "relative flex shrink-0 items-center gap-2.5 rounded-ctrl py-[11px] text-sm transition-colors duration-200",
                    open ? "px-3" : "justify-center px-0",
                    isActive
                      ? "bg-accent font-extrabold text-white"
                      : "font-semibold text-[rgba(244,238,225,0.72)] hover:bg-[rgba(244,238,225,0.06)]",
                  )}
                >
                  <Icon
                    name={item.icon}
                    size={18}
                    stroke={isActive ? 2.3 : 2}
                    className="shrink-0"
                  />
                  {open && (
                    <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                  {badge &&
                    (open ? (
                      <span className="shrink-0 rounded-pill bg-gold px-[7px] py-px text-[11px] font-extrabold tabular-nums text-[#1C1612]">
                        {newCount}
                        <span className="sr-only"> nouvelles commandes</span>
                      </span>
                    ) : (
                      <span
                        className="absolute right-3 top-[7px] size-2 rounded-full border-2 border-fill bg-gold"
                        aria-hidden
                      />
                    ))}
                </Link>
              );
            })}
          </nav>

          {/* Pied : gérant + réglages + réduire */}
          <div
            className={cx(
              "mt-auto flex shrink-0 items-center gap-2.5 border-t border-[rgba(244,238,225,0.12)] pt-3",
              !open && "flex-col",
            )}
          >
            <div
              className="grid size-[34px] shrink-0 place-items-center rounded-full bg-accent text-[15px] font-bold text-white"
              aria-hidden
            >
              M
            </div>
            {open && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#F4EEE1]">
                  Le Gérant
                </div>
                <div className="truncate text-xs text-[rgba(244,238,225,0.5)]">
                  {city}
                </div>
              </div>
            )}
            <button
              type="button"
              title="Paramètres"
              aria-label="Paramètres"
              className="shrink-0 text-[rgba(244,238,225,0.5)] transition-colors duration-200 hover:text-white"
            >
              <Icon name="gear" size={17} />
            </button>
            <button
              type="button"
              onClick={toggleNav}
              title={open ? "Réduire le menu" : "Développer le menu"}
              aria-label={open ? "Réduire le menu" : "Développer le menu"}
              aria-expanded={open}
              className="grid size-7 shrink-0 place-items-center rounded-[8px] border border-[rgba(244,238,225,0.18)] bg-[rgba(244,238,225,0.06)] text-ink transition-colors duration-200 hover:bg-[rgba(244,238,225,0.12)]"
            >
              <Icon name={open ? "back" : "arrow"} size={14} />
            </button>
          </div>
        </aside>
      </div>

      {/* ── Colonne topbar + contenu ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-bg px-[26px] py-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-ink">
              {active?.label ?? "Back-office"}
            </h1>
            <p className="truncate text-sm text-mut" suppressHydrationWarning>
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {/* Recherche globale — présente, non câblée en v1 */}
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mut"
              />
              <input
                type="search"
                placeholder="Rechercher…"
                aria-label="Recherche globale"
                className="w-[220px] rounded-ctrl border border-white/6 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition-colors duration-200 placeholder:text-mut/75 focus:border-accent"
              />
            </div>

            {/* Pilule Ouvert/Fermé ↔ commande en ligne (vert/rouge fonctionnels) */}
            <button
              type="button"
              onClick={toggleOnline}
              disabled={!tenant || togglingOnline}
              aria-pressed={!paused}
              title={
                paused
                  ? "Commande en ligne en pause — cliquer pour rouvrir"
                  : "Commande en ligne active — cliquer pour mettre en pause"
              }
              className={cx(
                "flex items-center gap-2 rounded-pill border-2 bg-surface px-3.5 py-2 text-sm font-bold text-ink transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40",
                paused ? "border-alert" : "border-ok",
              )}
            >
              <span
                className={cx(
                  "size-[9px] rounded-full",
                  paused ? "bg-alert" : "bg-ok",
                )}
                aria-hidden
              />
              {paused ? "Fermé" : "Ouvert"}
            </button>

            <IconBtn icon="bell" label="Notifications" />
          </div>
        </header>

        {/* Zone de contenu — `relative` : les Drawer s'y positionnent en absolu */}
        <main className="cf-scroll relative min-h-0 flex-1 overflow-y-auto bg-bg">
          {children}
        </main>
      </div>
    </div>
  );
}
