"use client";

/**
 * COMPOSITION DE LA BOUCLE — l'ordre des scènes d'un écran.
 *
 * Le brouillon est local et n'est envoyé qu'à l'enregistrement : réordonner
 * vingt scènes déclencherait autrement vingt PATCH et vingt toasts, sur un
 * réseau de restaurant qui n'en demande pas tant. Tant que rien n'est
 * enregistré, l'écran continue d'afficher sa boucle actuelle.
 *
 * API : PATCH /screens/:id { playlist }
 */

import { useMemo, useState } from "react";
import { SCENE_DURATION_DEFAULT_MS, PROMO_SCENE_DURATION_MS } from "@sm/contracts";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import {
  Btn,
  Drawer,
  EmptyState,
  Icon,
  Modal,
  Pill,
  Select,
  useToast,
} from "@/components/ui";
import { MaxLinesNote } from "./parts";
import {
  categoryName,
  DURATION_CHOICES,
  fmtDuration,
  fmtLoop,
  loopMs,
  moveScene,
  SCENE_KIND_LABELS,
  type MenuData,
  type ScreenScene,
  type ScreenView,
} from "./types";

/** Petit bouton carré d'une ligne de scène (monter, descendre, retirer). */
function RowBtn({
  icon,
  label,
  onClick,
  disabled,
  danger = false,
  rotate,
}: {
  icon: "arrow" | "close";
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  rotate?: "up" | "down";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "cf-press grid size-7 shrink-0 place-items-center rounded-ctrl border border-line2 text-mut",
        "hover:border-white/25 hover:bg-white/8 hover:text-white",
        "disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:border-line2 disabled:hover:bg-transparent disabled:hover:text-mut",
        danger && "hover:border-alert/50 hover:text-alertt",
      )}
    >
      <Icon
        name={icon}
        size={14}
        className={cx(rotate === "up" && "-rotate-90", rotate === "down" && "rotate-90")}
      />
    </button>
  );
}

