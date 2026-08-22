"use client";

/**
 * Vue « Écrans TV » — le Menu Board vu du back-office.
 *
 * L'API et l'affichage existaient déjà ; il manquait l'endroit où l'on crée un
 * écran et où l'on récupère son code. Trois partis pris :
 *
 *  — l'ÉTAT est la donnée principale. Un écran de salle n'a qu'un incident
 *    possible : se taire. La liste se rafraîchit donc toute seule toutes les
 *    30 secondes, sans que le gérant ait à recharger quoi que ce soit ;
 *  — le CODE est montré en très gros à la création, avec l'adresse exacte à
 *    ouvrir sur la télévision. À cet instant le restaurateur est debout devant
 *    son écran, escabeau sorti : il ne doit rien avoir à chercher ;
 *  — le DAYPARTING est expliqué, pas seulement subi. La convention « midi » /
 *    « soir » sur les étiquettes produit ne se devine pas.
 *
 * API : GET/POST /screens · PATCH/DELETE /screens/:id ·
 *       POST /screens/:id/regenerate-code · GET /menu
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  SCREEN_ORIENTATIONS,
  SCREEN_ORIENTATION_LABELS,
  SCREEN_THEMES,
  SCREEN_THEME_LABELS,
  type ScreenOrientation,
  type ScreenTheme,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";
import {
  Btn,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  Panel,
  Select,
  Skeleton,
  useToast,
} from "@/components/ui";
import {
  CodeCountdown,
  CopyBtn,
  DaypartNote,
  InstallSteps,
  PairingCode,
  PAIRING_TTL_LABEL,
  useNow,
} from "./parts";
import { PlaylistDrawer } from "./playlist-drawer";
import { ScreenCard } from "./screen-card";
import type { MenuData, ScreenView } from "./types";

/** Cadence de rafraîchissement de la liste — l'état reste juste sans action. */
const REFRESH_MS = 30_000;

/** Store qui n'émet jamais : l'origine du navigateur ne change pas de la session. */
const NEVER_CHANGES = () => () => {};

