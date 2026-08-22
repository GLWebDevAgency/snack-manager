"use client";

/**
 * Coquille du back-office INTERNE Snack Manager (CRM HQ).
 *
 * Deux choses la distinguent du back-office restaurant :
 *
 * 1. L'accent est FIXÉ au laiton de la marque (#c9a15a). Ce n'est pas une
 *    surface tenant : aucun restaurant ne la rebrande. Le layout admin injecte
 *    l'accent du tenant sur <html> au runtime ; si on arrive de là sans
 *    rechargement, cette couleur nous suivrait — on la repose donc à l'entrée.
 * 2. Elle est réservée au rôle `sm_admin`. Un gérant est renvoyé chez lui.
 *    La garde qui protège vraiment les données est côté API (403) ; celle-ci
 *    évite juste d'afficher notre CRM à un client.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { CrmOverview } from "@sm/contracts";
import { ApiError, clearToken, getToken } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtDateFr } from "@/lib/format";
import { Icon, ToastProvider, type IconName } from "@/components/ui";
import { crm, euroRound, HqContext, isHqSession } from "./crm";

/** Accent de la maison — jamais thémable par un restaurant (spec crm-sm §2.4). */
const HQ_ACCENT = "#c9a15a";
const HQ_ON_ACCENT = "#12100d";

/**
 * LA TABLE DE NAVIGATION — et la source du titre de l'en-tête.
 *
 * Elle sert deux fois : à dessiner la colonne de gauche, et à TITRER l'écran
 * (`active.title`). Une page absente de cette table hérite donc du premier
 * item : `/sm/signals` s'intitulait « Tableau de bord » et surlignait le
 * mauvais lien tant qu'elle n'y figurait pas. Toute page ajoutée sous `/sm/`
 * doit y entrer le jour où elle est livrée.
 *
 * L'ordre est celui de la journée de travail : on regarde le parc, on vend, on
 * suit ses clients, on traite les signaux du jour, on encaisse.
 */
const NAV: { href: string; label: string; icon: IconName; title: string }[] = [
  { href: "/sm", label: "Tableau de bord", icon: "home", title: "Tableau de bord" },
  { href: "/sm/pipeline", label: "Pipeline", icon: "grid", title: "Pipeline commercial" },
  { href: "/sm/clients", label: "Clients", icon: "user", title: "Restaurants clients" },
  { href: "/sm/signals", label: "Signaux", icon: "bell", title: "File de travail" },
  {
    href: "/sm/facturation",
    label: "Facturation",
    icon: "euro",
    title: "Facturation et recouvrement",
  },
  // En DERNIER, et c'est voulu : la vitrine n'est pas un geste de la journée
  // de travail, c'est un réglage de la maison. Il se visite quand un compte
  // ouvre ou ferme, pas tous les matins.
  {
    href: "/sm/reseaux",
    label: "Vitrine",
    icon: "gear",
    title: "Réseaux sociaux de la vitrine",
  },
];

export default function SmLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  // La page de connexion vit hors de la coquille : elle est le seul écran
  // atteignable sans session.
  if (pathname === "/sm/login") return <>{children}</>;
  return (
    <ToastProvider>
      <HqShell>{children}</HqShell>
    </ToastProvider>
  );
}

const emptySubscribe = () => () => {};

function HqShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // localStorage n'existe pas au rendu serveur : `false` côté serveur, valeur
  // réelle après hydratation (même schéma que la coquille du back-office).
  const token = useSyncExternalStore(
    emptySubscribe,
    () => getToken(),
    () => null,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  // ── Accent de la maison, reposé à chaque montage ──
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--cf-accent", HQ_ACCENT);
    root.setProperty("--cf-on-accent", HQ_ON_ACCENT);
  }, []);

  // ── Cloisonnement : pas de session → connexion ; mauvais rôle → back-office ──
  const allowed = isHqSession(token);
  useEffect(() => {
    if (!mounted) return;
    if (!token) router.replace("/sm/login");
    else if (!allowed) router.replace("/admin/dashboard");
  }, [mounted, token, allowed, router]);

  // ── Aperçu HQ partagé (bandeau + tableau de bord) ──
  useEffect(() => {
    if (!mounted || !allowed) return;
    let cancelled = false;
    setLoading(true);
    crm
      .overview()
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch((e) => {
        if (cancelled) return;
        // Le jeton peut avoir expiré, ou appartenir à un gérant : dans les deux
        // cas la place de l'utilisateur n'est pas ici.
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/sm/login");
        } else if (e instanceof ApiError && e.status === 403) {
          router.replace("/admin/dashboard");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, allowed, router, tick]);

  if (!mounted || !token || !allowed) return null;

  const active =
    [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) =>
      n.href === "/sm" ? pathname === "/sm" : pathname.startsWith(n.href),
    ) ?? NAV[0]!;

  const seats = overview?.founderSeats;
  const openLeads = overview?.leadsOpen ?? 0;

  function logout() {
    clearToken();
    router.replace("/sm/login");
  }

  return (
    <HqContext.Provider value={{ overview, loading, reload }}>
      <div className="flex h-screen overflow-hidden bg-bg">
        {/* ── Colonne de navigation (232px, fixe : outil de bureau interne) ── */}
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface px-3 py-[18px]">
          <div className="flex items-center gap-2.5 px-2">
            <div
              className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[15px] font-extrabold text-onaccent"
              aria-hidden
            >
              S
            </div>
            <div className="min-w-0 truncate text-lg font-extrabold tracking-[-0.02em] text-ink">
              Snack Manager
            </div>
          </div>
          <div className="px-2 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
            Interne · HQ
          </div>

          <nav className="flex flex-col gap-[3px]" aria-label="Navigation interne">
            {NAV.map((item) => {
              const on = item.href === active.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "cf-press-row flex items-center gap-[11px] rounded-ctrl px-3 py-[11px] text-sm",
                    on
                      ? "bg-accent font-extrabold text-onaccent shadow-card"
                      : "font-semibold text-white/70 hover:bg-white/8 hover:text-white",
                  )}
                >
                  <Icon name={item.icon} size={18} stroke={on ? 2.3 : 2} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.href === "/sm/pipeline" && openLeads > 0 && (
                    <span
                      className={cx(
                        "cf-fig shrink-0 rounded-pill px-[7px] py-px text-[11px] font-extrabold",
                        on ? "bg-black/25 text-onaccent" : "bg-fill text-mut",
                      )}
                    >
                      {openLeads}
                      <span className="sr-only"> leads en cours</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* ── Places fondateur : le chiffre que le fondateur regarde en premier ── */}
          <div className="mt-4 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
              Places fondateur
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="cf-fig text-2xl font-extrabold text-accent">
                {seats ? seats.remaining : "—"}
              </span>
              <span className="text-[13px] font-semibold text-mut">
                / {seats?.total ?? 10} libres
              </span>
            </div>
            <SeatMeter taken={seats?.taken ?? 0} total={seats?.total ?? 10} />
          </div>

          <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-3">
            <div
              className="grid size-[34px] shrink-0 place-items-center rounded-full bg-fill text-sm font-extrabold text-accent"
              aria-hidden
            >
              A
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-ink">Admin SM</div>
              <div className="truncate text-xs text-mut">Fondateur</div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Se déconnecter"
              aria-label="Se déconnecter"
              className="cf-press grid size-8 shrink-0 place-items-center rounded-xs border border-white/12 bg-white/6 text-mut hover:border-white/25 hover:bg-white/12 hover:text-white"
            >
              <Icon name="back" size={15} />
            </button>
          </div>
        </aside>

        {/* ── Colonne titre + contenu ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line2 bg-[image:var(--cf-card-gradient)] px-[26px] py-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-[-0.03em] text-ink">
                {active.title}
              </h1>
              <p className="truncate text-sm text-mut" suppressHydrationWarning>
                {fmtDateFr(new Date())} · interne Snack Manager
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span
                className="hidden items-center gap-2 rounded-pill border border-line bg-[image:var(--cf-elev-gradient)] px-3.5 py-2 text-[13px] font-bold text-ink lg:inline-flex"
                title="Restaurants clients actifs sur les 30 derniers jours"
              >
                <span className="size-[9px] rounded-full bg-ok" aria-hidden />
                {overview ? `${overview.activeClients} client${overview.activeClients > 1 ? "s" : ""} actif${overview.activeClients > 1 ? "s" : ""}` : "…"}
              </span>
              <span className="cf-fig rounded-pill border border-accent/40 bg-accent/10 px-3.5 py-2 text-[13px] font-extrabold text-accent">
                {overview ? euroRound(overview.mrrCents) : "…"}
                <span className="ml-1 font-semibold text-accent/70">MRR</span>
              </span>
            </div>
          </header>

          <main className="cf-scroll relative min-h-0 flex-1 overflow-y-auto bg-bg">
            {children}
          </main>
        </div>
      </div>
    </HqContext.Provider>
  );
}

/**
 * Jauge des 10 places fondateur : dix segments, autant d'allumés que de places
 * prises. Un compteur qui se lit sans lire le chiffre (DA §7).
 */
function SeatMeter({ taken, total }: { taken: number; total: number }) {
  return (
    <div className="mt-2 flex gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cx(
            "h-[6px] flex-1 rounded-pill transition-colors duration-200 ease-sm",
            i < taken ? "bg-accent" : "bg-white/12",
          )}
        />
      ))}
    </div>
  );
}