export function PlaylistDrawer({
  screen,
  menu,
  onClose,
  onSaved,
}: {
  screen: ScreenView;
  menu: MenuData | null;
  onClose: () => void;
  onSaved: (updated: ScreenView) => void;
}) {
  const toast = useToast();
  const [base, setBase] = useState<ScreenScene[]>(screen.playlist);
  const [draft, setDraft] = useState<ScreenScene[]>(screen.playlist);
  const [pending, setPending] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(base),
    [draft, base],
  );

  const usedCategories = useMemo(
    () =>
      new Set(
        draft
          .filter((s) => s.kind === "category" && s.categoryId)
          .map((s) => s.categoryId as string),
      ),
    [draft],
  );

  // Une catégorie sans produit ferait une scène blanche de dix secondes au
  // milieu de la boucle : elle n'est pas proposée.
  const addable = useMemo(
    () =>
      (menu?.categories ?? []).filter(
        (c) => (c.products?.length ?? 0) > 0 && !usedCategories.has(c._id),
      ),
    [menu, usedCategories],
  );

  const hasPromo = draft.some((s) => s.kind === "promo");

  function patch(index: number, changes: Partial<ScreenScene>) {
    setDraft((prev) => prev.map((s, i) => (i === index ? { ...s, ...changes } : s)));
  }

  function addCategory() {
    const category = addable.find((c) => c._id === pending);
    if (!category) return;
    setDraft((prev) => [
      ...prev,
      {
        kind: "category",
        categoryId: category._id,
        productIds: [],
        title: category.name,
        durationMs: SCENE_DURATION_DEFAULT_MS,
      },
    ]);
    setPending("");
  }

  function addPromo() {
    setDraft((prev) => [
      {
        kind: "promo",
        categoryId: null,
        productIds: [],
        title: "Offres du moment",
        durationMs: PROMO_SCENE_DURATION_MS,
      },
      ...prev,
    ]);
  }

  async function save() {
    if (saving || draft.length === 0) return;
    setSaving(true);
    try {
      const updated = await api.patch<ScreenView>(`/screens/${screen.id}`, {
        playlist: draft,
      });
      setBase(updated.playlist);
      setDraft(updated.playlist);
      onSaved(updated);
      toast(
        `Boucle enregistrée — ${updated.sceneCount} scène${updated.sceneCount > 1 ? "s" : ""}`,
        { icon: "check" },
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Enregistrement impossible — réessayez");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Le voile et la croix du tiroir ferment sans prévenir : un clic à côté
   * effacerait vingt minutes de réordonnancement. On demande confirmation dès
   * qu'il y a quelque chose à perdre — et seulement dans ce cas.
   */
  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());

  return (
    <Drawer
      open
      onClose={requestClose}
      title={screen.name}
      width={580}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-mut">
            {draft.length === 0
              ? "Ajoutez au moins une scène"
              : dirty
                ? "Modifications non enregistrées"
                : "Boucle à jour"}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={requestClose}>
              Fermer
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              icon="check"
              disabled={!dirty || saving || draft.length === 0}
              onClick={() => void save()}
            >
              {saving ? "Enregistrement…" : "Enregistrer la boucle"}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-[18px]">
        {/* ── L'ordre EST la boucle : la seule phrase à ne pas omettre ── */}
        <div className="rounded-card border border-line2 bg-surface2 px-3.5 py-3">
          <p className="text-[13px] leading-relaxed text-mut">
            <span className="font-semibold text-ink">
              L&apos;ordre de cette liste est l&apos;ordre de la boucle
            </span>{" "}
            : l&apos;écran enchaîne les scènes de haut en bas, puis recommence
            indéfiniment.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-mut">
            Les catégories longues occupent plusieurs pages. Les produits mis en
            avant ajoutent une scène après leur catégorie : la durée de diffusion
            peut donc dépasser la durée configurée ici.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line2 pt-2.5">
            <Pill variant="out">
              {draft.length} scène{draft.length > 1 ? "s" : ""}
            </Pill>
            <Pill variant="out">Durée configurée : {fmtLoop(loopMs(draft))}</Pill>
          </div>
        </div>

        {/* ── Les scènes ── */}
        {draft.length === 0 ? (
          <EmptyState
            icon="grid"
            title="Boucle vide"
            hint="Un écran sans scène reste sur un panneau d'attente. Ajoutez au moins une catégorie ci-dessous."
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {draft.map((scene, i) => {
              const resolved = categoryName(menu, scene.categoryId);
              const orphan =
                scene.kind === "category" && menu !== null && resolved === null;
              const title =
                resolved ?? scene.title ?? SCENE_KIND_LABELS[scene.kind];

              return (
                <li
                  key={`${scene.kind}-${scene.categoryId ?? scene.title ?? "x"}-${i}`}
                  className="flex items-center gap-2.5 rounded-card border border-line2 bg-[image:var(--cf-elev-gradient)] py-2 pl-2.5 pr-2"
                >
                  <span
                    className="cf-fig grid size-6 shrink-0 place-items-center rounded-xs bg-white/8 text-xs font-extrabold text-mut"
                    aria-hidden
                  >
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-ink">
                      {title}
                    </div>
                    <div className="truncate text-xs text-mut">
                      {SCENE_KIND_LABELS[scene.kind]}
                      {scene.kind === "promo" && " · résolues à l'affichage"}
                      {orphan && (
                        <span className="text-alertt">
                          {" "}
                          · catégorie introuvable
                        </span>
                      )}
                    </div>
                  </div>

                  <Select
                    aria-label={`Durée d'affichage de « ${title} »`}
                    value={String(scene.durationMs)}
                    onChange={(e) =>
                      patch(i, { durationMs: Number(e.target.value) })
                    }
                    className="w-[84px] shrink-0 px-2.5 py-1.5 pr-7 text-xs"
                  >
                    {/* Une durée hors liste (venue de l'API) reste sélectionnable. */}
                    {(DURATION_CHOICES.includes(scene.durationMs)
                      ? DURATION_CHOICES
                      : [...DURATION_CHOICES, scene.durationMs].sort((a, b) => a - b)
                    ).map((ms) => (
                      <option key={ms} value={ms}>
                        {fmtDuration(ms)}
                      </option>
                    ))}
                  </Select>

                  <RowBtn
                    icon="arrow"
                    rotate="up"
                    label={`Monter « ${title} »`}
                    disabled={i === 0}
                    onClick={() => setDraft((p) => moveScene(p, i, -1))}
                  />
                  <RowBtn
                    icon="arrow"
                    rotate="down"
                    label={`Descendre « ${title} »`}
                    disabled={i === draft.length - 1}
                    onClick={() => setDraft((p) => moveScene(p, i, 1))}
                  />
                  <RowBtn
                    icon="close"
                    danger
                    label={`Retirer « ${title} » de la boucle`}
                    onClick={() => setDraft((p) => p.filter((_, j) => j !== i))}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {/* ── Ajouter ── */}
        <div className="rounded-card border border-line2 bg-surface2 p-3.5">
          <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
            Ajouter une scène
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              aria-label="Catégorie à ajouter à la boucle"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              disabled={addable.length === 0}
              className="min-w-[200px] flex-1"
            >
              <option value="">
                {menu === null
                  ? "Carte indisponible…"
                  : addable.length === 0
                    ? "Toutes vos catégories sont déjà dans la boucle"
                    : "Choisir une catégorie…"}
              </option>
              {addable.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.products?.length ?? 0})
                </option>
              ))}
            </Select>
            <Btn
              variant="ink"
              size="sm"
              icon="plus"
              disabled={!pending}
              onClick={addCategory}
            >
              Ajouter
            </Btn>
          </div>

          {!hasPromo && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5 border-t border-line2 pt-2.5">
              <p className="min-w-[200px] flex-1 text-[13px] text-mut">
                Aucune scène « offres » dans cette boucle&nbsp;: vos promotions
                actives ne seront jamais affichées.
              </p>
              <Btn variant="ghost" size="sm" icon="tag" onClick={addPromo}>
                Ajouter les offres
              </Btn>
            </div>
          )}
        </div>

        <MaxLinesNote />
      </div>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Abandonner les modifications ?"
        destructive
        width={420}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirmClose(false)}>
              Reprendre
            </Btn>
            <Btn
              variant="ink"
              style={{ background: "var(--cf-red)" }}
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Abandonner
            </Btn>
          </>
        }
      >
        <p className="leading-relaxed">
          Votre nouvelle boucle n&apos;a pas été enregistrée&nbsp;:
          «&nbsp;{screen.name}&nbsp;» continuera d&apos;afficher l&apos;ordre
          actuel.
        </p>
      </Modal>
    </Drawer>
  );
}
