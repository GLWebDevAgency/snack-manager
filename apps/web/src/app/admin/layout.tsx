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
  type CSSProperties,
  type ReactNode,
} from "react";
import type { OrderStatus } from "@sm/contracts";
import { api, ApiError, clearToken, getToken, type TenantMe } from "@/lib/api";
import { isDemoActive } from "@/lib/demo";
import { BandeauDemo } from "@/lib/demo/BandeauDemo";
import { LogoMark } from "@/components/brand/Logo";
import { Splash } from "@/components/brand/Splash";
import { consommerSplashDeTransition } from "@/components/brand/SplashAuPremierPassage";
import { cx } from "@/lib/cx";
import { fmtDateFr } from "@/lib/format";
import { useTenantSocket } from "@/lib/ws";
import { IconBtn, Icon, ToastProvider, useToast, type IconName } from "@/components/ui";

const RAIL = 66;
const PANEL = 232;
const NAV_STORE = "sm-bo-nav";

/**
 * Texte lisible sur l'accent tenant — même règle que `readableOn()` côté
 * caisse : un accent clair (laiton #c9a15a) réclame du texte sombre, le blanc
 * y tombe à 2,4:1, très en dessous du seuil WCAG.
 */
function readableOnAccent(hex: string): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return "#12100d";
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return luminance > 0.18 ? "#12100d" : "#ffffff";
}

const NAV: { id: string; href: string; label: string; icon: IconName }[] = [
  { id: "dashboard", href: "/admin/dashboard", label: "Tableau de bord", icon: "home" },
  { id: "orders", href: "/admin/orders", label: "Commandes", icon: "ticket" },
  { id: "menu", href: "/admin/menu", label: "Menu & prix", icon: "grid" },
  { id: "ingredients", href: "/admin/ingredients", label: "Ingrédients & stocks", icon: "fries" },
  { id: "promos", href: "/admin/promos", label: "Promos", icon: "tag" },
  { id: "hours", href: "/admin/hours", label: "Horaires", icon: "clock" },
  { id: "screens", href: "/admin/screens", label: "Écrans TV", icon: "tv" },
  { id: "devices", href: "/admin/devices", label: "Caisses & cuisine", icon: "print" },
  { id: "stats", href: "/admin/stats", label: "Statistiques", icon: "chart" },
  { id: "team", href: "/admin/team", label: "Équipe & pointage", icon: "user" },
  // Juste après « Équipe & pointage », et les deux se répondent : là on badge
  // ce qui s'est passé, ici on décide ce qui va se passer. L'écart entre les
  // deux — prévu contre pointé — est justement ce que le planning affiche.
  { id: "planning", href: "/admin/planning", label: "Planning", icon: "clock" },
  { id: "reviews", href: "/admin/reviews", label: "Avis clients", icon: "star" },
  // Dernier de la liste, et c'est voulu : le gérant y vient deux fois par an,
  // alors qu'il ouvre les commandes et la carte chaque jour. Mais il DOIT le
  // trouver seul — la FAQ lui promet mot pour mot d'y retrouver ses factures.
  { id: "abonnement", href: "/admin/abonnement", label: "Abonnement", icon: "euro" },
];

export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === "/admin/login") return <>{children}</>;
  return (
    <ToastProvider>
      {/*
        L'OUVERTURE D'APRÈS-CONNEXION — montée ICI, et pas sur la page de
        connexion, parce que celle-ci disparaît au moment même où le calque
        devrait couvrir l'attente. Le drapeau posé par `login/page.tsx`
        traverse la navigation ; cette coque le consomme, une seule fois.

        `toujours` : ce n'est pas l'ouverture d'une visite mais celle d'une
        TRANSITION. Elle se joue à chaque connexion validée, jamais autrement —
        le drapeau est effacé à la lecture.
      */}
      <SplashApresConnexion />
      <Shell>{children}</Shell>
    </ToastProvider>
  );
}

/**
 * Ne monte l'ouverture que si une connexion vient d'être validée.
 *
 * Le drapeau est lu et effacé au même instant : recharger le tableau de bord
 * ne la rejoue pas, et un second onglet ne la vole pas.
 */
