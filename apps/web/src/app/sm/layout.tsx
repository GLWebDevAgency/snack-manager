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
import { LogoLockup } from "@/components/brand/Logo";
import { crm, euroRound, HqContext, isHqSession } from "./crm";
import { BottomSheet } from "./mobile";

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
  { href: "/sm/erreurs", label: "Erreurs", icon: "gear", title: "Journal d'erreurs" },
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

/**
 * LA BARRE BASSE ne porte que CINQ entrées — la règle des grandes applications
 * mobiles, et elle n'est pas esthétique : à six, chaque cible passe sous les
 * 44 px de pouce sur un écran de 390. Les quatre gestes quotidiens (regarder,
 * vendre, suivre, encaisser) + « Plus » qui ouvre une feuille avec le reste.
 * Les entrées sont TIRÉES de `NAV`, jamais recopiées : un intitulé qui change
 * change aux deux endroits.
 */
const MOBILE_NAV_HREFS = ["/sm", "/sm/pipeline", "/sm/clients", "/sm/facturation"];
const MOBILE_NAV = MOBILE_NAV_HREFS.map(
  (href) => NAV.find((n) => n.href === href)!,
);
const MOBILE_MORE = NAV.filter((n) => !MOBILE_NAV_HREFS.includes(n.href));

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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation : `token` vaut null au rendu serveur par construction, la valeur doit donc différer entre hydratation et suite. Sans lui, la garde de session renverrait vers /sm/login au premier rendu client et l'aperçu HQ ne se déclencherait jamais.
  useEffect(() => setMounted(true), []);

  const [overview, setOverview] = useState<CrmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  // Feuille « Plus » de la barre basse. Elle se referme au CLIC sur un lien,
  // pas par un effet sur le chemin : un effet fermerait un rendu trop tard et
  // laisserait la feuille clignoter sur la nouvelle page.
  const [moreOpen, setMoreOpen] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- état de chargement posé avant l'appel réseau, il dépend de la requête en vol et non du rendu. Le retirer laisserait le bandeau HQ afficher des compteurs vides comme s'ils étaient réels, et un rechargement ne montrerait plus aucun signe d'activité.
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
      {/*
        `h-dvh` et non `h-screen` : sur téléphone, 100vh déborde derrière les
        barres du navigateur et la barre basse finirait sous elles.

        Les trois règles descendantes posent 16 px sur TOUTE saisie de la
        surface sous `md` : en dessous, iOS zoome le champ au focus et l'écran
        ne revient jamais tout à fait en place. Une règle ici plutôt qu'une
        classe sur chacun des dizaines de champs — un champ ajouté demain est
        couvert d'office.
      */}
      <div className="flex h-dvh overflow-hidden bg-bg max-md:[&_input]:text-[16px] max-md:[&_select]:text-[16px] max-md:[&_textarea]:text-[16px]">
        {/* ── Colonne de navigation (232px) — bureau seulement : sous `md`,
            la barre basse prend le relais ── */}
        <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface px-3 py-[18px] max-md:hidden">
          {/*
            LE SIGNE EN TÊTE DE COLONNE — pas une décoration, le TITRE de
            l'outil. Contrairement au back-office restaurant, rien n'oblige ici
            à la discrétion : le CRM est notre maison, personne ne peut prendre
            notre marque pour celle d'un commerce.

            Le verrouillage remplace la tuile-lettre ET le nom composé à la
            main : le mark et le mot ne peuvent plus se désaccorder, et le
            libellé accessible « Snack Manager » vient du composant.

            28 px : au-dessus du seuil micro (20 px), donc la gravure standard,
            éclair évidé compris. Le nom en découle à ~17 px, soit le corps de
            l'ancien titre, et le groupe mesure ~158 px dans les 192 px utiles
            de la colonne. `tone` reste `mono` — la garniture laiton n'est
            admise qu'à partir de 52 px.

            L'encre vient du conteneur (`text-ink`), jamais d'un `fill` : le
            mark suit `currentColor`. Et l'éclair étant un VIDE, il prend le
            fond — l'aplat `bg-surface` de la colonne, uni, le lui donne.
          */}
          <div className="px-2 text-ink">
            <LogoLockup size={28} />
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
              <Icon name="logout" size={15} />
            </button>
          </div>
        </aside>

        {/* ── Colonne titre + contenu ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sous `md`, le bandeau se CONDENSE : titre plus petit, date
              masquée (elle est sur le téléphone lui-même), pilule MRR
              resserrée — rien ne doit pousser la ligne à déborder. */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line2 bg-[image:var(--cf-card-gradient)] px-[26px] py-4 max-md:gap-2.5 max-md:px-4 max-md:py-2.5">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-[-0.03em] text-ink max-md:text-lg">
                {active.title}
              </h1>
              <p className="truncate text-sm text-mut max-md:hidden" suppressHydrationWarning>
                {fmtDateFr(new Date())} · interne Snack Manager
              </p>
            </div>
            <div className="flex min-w-0 shrink-0 items-center gap-3 max-md:gap-2">
              <span
                className="hidden items-center gap-2 rounded-pill border border-line bg-[image:var(--cf-elev-gradient)] px-3.5 py-2 text-[13px] font-bold text-ink lg:inline-flex"
                title="Restaurants clients actifs sur les 30 derniers jours"
              >
                <span className="size-[9px] rounded-full bg-ok" aria-hidden />
                {overview ? `${overview.activeClients} client${overview.activeClients > 1 ? "s" : ""} actif${overview.activeClients > 1 ? "s" : ""}` : "…"}
              </span>
              <span className="cf-fig whitespace-nowrap rounded-pill border border-accent/40 bg-accent/10 px-3.5 py-2 text-[13px] font-extrabold text-accent max-md:px-2.5 max-md:py-1.5 max-md:text-[12px]">
                {overview ? euroRound(overview.mrrCents) : "…"}
                <span className="ml-1 font-semibold text-accent/70">MRR</span>
              </span>
            </div>
          </header>

          {/* Le rembourrage bas mobile garde le contenu AU-DESSUS de la barre
              basse (fixe) — sa hauteur + la marge des encoches. */}
          <main className="cf-scroll relative min-h-0 flex-1 overflow-y-auto bg-bg max-md:pb-[calc(66px+env(safe-area-inset-bottom))]">
            {children}
          </main>
        </div>

        {/* ── Barre de navigation basse — téléphone et petite tablette ── */}
        <nav
          aria-label="Navigation interne (mobile)"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map((item) => {
              const on = item.href === active.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "cf-press flex min-h-[54px] flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2",
                    on ? "text-accent" : "text-white/60",
                  )}
                >
                  <span className="relative">
                    <Icon name={item.icon} size={21} stroke={on ? 2.3 : 2} />
                    {item.href === "/sm/pipeline" && openLeads > 0 && (
                      <span className="cf-fig absolute -right-2.5 -top-1.5 rounded-pill bg-accent px-[5px] text-[9px] font-extrabold leading-[14px] text-onaccent">
                        {openLeads}
                        <span className="sr-only"> leads en cours</span>
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] font-bold leading-none tracking-[-0.01em]">
                    {item.label === "Tableau de bord" ? "Tableau" : item.label}
                  </span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={cx(
                "cf-press flex min-h-[54px] flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2",
                // « Plus » s'allume quand la page ACTIVE vit dans sa feuille :
                // sinon Signaux ou Erreurs sembleraient n'exister nulle part.
                MOBILE_MORE.some((n) => n.href === active.href)
                  ? "text-accent"
                  : "text-white/60",
              )}
            >
              <span
                className="grid h-[21px] place-items-center text-[19px] font-extrabold leading-none tracking-[0.08em]"
                aria-hidden
              >
                ⋯
              </span>
              <span className="text-[10px] font-bold leading-none tracking-[-0.01em]">
                Plus
              </span>
            </button>
          </div>
        </nav>

        {/* ── La feuille « Plus » : le reste de la navigation, et la sortie ── */}
        <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Plus">
          <div className="flex flex-col gap-0.5">
            {MOBILE_MORE.map((item) => {
              const on = item.href === active.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={cx(
                    "cf-press-row flex min-h-12 items-center gap-3 rounded-ctrl px-3 py-2.5 text-sm",
                    on
                      ? "bg-accent font-extrabold text-onaccent"
                      : "font-semibold text-white/80 hover:bg-white/8",
                  )}
                >
                  <Icon name={item.icon} size={19} stroke={on ? 2.3 : 2} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <Icon name="arrow" size={15} className={on ? "" : "text-mut"} />
                </Link>
              );
            })}
          </div>

          {/* Le chiffre que le fondateur regarde en premier suit la navigation
              mobile : il vivait dans la colonne de bureau, désormais masquée. */}
          <div className="mt-3 rounded-card border border-white/6 bg-[image:var(--cf-elev-gradient)] p-3">
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

          <div className="mt-3 flex items-center gap-2.5 border-t border-line px-1 pt-3">
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
              className="cf-press flex min-h-11 items-center gap-2 rounded-pill border border-white/12 bg-white/6 px-3.5 text-[13px] font-bold text-mut hover:border-white/25 hover:bg-white/12 hover:text-white"
            >
              <Icon name="logout" size={15} />
              Se déconnecter
            </button>
          </div>
        </BottomSheet>
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
