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
import { initialeDe, libelleRole, nomAffichable, useIdentite } from "@/lib/identite";
import { Icon, IconBtn, ToastProvider } from "@/components/ui";
import { LogoLockup } from "@/components/brand/Logo";
import { crm, euroRound, HQ_ROLE, HqContext, isHqSession } from "./crm";
import { BottomSheet } from "./mobile";
import { backofficeStyle } from "@/components/backoffice/visual-style";
import "@/components/backoffice/backoffice.css";
import { AppearanceButton, useBackofficeTheme } from "@/components/backoffice/appearance";
import {
  libelleCourt,
  MOBILE_MORE,
  MOBILE_MORE_GROUPES,
  MOBILE_NAV,
  NAV_ACCUEIL,
  NAV_GROUPES,
  navActive,
  type NavItem,
} from "./navigation";

/** Accent de la maison — jamais thémable par un restaurant (spec crm-sm §2.4). */
const HQ_ACCENT = "#c9a15a";
const HQ_ON_ACCENT = "#12100d";

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
  const { theme, toggleTheme } = useBackofficeTheme();
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

  // ── Qui est connecté ──
  //
  // Le pied de barre annonçait « Admin SM » et « Fondateur » sous une pastille
  // « A », en bureau comme en mobile : trois mots écrits en dur, vrais pour
  // personne. `GET /auth/me` rend la personne derrière le jeton — le nom n'est
  // dans aucune autre réponse, `GET /tenants/me` ne rendant que l'établissement
  // (et cette surface n'en a pas : l'équipe Snack Manager porte `tenantId`
  // null).
  //
  // Tant que la réponse n'est pas là, ou si elle n'arrive jamais, `nom` vaut
  // `null` et la ligne affiche un tiret discret — jamais un nom deviné.
  const identite = useIdentite(mounted && allowed);
  const nom = nomAffichable(identite);
  const initiale = initialeDe(identite);
  // La seconde ligne, elle, n'a pas besoin d'attendre : cette coque ne se rend
  // QUE si le jeton porte `sm_admin` (`allowed` ci-dessus). Le repli dit donc
  // ce que le cloisonnement vient de vérifier, pas une supposition.
  const role = libelleRole(identite?.role ?? (allowed ? HQ_ROLE : null));

  if (!mounted || !token || !allowed) return null;

  const active = navActive(pathname);

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
      <div className="sm-backoffice flex h-dvh overflow-hidden bg-bg max-md:[&_input]:text-[16px] max-md:[&_select]:text-[16px] max-md:[&_textarea]:text-[16px]" data-sm-theme={theme} style={backofficeStyle(theme, HQ_ACCENT)}>
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

          {/*
            CE QUI DÉFILE, c'est la navigation ET le bloc des places — pas le
            pied de colonne, qui porte la sortie et doit rester atteignable.
            Les cinq intitulés ajoutent ~120 px à la colonne : sur un portable
            de 720 px, l'ancienne colonne rigide aurait poussé « Se déconnecter »
            sous le bord de l'écran.
          */}
          <div className="cf-scroll -mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            <nav className="mt-3 flex flex-col gap-3" aria-label="Navigation interne">
              {/* Le tableau de bord : au-dessus des intitulés, sans en porter
                  un — il résume les cinq domaines au lieu d'en habiter un. */}
              <LienColonne item={NAV_ACCUEIL} active={active} openLeads={openLeads} />

              {NAV_GROUPES.map((groupe) => (
                // `role="group"` + `aria-label` : le lecteur d'écran annonce le
                // domaine en entrant dedans. L'intitulé visible est donc
                // `aria-hidden`, sinon il serait lu deux fois de suite.
                <div key={groupe.titre} role="group" aria-label={groupe.titre}>
                  <div
                    className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut"
                    aria-hidden
                  >
                    {groupe.titre}
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    {groupe.items.map((item) => (
                      <LienColonne
                        key={item.href}
                        item={item}
                        active={active}
                        openLeads={openLeads}
                      />
                    ))}
                  </div>
                </div>
              ))}
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
          </div>

          <div className="mt-auto flex items-center gap-2.5 border-t border-line pt-3">
            {/* L'initiale se DÉRIVE du nom reçu ; le tiret est l'état
                d'attente, et celui de l'échec. Une lettre par défaut
                dessinerait la pastille de quelqu'un qui n'existe pas. */}
            <div
              className={cx(
                "grid size-[34px] shrink-0 place-items-center rounded-full bg-fill text-sm font-extrabold",
                initiale ? "text-accent" : "text-mut",
              )}
              aria-hidden
            >
              {initiale ?? "—"}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cx("truncate text-sm font-bold", nom ? "text-ink" : "text-mut")}>
                {nom ?? "—"}
              </div>
              <div className="truncate text-xs text-mut">{role}</div>
            </div>
            <IconBtn
              icon="logout"
              label="Se déconnecter"
              size={32}
              iconSize={15}
              onClick={logout}
            />
          </div>
        </aside>

        {/* ── Colonne titre + contenu ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sous `md`, le bandeau se CONDENSE : titre plus petit, date
              masquée (elle est sur le téléphone lui-même), pilule MRR
              resserrée — rien ne doit pousser la ligne à déborder. */}
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line2 bg-[image:var(--cf-card-gradient)] px-[26px] py-4 max-md:gap-2.5 max-md:px-4 max-md:py-2.5">
            <div className="min-w-0">
              {/* LE MÊME MOT que le lien cliqué : le titre n'est plus une
                  seconde façon de nommer l'écran, c'est `label`. */}
              <h1 className="truncate text-2xl font-extrabold tracking-[-0.03em] text-ink max-md:text-lg">
                {active.label}
              </h1>
              <p className="truncate text-sm text-mut max-md:hidden" suppressHydrationWarning>
                {fmtDateFr(new Date())} · interne Snack Manager
              </p>
            </div>
            <div className="flex min-w-0 shrink-0 items-center gap-3 max-md:gap-2">
              <AppearanceButton theme={theme} onToggle={toggleTheme} />
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
                        <span className="sr-only"> prospects en cours</span>
                      </span>
                    )}
                  </span>
                  {/* Le libellé vient de la table (`court` quand le nom
                      complet ne tient pas) : plus aucune coupe au rendu. */}
                  <span className="text-[10px] font-bold leading-none tracking-[-0.01em]">
                    {libelleCourt(item)}
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
                // sinon « File du jour » ou « Erreurs » sembleraient n'exister
                // nulle part.
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
          {/* LES MÊMES GROUPES ET LES MÊMES MOTS qu'au bureau : un écran
              cherché sous « Plateforme » sur l'ordinateur doit se retrouver
              sous « Plateforme » au pouce. */}
          <div className="flex flex-col gap-3">
            {MOBILE_MORE_GROUPES.map((groupe) => (
              <div key={groupe.titre} role="group" aria-label={groupe.titre}>
                <div
                  className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut"
                  aria-hidden
                >
                  {groupe.titre}
                </div>
                <div className="flex flex-col gap-0.5">
                  {groupe.items.map((item) => {
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
              </div>
            ))}
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
            {/* Même session, même état neutre que la barre de bureau : la
                feuille mobile en est une VUE, pas une seconde source. */}
            <div
              className={cx(
                "grid size-[34px] shrink-0 place-items-center rounded-full bg-fill text-sm font-extrabold",
                initiale ? "text-accent" : "text-mut",
              )}
              aria-hidden
            >
              {initiale ?? "—"}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cx("truncate text-sm font-bold", nom ? "text-ink" : "text-mut")}>
                {nom ?? "—"}
              </div>
              <div className="truncate text-xs text-mut">{role}</div>
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
 * UNE ENTRÉE DE LA COLONNE DE BUREAU — extraite parce qu'elle est désormais
 * rendue à deux endroits : le tableau de bord, seul au-dessus des intitulés, et
 * les entrées de chacun des cinq groupes.
 *
 * Le badge n'appartient qu'à la prospection : c'est le seul compteur qui
 * réclame un geste le jour même — un prospect ouvert qu'on ne rappelle pas se
 * refroidit.
 */
function LienColonne({
  item,
  active,
  openLeads,
}: {
  item: NavItem;
  active: NavItem;
  openLeads: number;
}) {
  const on = item.href === active.href;
  return (
    <Link
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
          <span className="sr-only"> prospects en cours</span>
        </span>
      )}
    </Link>
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