export default function ScreensPage() {
  const toast = useToast();
  const now = useNow(REFRESH_MS);

  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [screens, setScreens] = useState<ScreenView[]>([]);
  /** `null` = carte non chargée (l'échec n'est pas bloquant, il est dit). */
  const [menu, setMenu] = useState<MenuData | null>(null);

  // L'adresse à ouvrir sur la TV est celle DE CETTE INSTANCE : en production
  // comme en démo, on donne l'origine réellement servie plutôt qu'une constante
  // qui finirait par mentir. Lue comme un store externe (même procédé que le
  // shell admin pour le jeton) : vide côté serveur, sans écart d'hydratation.
  //
  // ⚠️ CECI DÉPEND DU PROXY, ET LA DÉPENDANCE EST INVISIBLE D'ICI. Depuis le
  // 22/08/2026, `src/proxy.ts` refuse `/admin` ET `/board` sur un domaine de
  // restaurant : cette page ne s'affiche donc QUE sur une origine de la
  // plateforme, et l'adresse qu'on imprime ici est forcément servie.
  //
  // Rouvrir `/admin` sur les domaines clients sans rouvrir `/board` produirait
  // une panne sourde : le gérant lirait « ouvrez laclassfood.fr/board » sur sa
  // télévision, et l'adresse répondrait par une redirection vers la carte.
  // Pire, l'appairage étant rangé dans le `localStorage` DE L'ORIGINE
  // (`board-store.ts`), un écran appairé sur un domaine ne l'est pas sur
  // l'autre — le rebranchement se ferait en plein service.
  const origin = useSyncExternalStore(
    NEVER_CHANGES,
    () => window.location.origin,
    () => "",
  );
  const boardUrl = `${origin}/board`;

  // ── Dialogues ──
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    orientation: ScreenOrientation;
    theme: ScreenTheme;
  }>({ name: "", orientation: "landscape", theme: "brand" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [installId, setInstallId] = useState<string | null>(null);
  const [installFresh, setInstallFresh] = useState(false);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [composeId, setComposeId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  function openCompose(id: string) {
    setComposeId(id);
  }

  const byId = useCallback(
    (id: string | null) => (id ? (screens.find((s) => s.id === id) ?? null) : null),
    [screens],
  );
  const installScreen = byId(installId);
  const regenScreen = byId(regenId);
  const deleteScreen = byId(deleteId);
  const composeScreen = byId(composeId);

  // ── Chargement ──

  const loadScreens = useCallback(async () => {
    setScreens(await api.get<ScreenView[]>("/screens"));
  }, []);

  const load = useCallback(async () => {
    try {
      await loadScreens();
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
    // La carte n'est utile qu'au sélecteur de catégories et à la note sur le
    // dayparting : son échec ne doit pas emporter la page.
    try {
      setMenu(await api.get<MenuData>("/menu"));
    } catch {
      setMenu(null);
    }
  }, [loadScreens]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : écrans et carte viennent du réseau, et c'est `load` qui fait passer `loadState` à « ready », donc qui arme le rafraîchissement silencieux ci-dessous. Le casser figerait les compteurs « hors ligne depuis N min ».
    void load();
  }, [load]);

  /**
   * Rafraîchissement silencieux : ni squelette, ni message d'erreur. Un écran
   * « hors ligne depuis 22 min » doit devenir « 23 min » tout seul, et un
   * appairage réussi sur la télévision doit se voir ici sans clic. Une panne
   * réseau passagère laisse simplement la dernière valeur connue affichée.
   */
  useEffect(() => {
    if (loadState !== "ready") return;
    const refresh = () => {
      void loadScreens().catch(() => {});
    };
    const id = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [loadState, loadScreens]);

  const retry = () => {
    setLoadState("loading");
    void load();
  };

  const replace = (updated: ScreenView) =>
    setScreens((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

  // ── Mutations ──

  function openCreate() {
    setDraft({ name: "", orientation: "landscape", theme: "brand" });
    setCreateError(null);
    setCreating(true);
  }

  async function submitCreate() {
    const name = draft.name.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await api.post<ScreenView>("/screens", {
        name,
        orientation: draft.orientation,
        theme: draft.theme,
      });
      setScreens((prev) => [...prev, created]);
      setCreating(false);
      // On enchaîne SANS transition sur le code : c'est l'instant critique de
      // l'installation, et il n'y a rien d'autre à faire à cette seconde.
      setInstallFresh(true);
      setInstallId(created.id);
      toast("Écran créé — voici son code d'appairage", { icon: "check" });
    } catch (e) {
      setCreateError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Création impossible — réessayez",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRegenerate() {
    if (!regenScreen || regenerating) return;
    setRegenerating(true);
    try {
      const updated = await api.post<ScreenView>(
        `/screens/${regenScreen.id}/regenerate-code`,
      );
      replace(updated);
      setRegenId(null);
      // Un nouveau code n'a de valeur qu'accompagné de la marche à suivre.
      setInstallFresh(false);
      setInstallId(updated.id);
      toast("Nouveau code généré — l'ancien appareil est révoqué", { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Génération impossible — réessayez");
    } finally {
      setRegenerating(false);
    }
  }

  async function confirmDelete() {
    if (!deleteScreen || deleting) return;
    setDeleting(true);
    const { id, name } = deleteScreen;
    try {
      await api.del(`/screens/${id}`);
      setScreens((prev) => prev.filter((s) => s.id !== id));
      setDeleteId(null);
      if (installId === id) setInstallId(null);
      if (composeId === id) setComposeId(null);
      toast(`Écran « ${name} » supprimé`, { icon: "check" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Suppression impossible — réessayez");
    } finally {
      setDeleting(false);
    }
  }

  const summary = useMemo(() => {
    const waiting = screens.filter((s) => !s.paired).length;
    const offline = screens.filter((s) => s.paired && !s.online).length;
    if (screens.length === 0) return "Aucun écran configuré";
    const parts = [`${screens.length} écran${screens.length > 1 ? "s" : ""}`];
    if (waiting > 0) parts.push(`${waiting} en attente d'appairage`);
    if (offline > 0) parts.push(`${offline} hors ligne`);
    parts.push("état actualisé toutes les 30 s");
    return parts.join(" · ");
  }, [screens]);

  // ─── Chargement / erreur ───

  if (loadState === "loading")
    return (
      <div className="grid grid-cols-1 items-start gap-4 p-[26px] xl:grid-cols-[1.25fr_0.75fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[260px]" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[280px]" />
          <Skeleton className="h-[240px]" />
        </div>
      </div>
    );

  if (loadState === "error")
    return (
      <div className="p-[26px]">
        <Card>
          <EmptyState
            icon="search"
            title="Impossible de charger vos écrans"
            hint="Vérifiez votre connexion puis réessayez."
            action={
              <Btn variant="ghost" size="sm" onClick={retry}>
                Réessayer
              </Btn>
            }
          />
        </Card>
      </div>
    );

  return (
    <div
      ref={rootRef}
      className="grid grid-cols-1 items-start gap-4 p-[26px] xl:grid-cols-[1.25fr_0.75fr]"
    >
      {/* ── Colonne principale : les écrans ── */}
      <section className="flex min-w-0 flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
              Vos écrans de salle
            </h2>
            <p className="mt-0.5 text-[13px] text-mut">{summary}</p>
          </div>
          <Btn icon="plus" onClick={openCreate}>
            Ajouter un écran
          </Btn>
        </div>

        {screens.length === 0 ? (
          <Card>
            <EmptyState
              icon="tv"
              title="Aucun écran — ajoutez votre premier écran de salle"
              hint="Une clé HDMI, un téléviseur, six caractères à saisir : votre carte s'affiche en salle et suit vos prix automatiquement."
              action={
                <Btn icon="plus" onClick={openCreate}>
                  Ajouter un écran
                </Btn>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {screens.map((screen) => (
              <ScreenCard
                key={screen.id}
                screen={screen}
                now={now}
                onInstall={() => {
                  setInstallFresh(false);
                  setInstallId(screen.id);
                }}
                onCompose={() => openCompose(screen.id)}
                onRegenerate={() => setRegenId(screen.id)}
                onDelete={() => setDeleteId(screen.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Colonne d'aide ── */}
      <div className="flex flex-col gap-4">
        <Panel
          title="Installer un écran"
          sub="Trois gestes devant le téléviseur"
        >
          <InstallSteps boardUrl={boardUrl} />
          <p className="mt-4 border-t border-line2 pt-3.5 text-[13px] text-mut">
            Vous n&apos;avez rien à ressaisir&nbsp;: l&apos;écran affiche votre
            carte telle qu&apos;elle est en base. Un prix modifié dans
            «&nbsp;Menu &amp; prix&nbsp;» apparaît en salle dans la minute.
          </p>
        </Panel>

        <Panel
          title="Midi et soir"
          sub="Ce qui s'affiche dépend du service en cours"
        >
          <DaypartNote menu={menu} />
        </Panel>
      </div>

      {/* ── Création ── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Ajouter un écran"
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Btn>
            <Btn
              disabled={submitting || !draft.name.trim()}
              onClick={() => void submitCreate()}
            >
              {submitting ? "Création…" : "Créer l'écran"}
            </Btn>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <Field
            label="Nom de l'écran"
            htmlFor="screen-name"
            error={createError}
            hint="Pour vous y retrouver quand vous en aurez plusieurs : « Au-dessus du comptoir », « Vitrine »…"
          >
            <Input
              id="screen-name"
              value={draft.name}
              maxLength={60}
              autoFocus
              placeholder="Au-dessus du comptoir"
              onChange={(e) => {
                setDraft((d) => ({ ...d, name: e.target.value }));
                setCreateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCreate();
              }}
            />
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Orientation" htmlFor="screen-orientation">
              <Select
                id="screen-orientation"
                value={draft.orientation}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    orientation: e.target.value as ScreenOrientation,
                  }))
                }
              >
                {SCREEN_ORIENTATIONS.map((o) => (
                  <option key={o} value={o}>
                    {SCREEN_ORIENTATION_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Thème" htmlFor="screen-theme">
              <Select
                id="screen-theme"
                value={draft.theme}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, theme: e.target.value as ScreenTheme }))
                }
              >
                {SCREEN_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {SCREEN_THEME_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <p className="rounded-ctrl border border-line2 bg-surface2 px-3.5 py-2.5 text-[13px] leading-relaxed text-mut">
            Votre boucle est pré-remplie avec vos catégories et vos offres du
            moment&nbsp;: l&apos;écran affiche votre carte dès la première
            seconde. Vous pourrez la recomposer ensuite.
          </p>
        </div>
      </Modal>

      {/* ── Marche à suivre + code ── */}
      <Modal
        open={installScreen !== null}
        onClose={() => setInstallId(null)}
        width={600}
        title={
          installScreen?.paired
            ? `« ${installScreen.name} » est appairé`
            : installFresh
              ? "Écran créé — installez-le maintenant"
              : `Installer « ${installScreen?.name ?? ""} »`
        }
        footer={
          <>
            {installScreen && !installScreen.paired && (
              <Btn
                variant="ghost"
                onClick={() => {
                  setInstallId(null);
                  setRegenId(installScreen.id);
                }}
              >
                Générer un nouveau code
              </Btn>
            )}
            <Btn variant="ink" onClick={() => setInstallId(null)}>
              Terminé
            </Btn>
          </>
        }
      >
        {installScreen &&
          (installScreen.paired ? (
            /* L'appairage est arrivé pendant que la modale était ouverte : le
               gérant a tapé le code sur sa télévision et voit ici la
               confirmation, sans avoir à redescendre vérifier. */
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <div className="grid size-12 place-items-center rounded-pill bg-ok text-white">
                <Icon name="check" size={24} />
              </div>
              <p className="text-sm font-bold text-ink">
                L&apos;écran affiche votre carte
              </p>
              <p className="max-w-[380px] text-[13px] text-mut">
                Il repartira tout seul après une coupure de courant. Vous pouvez
                maintenant composer la boucle des scènes.
              </p>
            </div>
          ) : (
            // Le contenu est long par nature (code + trois étapes) : sur un
            // portable peu haut il défile plutôt que de déborder de l'écran.
            <div className="cf-scroll flex max-h-[calc(100vh-200px)] flex-col gap-4 overflow-y-auto">
              {/*
                Puits SOMBRE sous les tuiles du code : celles-ci valent #1a1a1a,
                et un support de la même valeur les ferait disparaître (DA §1).
              */}
              <div className="rounded-card border border-white/10 bg-black/35 px-4 py-4">
                <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
                  Code à saisir sur le téléviseur
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {installScreen.pairing ? (
                    <>
                      <PairingCode
                        code={installScreen.pairing.code}
                        dimmed={installScreen.pairing.expired}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <CodeCountdown
                          expiresAt={installScreen.pairing.expiresAt}
                          expired={installScreen.pairing.expired}
                        />
                        <CopyBtn
                          value={installScreen.pairing.code}
                          what="Le code"
                          variant="ink"
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-[13px] text-mut">
                      Aucun code actif. Générez-en un nouveau ci-dessous.
                    </p>
                  )}
                </div>
                {installScreen.pairing?.expired && (
                  <p className="mt-3 border-t border-line2 pt-3 text-[13px] text-alertt">
                    Ce code a expiré&nbsp;: un code affiché sur un écran de salle
                    est un secret exposé au public, il ne vit que{" "}
                    {PAIRING_TTL_LABEL}. Générez-en un nouveau.
                  </p>
                )}
              </div>

              <InstallSteps
                boardUrl={boardUrl}
                code={
                  installScreen.pairing && !installScreen.pairing.expired
                    ? installScreen.pairing.code
                    : undefined
                }
              />

              <p className="border-t border-line2 pt-3.5 text-[13px] text-mut">
                Le code n&apos;est valable que {PAIRING_TTL_LABEL}. Passé ce
                délai, revenez ici et générez-en un nouveau&nbsp;: l&apos;écran,
                lui, n&apos;a rien à refaire.
              </p>
            </div>
          ))}
      </Modal>

      {/* ── Régénération (révoque l'appareil appairé) ── */}
      <Modal
        open={regenScreen !== null}
        onClose={() => setRegenId(null)}
        title="Générer un nouveau code"
        destructive
        width={480}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setRegenId(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={regenerating}
              onClick={() => void confirmRegenerate()}
            >
              {regenerating ? "Génération…" : "Générer un nouveau code"}
            </Btn>
          </>
        }
      >
        {regenScreen && (
          <div className="flex flex-col gap-3">
            {regenScreen.paired ? (
              <>
                {/* Bloc rouge sans icône, comme les autres avertissements du
                    back-office : la couleur porte déjà le signal. */}
                <div className="rounded-ctrl border border-alert/40 bg-alert/10 px-3.5 py-3">
                  <p className="text-[13px] leading-relaxed text-alertt">
                    <span className="font-bold">
                      L&apos;appareil actuellement appairé sera révoqué.
                    </span>{" "}
                    «&nbsp;{regenScreen.name}&nbsp;» cessera immédiatement
                    d&apos;afficher votre carte et il faudra ressaisir le
                    nouveau code sur le téléviseur.
                  </p>
                </div>
                <p className="text-[13px] leading-relaxed text-mut">
                  Ne le faites que pour{" "}
                  <span className="font-semibold text-ink">
                    remplacer une clé HDMI perdue ou volée
                  </span>{" "}
                  : c&apos;est le seul geste qui empêche l&apos;ancien appareil
                  de continuer à lire votre carte. Pour un simple écran figé,
                  débranchez et rebranchez la clé — elle repart seule.
                </p>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-mut">
                Un nouveau code à six caractères remplacera le précédent, valable{" "}
                {PAIRING_TTL_LABEL}. L&apos;ancien code cessera de fonctionner —
                si vous l&apos;avez déjà tapé sur le téléviseur, laissez-le
                plutôt aboutir.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ── Suppression ── */}
      <Modal
        open={deleteScreen !== null}
        onClose={() => setDeleteId(null)}
        title="Supprimer cet écran"
        destructive
        width={460}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleteId(null)}>
              Annuler
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Suppression…" : "Supprimer l'écran"}
            </Btn>
          </>
        }
      >
        {deleteScreen && (
          <p className="leading-relaxed">
            «&nbsp;{deleteScreen.name}&nbsp;» sera retiré définitivement, avec sa
            boucle de {deleteScreen.sceneCount} scène
            {deleteScreen.sceneCount > 1 ? "s" : ""}.
            {deleteScreen.paired
              ? " Le téléviseur cessera d'afficher votre carte dans la minute."
              : " Son code d'appairage cessera de fonctionner."}{" "}
            Votre carte, elle, n&apos;est pas touchée.
          </p>
        )}
      </Modal>

      {/* ── Composition de la boucle ── */}
      {composeScreen && (
        <PlaylistDrawer
          key={composeScreen.id}
          screen={composeScreen}
          menu={menu}
          onClose={() => setComposeId(null)}
          onSaved={replace}
        />
      )}
    </div>
  );
}