function SplashApresConnexion() {
  const [entree, setEntree] = useState(false);
  useEffect(() => {
    if (consommerSplashDeTransition()) setEntree(true);
  }, []);
  if (!entree) return null;
  return <Splash duree={3.6} annonce="Ouverture de votre back-office" onFini={() => setEntree(false)} />;
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
  //
  // La démonstration de la page d'accueil n'a PAS de session : elle ne se
  // connecte à rien, tout vit dans l'onglet. Sans cette exception, la garde
  // ci-dessous renverrait le visiteur vers `/admin/login` au premier rendu et
  // la démonstration s'arrêterait avant d'avoir commencé. `isDemoActive()` ne
  // répond `true` que si l'URL d'entrée portait `?demo=1` — jamais autrement,
  // et jamais côté serveur, ce qui laisse le rendu d'hydratation identique.
  const hasToken = useSyncExternalStore(
    emptySubscribe,
    () => Boolean(getToken()) || isDemoActive(),
    () => false,
  );

  /**
   * Démonstration : le bandeau de retour vers la vitrine, et rien d'autre.
   *
   * Lu séparément de `hasToken`, qui mélange volontairement les deux cas (un
   * jeton OU la démonstration ouvrent la coque). Ici il faut la démonstration
   * SEULE : un gérant connecté avec son vrai compte ne doit jamais voir de
   * porte de sortie vers notre site commercial au-dessus de son back-office.
   */
  const demo = useSyncExternalStore(emptySubscribe, isDemoActive, () => false);

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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation : sa valeur DOIT différer entre le rendu serveur et le client, aucun calcul au rendu ne peut donc le produire. Dérivé, la garde lirait `hasToken === false` au premier rendu et renverrait vers /admin/login un gérant pourtant connecté.
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
        const accent = t.brandColor || "#c9a15a";
        const root = document.documentElement.style;
        root.setProperty("--cf-accent", accent);
        root.setProperty("--cf-on-accent", readableOnAccent(accent));
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
    /*
      La coque est désormais une COLONNE : le bandeau de démonstration en tête,
      la coque du back-office en dessous. C'est ce qui garantit qu'il ne
      recouvre jamais rien — ni la barre de titre, ni la pilule Ouvert/Fermé,
      ni la navigation — puisqu'il prend sa place au lieu de la voler. Et comme
      la colonne fait exactement la hauteur de la fenêtre, il reste visible
      quelle que soit la page ouverte et quel que soit le défilement.

      Hors démonstration, `BandeauDemo` rend `null` : la colonne n'ajoute alors
      aucun pixel, et le back-office d'un vrai gérant est strictement celui
      qu'il connaît.
    */
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <BandeauDemo actif={demo} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/*
          ── Sidebar : elle POUSSE sur grand écran, elle SURVOLE en dessous ──

          Le panneau est toujours en position absolue ; ce qui change, c'est la
          largeur du réservataire qui le précède dans le flux. Au repos il vaut
          le rail (66 px) et le panneau déployé passe donc PAR-DESSUS le
          contenu ; à partir de `xl` il suit le panneau, et le contenu se
          décale d'autant.

          Pourquoi deux comportements plutôt qu'un seul : sur une tablette,
          rendre 232 px au menu ampute le contenu d'un cinquième de la largeur
          — le survol est le bon geste, il est temporaire et on referme. Sur un
          écran d'ordinateur il reste plus de 1 000 px une fois le menu déployé,
          et recouvrir la liste des catégories qu'on est en train de lire n'a
          plus aucune justification. Le seuil est `xl` (1280 px) : en dessous,
          pousser laisserait moins de 800 px de contenu, ce qui serre trop les
          tableaux de prix et de stocks.

          L'ombre portée disparaît quand la barre pousse : une ombre dit « je
          flotte au-dessus », ce qui devient un mensonge dès qu'elle occupe sa
          propre place.
        */}
        <div
          className="relative z-[45] w-[var(--sm-rail)] shrink-0 transition-[width] duration-[280ms] ease-[var(--sm-ease)] motion-reduce:transition-none xl:w-[var(--sm-panel)]"
          style={
            {
              "--sm-rail": `${RAIL}px`,
              "--sm-panel": `${open ? PANEL : RAIL}px`,
            } as CSSProperties
          }
        >
          <aside
            className={cx(
              "absolute inset-y-0 left-0 flex flex-col overflow-hidden border-r border-line bg-fill px-3 py-[18px]",
              "transition-[width,box-shadow] duration-[280ms] ease-[var(--sm-ease)] motion-reduce:transition-none",
              open && "shadow-[18px_0_44px_rgba(0,0,0,0.45)] xl:shadow-none",
            )}
            style={{ width: open ? PANEL : RAIL }}
          >
            {/* En-tête : logo tuile accent + nom tenant */}
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <div
                className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[15px] font-extrabold text-onaccent"
                aria-hidden
              >
                {initial}
              </div>
              <div
                className="min-w-0 truncate whitespace-nowrap text-lg font-semibold text-ink transition-opacity duration-200 ease-sm"
                style={{ opacity: open ? 1 : 0 }}
              >
                {tenant?.name ?? "…"}
              </div>
            </div>

            {/* Intitulé de section : 11px, 600, capitales, .06em, gris #999 (DA §2). */}
            {open ? (
              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
                Gestion
              </div>
            ) : (
              <div className="mx-1 mb-2.5 h-px shrink-0 bg-line" aria-hidden />
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
                      "cf-press-row relative flex shrink-0 items-center gap-2.5 rounded-ctrl py-[11px] text-sm",
                      open ? "px-3" : "justify-center px-0",
                      isActive
                        ? "bg-accent font-extrabold text-onaccent shadow-card"
                        : "font-semibold text-white/70 hover:bg-white/8 hover:text-white",
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
                        <span className="cf-fig shrink-0 rounded-pill bg-gold px-[7px] py-px text-[11px] font-extrabold text-[#1C1612]">
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
                "mt-auto flex shrink-0 items-center gap-2.5 border-t border-line pt-3",
                !open && "flex-col",
              )}
            >
              <div
                className="grid size-[34px] shrink-0 place-items-center rounded-full bg-accent text-[15px] font-extrabold text-onaccent"
                aria-hidden
              >
                M
              </div>
              {open && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-ink">
                    Le Gérant
                  </div>
                  <div className="truncate text-xs text-mut">{city}</div>
                </div>
              )}
              <button
                type="button"
                title="Paramètres"
                aria-label="Paramètres"
                className="cf-press shrink-0 text-mut hover:text-white"
              >
                <Icon name="gear" size={17} />
              </button>
              <button
                type="button"
                onClick={toggleNav}
                title={open ? "Réduire le menu" : "Développer le menu"}
                aria-label={open ? "Réduire le menu" : "Développer le menu"}
                aria-expanded={open}
                className="cf-press grid size-7 shrink-0 place-items-center rounded-xs border border-white/12 bg-white/6 text-ink hover:border-white/25 hover:bg-white/12"
              >
                <Icon name={open ? "back" : "arrow"} size={14} />
              </button>
            </div>

            {/*
              ═══ LA SIGNATURE DE L'ÉDITEUR — RÉTABLIE, ET POURQUOI ═══

              Je l'avais retirée en lisant la charte §10 au pied de la lettre :
              « le mark n'apparaît qu'une fois, en pied d'écran de connexion ».
              Le fondateur a tranché autrement, et son arbitrage prime — c'est
              sa marque.

              Il a aussi raison sur le fond, et la charte le dit elle-même en
              donnant sa raison : « le restaurateur vend son enseigne, pas la
              nôtre ». Ce que §10 protège, c'est ce que voit LE MANGEUR — le
              site de commande, le ticket, l'écran de salle. Or cette barre
              n'est jamais vue par un client du restaurant : c'est l'outil de
              travail du gérant, et il doit pouvoir NOMMER le logiciel qu'il a
              sous les yeux quand il appelle le support.

              Ce qui reste vrai de §10, et qui gouverne la forme :

              · DISCRÈTE. 14 px, gris sourd à 70 %, en PIED de barre — jamais
                en tête, où règnent la tuile d'accent et le nom du restaurant.
                Elle identifie, elle ne titre pas.
              · MUETTE. Aucun lien vers la vitrine : une porte de sortie
                commerciale au-dessus du back-office d'un client n'a rien à y
                faire.
              · SANS COULEUR PROPRE. Elle suit `currentColor`, donc le gris de
                la barre. Jamais `--cf-accent`, qui porte la couleur du
                restaurant : notre signe repeint en rouge chez un client qui a
                choisi le rouge serait notre marque vendue à un autre.

              À 14 px le composant sert seul la gravure micro. Barre repliée,
              le nom passe en `sr-only` : l'oreille garde ce que l'œil n'a plus
              la place de lire.
            */}
            <div
              className={cx(
                "mt-3 flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-mut/70",
                open ? "px-1" : "justify-center",
              )}
            >
              <LogoMark size={14} className="shrink-0" />
              <span className={cx("min-w-0 truncate whitespace-nowrap", !open && "sr-only")}>
                Snack Manager
              </span>
            </div>
          </aside>
        </div>

        {/* ── Colonne topbar + contenu ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            La topbar est une SURFACE À PART : #111 au-dessus du canevas noir.
            Deux surfaces adjacentes ne portent jamais la même valeur (DA §1) —
            la barre ne peut pas se contenter d'un filet pour se détacher.
          */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line2 bg-[image:var(--cf-card-gradient)] px-[26px] py-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-[-0.03em] text-ink">
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
                  className="w-[220px] rounded-ctrl border border-white/8 bg-white/5 py-2.5 pl-9 pr-3 text-sm font-medium text-white outline-none transition-colors duration-200 ease-sm placeholder:text-mut/70 hover:border-white/16 focus:border-accent focus:bg-white/8"
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
                  "cf-press flex items-center gap-2 rounded-pill border-2 bg-[image:var(--cf-elev-gradient)] px-3.5 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40",
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
    </div>
  );
}
