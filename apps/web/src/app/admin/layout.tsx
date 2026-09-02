"use client";

/**
 * Shell du back-office (spec backoffice-restaurant §3) : sidebar overlay
 * rétractable 66↔232px (ne pousse pas le contenu), topbar, thème tenant.
 * L'accent de marque est injecté au runtime : fetch /tenants/me →
 * --cf-accent / --cf-on-accent sur <html> (marque grise, spec DS §4).
 *
 * LA COQUE NE DÉCIDE PLUS DE LA NAVIGATION : les groupes, les noms, les icônes
 * et les règles de visibilité vivent dans `./navigation`, qui se relit et se
 * teste sans monter React. Ici ne restent que le rendu et les deux faits que
 * la table réclame — quel rôle regarde, et si le compte est suspendu.
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
import { ACCOUNT_SUSPENDED_CODE, isAccessBlocked, type OrderStatus } from "@sm/contracts";
import { api, ApiError, clearToken, getToken, type TenantMe } from "@/lib/api";
import { isDemoActive } from "@/lib/demo";
import { BandeauDemo } from "@/lib/demo/BandeauDemo";
import { LogoMark } from "@/components/brand/Logo";
import { Splash } from "@/components/brand/Splash";
import { consommerSplashDeTransition } from "@/components/brand/SplashAuPremierPassage";
import { cx } from "@/lib/cx";
import { fmtDateFr } from "@/lib/format";
import { initialeDe, nomAffichable, useIdentite } from "@/lib/identite";
import { tenantAccentPalette } from "@/lib/tenant-accent";
import { useTenantSocket } from "@/lib/ws";
import { Icon, ToastProvider, useToast } from "@/components/ui";
import { clearAllEnrollmentRecoveries } from "./fidelite/clients/enrollment-recovery";
import {
  barreMobile,
  groupesMobileRestants,
  groupesVisibles,
  navActive,
} from "./navigation";
import { roleAdmin } from "./session";

const RAIL = 66;
const PANEL = 232;
const NAV_STORE = "sm-bo-nav";

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau de session : `sessionStorage` n'existe pas au rendu serveur, aucune valeur calculée au rendu ne peut donc le remplacer. Lu au rendu, il provoquerait un écart d'hydratation ; lu ici, il est consommé APRÈS le montage, une seule fois. Le supprimer rendrait l'ouverture d'après-connexion muette.
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
  const [suspendu, setSuspendu] = useState(false);
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

  /**
   * LE RÔLE — lu sur le jeton, sans appel réseau, comme `hasToken`.
   *
   * `null` en démonstration (le jeton l'est aussi, par conception) et pendant
   * le rendu serveur : la table de navigation traite ce cas en montrant la
   * barre COMPLÈTE, ce qui garde le rendu d'hydratation identique et évite de
   * faire clignoter des entrées au montage.
   */
  const role = useSyncExternalStore(emptySubscribe, () => roleAdmin(), () => null);

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

  // Avant le 24/08/2026, la seule « déconnexion » était de fermer l'onglet :
  // le jeton restait douze heures dans le navigateur — gênant sur un poste
  // partagé (un équipier qui emprunte la tablette du comptoir).
  const logout = () => {
    clearAllEnrollmentRecoveries();
    clearToken();
    router.replace("/admin/login");
  };

  // ── Volet de navigation mobile — ouvert depuis « Plus », jamais persisté ──
  //
  // Contrairement à la barre latérale de bureau (mémorisée dans localStorage),
  // ce volet est un GESTE : on l'ouvre pour choisir une page, il se referme
  // au choix, au clic sur le voile ou à Échap. Le mémoriser rouvrirait un
  // panneau plein écran par-dessus chaque retour dans l'application.
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  // ── Garde de session ──
  //
  // `mounted` évite de rediriger sur le rendu d'hydratation : localStorage
  // n'existe pas côté serveur, donc `hasToken` y vaut toujours false.
  //
  // La redirection `/admin` → tableau de bord vivait AUSSI ici, et c'était du
  // code mort : `admin/page.tsx` redirige côté serveur, avant que cette coque
  // ne soit montée. Les deux destinations divergeaient en silence (la page
  // envoyait vers la carte, la coque vers le tableau de bord) ; il n'en reste
  // qu'une, celle du serveur, et elle vise l'écran où mène déjà la connexion.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation : sa valeur DOIT différer entre le rendu serveur et le client, aucun calcul au rendu ne peut donc le produire. Dérivé, la garde lirait `hasToken === false` au premier rendu et renverrait vers /admin/login un gérant pourtant connecté.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!hasToken) router.replace("/admin/login");
  }, [mounted, hasToken, router]);

  // ── Tenant + thème (accent marque sur <html>) ──
  useEffect(() => {
    if (!hasToken) return;
    let cancelled = false;
    api
      .get<TenantMe>("/tenants/me")
      .then((t) => {
        if (cancelled) return;
        setTenant(t);
        // La règle de suspension n'est pas réécrite ici : `isAccessBlocked`
        // (@sm/contracts) la porte pour toute la maison — seul `suspended`
        // ferme, `churned` non.
        setSuspendu(isAccessBlocked(t.account?.status));
        const { accent, onAccent } = tenantAccentPalette(t.brandColor);
        const root = document.documentElement.style;
        root.setProperty("--cf-accent", accent);
        root.setProperty("--cf-on-accent", onAccent);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          clearAllEnrollmentRecoveries();
          clearToken();
          router.replace("/admin/login");
          return;
        }
        // LA SUSPENSION SE LIT SUR LE REFUS, PAS SUR LE TENANT.
        //
        // `GET /tenants/me` rend bien `account.status` — mais un compte
        // suspendu n'atteint jamais la route : le garde global le refuse
        // avant, et c'est ce refus qui porte le code. S'en remettre au seul
        // champ laisserait donc la barre proposer seize entrées qui
        // répondraient toutes la même chose, et laisserait invisible le seul
        // écran qui survit — celui qui porte le montant à régler.
        if (
          e instanceof ApiError &&
          e.status === 403 &&
          (e.body as { code?: string } | null)?.code === ACCOUNT_SUSPENDED_CODE
        ) {
          setSuspendu(true);
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
    // `GET /orders` rend `{ rows, total }`, JAMAIS un tableau nu. Le code
    // typait la réponse en tableau et se protégeait par `Array.isArray` : la
    // garde était donc toujours fausse, `setNewIds` n'était jamais appelé, et
    // le badge restait à zéro au chargement — sans erreur, sans journal. Le
    // gérant qui ouvrait son back-office ne voyait aucune commande en attente
    // tant qu'une nouvelle n'arrivait pas par le temps réel.
    api
      .get<{ rows?: { _id: string }[] }>("/orders?status=new")
      .then((res) => {
        const rows = res?.rows;
        if (!cancelled && Array.isArray(rows)) setNewIds(new Set(rows.map((o) => o._id)));
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

  // ── Ce que cette session voit de la barre ──
  //
  // Trois vues d'une seule table : la colonne de bureau, les cases sous le
  // pouce, et le volet « Plus » qui reprend les MÊMES groupes que la colonne.
  const groupes = useMemo(() => groupesVisibles({ role, suspendu }), [role, suspendu]);
  const barre = useMemo(() => barreMobile({ role, suspendu }), [role, suspendu]);
  const groupesPlus = useMemo(
    () => groupesMobileRestants({ role, suspendu }),
    [role, suspendu],
  );

  // ── Titre / sous-titre de la topbar ──
  //
  // Le titre est LE LIBELLÉ CLIQUÉ, cherché dans la table entière : un écran
  // que les règles masquent garde son nom si on y arrive par une adresse.
  const active = useMemo(() => navActive(pathname), [pathname]);
  const now = new Date();
  const subtitle = `${fmtDateFr(now)} · service du ${now.getHours() < 16 ? "midi" : "soir"}`;

  // ── Qui est connecté ──
  //
  // La personne, pas l'établissement : `tenant` ci-dessus ne dit que le
  // restaurant. Tant que la réponse n'est pas là — et si elle n'arrive
  // jamais — `nom` et `initiale` valent `null`, et le pied de barre affiche un
  // tiret à la place. Jamais « Le Gérant », qui n'était le nom de personne.
  //
  // EN DÉMONSTRATION, la coque appelle la route comme le reste : `hasToken`
  // est vrai (cf. `isDemoActive`), et `lib/demo/router.ts` répond la
  // propriétaire fictive du Comptoir. Le visiteur voit donc une barre
  // complète, cohérente avec les équipiers, les fournisseurs et les clients de
  // la fixture.
  const identite = useIdentite(hasToken);
  const nom = nomAffichable(identite);
  const initiale = initialeDe(identite);

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
    // `h-dvh` et non `h-screen` : sur téléphone, 100vh déborde derrière la
    // barre d'adresse et la barre basse perdrait ses derniers pixels sous elle.
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      {/*
        Anti-zoom iOS : Safari zoome toute la page au focus d'un champ dont le
        corps est sous 16 px. Les contrôles du DS sont à 14 px — très bien à la
        souris, piège au doigt. La règle vit ICI plutôt que dans chaque page :
        elle couvre d'un coup les formulaires, tiroirs et modales du
        back-office, sans toucher aux composants partagés avec /sm.
      */}
      {/*
        Deuxième règle — les MODALES sur petit écran : le panneau centré du DS
        n'a pas de défilement interne ; sur un téléphone court, un formulaire
        haut (promo, membre d'équipe) sortirait de l'écran, boutons compris.
        Le sélecteur vise le panneau de `Modal` (fils `.w-full` d'un dialogue
        en grille) et épargne les tiroirs, dont le panneau est ancré aux bords.
      */}
      <style>{`@media (max-width: 767px) {
        main input:not([type="checkbox"]):not([type="radio"]),
        main select,
        main textarea { font-size: 16px; }
        main [role="dialog"].grid > .w-full {
          max-height: calc(100dvh - 32px);
          overflow-y: auto;
        }
      }`}</style>
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

          Sous `md`, la barre disparaît entièrement (`max-md:hidden`) : même le
          rail de 66 px mangerait un sixième d'un écran de 390 px. La
          navigation passe alors dans la barre basse et son volet « Plus »,
          rendus en fin de coque.
        */}
        <div
          className="relative z-[45] w-[var(--sm-rail)] shrink-0 transition-[width] duration-[280ms] ease-[var(--sm-ease)] max-md:hidden motion-reduce:transition-none xl:w-[var(--sm-panel)]"
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

            {/*
              ── SEPT INTITULÉS, LÀ OÙ « GESTION » COIFFAIT SEIZE ENTRÉES ──

              Intitulés au format DA §2 : 11px, 600, capitales, .06em, gris.
              Barre REPLIÉE, il n'y a plus la place d'un mot : chaque groupe se
              dit alors par un filet. Le rythme des groupes survit donc au rail
              de 66 px, et l'icône d'un écran garde sa position, dépliée ou non.
            */}
            <nav
              className="cf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden"
              aria-label="Navigation principale"
            >
              {groupes.map((groupe) => (
                // `role="group"` + `aria-label` : le lecteur d'écran annonce le
                // domaine en entrant dedans. L'intitulé visible est donc
                // `aria-hidden`, sinon il serait lu deux fois — et il n'existe
                // pas du tout barre repliée.
                <div key={groupe.titre} role="group" aria-label={groupe.titre}>
                  {open ? (
                    <div
                      className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut"
                      aria-hidden
                    >
                      {groupe.titre}
                    </div>
                  ) : (
                    <div className="mx-1 mb-2.5 h-px shrink-0 bg-line" aria-hidden />
                  )}
                  <div className="flex flex-col gap-[3px]">
                    {groupe.items.map((item) => {
                      const isActive = pathname.startsWith(item.href);
                      const badge = item.href === "/admin/orders" && newCount > 0;
                      return (
                        <Link
                          key={item.href}
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
                  </div>
                </div>
              ))}
            </nav>

            {/* Pied : la personne connectée + sortie + réduire */}
            <div
              className={cx(
                "mt-auto flex shrink-0 items-center gap-2.5 border-t border-line pt-3",
                !open && "flex-col",
              )}
            >
              {/* L'initiale se DÉRIVE du nom reçu. Le tiret est l'état
                  d'attente — et celui de l'échec : une lettre par défaut
                  dessinerait la pastille de quelqu'un qui n'existe pas. */}
              <div
                className={cx(
                  "grid size-[34px] shrink-0 place-items-center rounded-full text-[15px] font-extrabold",
                  // La pastille neutre ne peut pas être `bg-fill` : c'est la
                  // couleur de la barre elle-même, elle y disparaîtrait.
                  initiale
                    ? "bg-accent text-onaccent"
                    : "border border-white/12 bg-white/6 text-mut",
                )}
                aria-hidden
              >
                {initiale ?? "—"}
              </div>
              {open && (
                <div className="min-w-0 flex-1">
                  {/* Le nom de la personne connectée, enfin : `GET /auth/me`
                      le rend, `GET /tenants/me` ne rendait que le restaurant.
                      La ligne garde sa hauteur avant l'arrivée de la réponse —
                      la barre ne doit pas sauter sous les doigts. */}
                  <div
                    className={cx(
                      "truncate text-sm font-bold",
                      nom ? "text-ink" : "text-mut",
                    )}
                  >
                    {nom ?? "—"}
                  </div>
                  <div className="truncate text-xs text-mut">{city}</div>
                </div>
              )}
              {/*
                ═══ LE ROUAGE A DISPARU D'ICI, ET C'EST LE POINT ═══

                Il était la SEULE porte vers `/admin/settings` : muette, sans
                libellé, en pied de barre, collée à la déconnexion. L'écran
                n'étant dans aucune liste, la barre de titre affichait
                « Back-office » une fois dedans — le seul écran du produit sans
                nom.

                Il s'appelle désormais « Établissement » et vit dans le groupe
                « Réglages », avec un nom, une icône et un lien qui se surligne.
                Le garder ici en plus laisserait deux portes vers le même écran
                dont l'une n'apprend rien, à un pixel du seul geste qu'un
                mis-clic rend coûteux.
              */}
              {/* La sortie teinte vers l'alerte au survol : dernière icône du
                  pied, elle ne doit pas se confondre avec le repli. */}
              <button
                type="button"
                onClick={logout}
                title="Se déconnecter"
                aria-label="Se déconnecter"
                className="cf-press shrink-0 text-mut hover:text-alertt"
              >
                <Icon name="logout" size={17} />
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
                "mt-3 flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-mut",
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
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line2 bg-[image:var(--cf-card-gradient)] px-4 py-3 md:gap-4 md:px-[26px] md:py-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-extrabold tracking-[-0.03em] text-ink md:text-2xl">
                {active.label}
              </h1>
              <p className="truncate text-sm text-mut" suppressHydrationWarning>
                {subtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {/* La recherche globale « présente, non câblée » a été RETIRÉE
                  (24/08/2026) : un champ qui avale une requête sans répondre
                  se lit comme une panne. Elle reviendra branchée. */}

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

              {/* La cloche « Notifications » a été RETIRÉE (24/08/2026) : elle
                  ne faisait rien depuis la v1, et un bouton mort coûte plus
                  cher qu'un bouton absent — il promet, il déçoit, il fait
                  appeler. Elle reviendra portée par un vrai flux. */}
            </div>
          </header>

          {/* Zone de contenu — `relative` : les Drawer s'y positionnent en absolu.
              `overflow-x-hidden` : garde-fou mobile — un tableau qui déborde
              défile dans SON conteneur, jamais en panoramique sur la page. */}
          <main className="cf-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-bg">
            {children}
          </main>
        </div>
      </div>

      {/*
        ── Barre basse mobile : les gestes quotidiens sous le pouce ──

        Sous `md` seulement. EN FLUX dans la colonne — pas en `fixed` — pour ne
        jamais recouvrir la fin du contenu : la zone de défilement s'arrête
        au-dessus d'elle par construction. Le dégagement d'encoche
        (`safe-area-inset-bottom`) s'ajoute SOUS les boutons, qui gardent leurs
        52 px de zone tactile pleine.
      */}
      <nav
        aria-label="Navigation rapide"
        className="z-[45] flex shrink-0 border-t border-line2 bg-[image:var(--cf-card-gradient)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {barre.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const badge = item.href === "/admin/orders" && newCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cx(
                "cf-press flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px]",
                isActive ? "font-extrabold text-accent" : "font-semibold text-mut",
              )}
            >
              <span className="relative">
                <Icon name={item.icon} size={20} stroke={isActive ? 2.3 : 2} />
                {badge && (
                  <span className="cf-fig absolute -right-2.5 -top-1.5 rounded-pill bg-gold px-[5px] text-[10px] font-extrabold leading-[15px] text-[#1C1612]">
                    {newCount}
                    <span className="sr-only"> nouvelles commandes</span>
                  </span>
                )}
              </span>
              {/* LE NOM DE LA TABLE, tel quel : il n'existe plus de libellé
                  court à côté. C'est lui qui faisait diverger les noms —
                  « Menu & prix » devenait « Carte » ici, « Tableau de bord »
                  devenait « Accueil ». Les deux écrans portent désormais le
                  nom court dans la table, et il tient dans la cellule. */}
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={cx(
            "cf-press flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px]",
            // « Plus » s'allume quand la page ouverte vit dans SON volet : le
            // gérant sur « Avis » doit voir d'où il est venu.
            groupesPlus.some((g) => g.items.some((n) => n.href === active.href))
              ? "font-extrabold text-accent"
              : "font-semibold text-mut",
          )}
        >
          <span aria-hidden className="grid h-5 place-items-center text-[19px] font-extrabold leading-none tracking-[0.1em]">
            ⋯
          </span>
          <span className="max-w-full truncate">Plus</span>
        </button>
      </nav>

      {/*
        ── Volet « Plus » : la navigation complète, en surimpression ──

        La sœur mobile de la barre latérale : mêmes entrées, mêmes badges,
        même pied. Elle glisse depuis la droite — le pouce est déjà sur
        « Plus », en bas à droite — et se referme au voile, à Échap, ou au
        choix d'une page (chaque lien referme dans son onClick : pas d'effet
        sur `pathname`, la fermeture appartient au geste).
      */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[70] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation principale"
        >
          <div
            className="absolute inset-0 animate-[cf-fade_.22s_var(--sm-ease)_both] bg-black/55"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 right-0 flex w-[290px] max-w-[86vw] animate-[cf-slide-in_.26s_var(--sm-ease)_both] flex-col overflow-hidden border-l border-line bg-fill px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-[18px]">
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <div
                className="grid size-[30px] shrink-0 place-items-center rounded-xs bg-accent text-[15px] font-extrabold text-onaccent"
                aria-hidden
              >
                {initial}
              </div>
              <div className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">
                {tenant?.name ?? "…"}
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Fermer le menu"
                className="cf-press grid size-11 shrink-0 place-items-center rounded-xs text-mut hover:text-white"
              >
                <Icon name="close" size={17} />
              </button>
            </div>

            {/* LES MÊMES GROUPES ET LES MÊMES MOTS qu'au bureau : un écran
                cherché sous « Présence » à l'ordinateur doit se retrouver sous
                « Présence » au pouce. Le volet ne rejoue donc pas la liste
                plate de seize qu'il rejouait — et les groupes que la barre
                basse a vidés n'y figurent pas : un intitulé sans entrée est un
                cul-de-sac. */}
            <nav
              className="cf-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden"
              aria-label="Navigation principale"
            >
              {groupesPlus.map((groupe) => (
                <div key={groupe.titre} role="group" aria-label={groupe.titre}>
                  <div
                    className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-mut"
                    aria-hidden
                  >
                    {groupe.titre}
                  </div>
                  <div className="flex flex-col gap-[3px]">
                    {groupe.items.map((item) => {
                      const isActive = pathname.startsWith(item.href);
                      const badge = item.href === "/admin/orders" && newCount > 0;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={isActive ? "page" : undefined}
                          className={cx(
                            "cf-press-row flex shrink-0 items-center gap-2.5 rounded-ctrl px-3 py-3 text-sm",
                            isActive
                              ? "bg-accent font-extrabold text-onaccent shadow-card"
                              : "font-semibold text-white/70",
                          )}
                        >
                          <Icon
                            name={item.icon}
                            size={18}
                            stroke={isActive ? 2.3 : 2}
                            className="shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                            {item.label}
                          </span>
                          {badge && (
                            <span className="cf-fig shrink-0 rounded-pill bg-gold px-[7px] py-px text-[11px] font-extrabold text-[#1C1612]">
                              {newCount}
                              <span className="sr-only"> nouvelles commandes</span>
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="mt-auto flex shrink-0 items-center gap-2.5 border-t border-line pt-3">
              {/* Même identité que la barre de bureau, même état neutre :
                  le volet mobile est une VUE de la même session, pas une
                  seconde source. Voir son pied pour le raisonnement. */}
              <div
                className={cx(
                  "grid size-[34px] shrink-0 place-items-center rounded-full text-[15px] font-extrabold",
                  // La pastille neutre ne peut pas être `bg-fill` : c'est la
                  // couleur de la barre elle-même, elle y disparaîtrait.
                  initiale
                    ? "bg-accent text-onaccent"
                    : "border border-white/12 bg-white/6 text-mut",
                )}
                aria-hidden
              >
                {initiale ?? "—"}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={cx(
                    "truncate text-sm font-bold",
                    nom ? "text-ink" : "text-mut",
                  )}
                >
                  {nom ?? "—"}
                </div>
                <div className="truncate text-xs text-mut">{city}</div>
              </div>
              {/* Pas de rouage ici non plus — « Établissement » est au-dessus,
                  dans le groupe « Réglages ». Voir le pied de la barre de
                  bureau pour le raisonnement complet. */}
              <button
                type="button"
                onClick={logout}
                title="Se déconnecter"
                aria-label="Se déconnecter"
                className="cf-press grid size-11 shrink-0 place-items-center text-mut hover:text-alertt"
              >
                <Icon name="logout" size={17} />
              </button>
            </div>

            {/* Même signature discrète que la barre de bureau — voir le
                plaidoyer complet au-dessus de sa jumelle. */}
            <div className="mt-3 flex shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium text-mut">
              <LogoMark size={14} className="shrink-0" />
              <span className="min-w-0 truncate whitespace-nowrap">
                Snack Manager
              </span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
