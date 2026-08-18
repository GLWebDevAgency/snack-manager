"use client";

/**
 * Carte « Catégories » (spec backoffice-restaurant §7.2) — 268 px, padding 8.
 * Tri A→Z, création inline (Enter/Escape), drag & drop HTML5 natif avec
 * indicateur d'insertion, suppression protégée, rangée « Non rattachés ».
 */

import { useState, type DragEvent } from "react";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Icon } from "@/components/ui";
import { UNCAT, type Category } from "./types";

type Props = {
  categories: Category[];
  uncategorizedCount: number;
  /** Id de catégorie sélectionnée, ou sentinelle UNCAT. */
  selected: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onSortAlpha: () => void;
  /** Nouvel ordre complet des ids après drag & drop. */
  onReorder: (ids: string[]) => void;
  onDelete: (cat: Category) => void;
  /** Signale un drag en cours (le parent diffère les reloads temps réel). */
  onDragActive: (active: boolean) => void;
};

export function CategoriesCard({
  categories,
  uncategorizedCount,
  selected,
  onSelect,
  onCreate,
  onSortAlpha,
  onReorder,
  onDelete,
  onDragActive,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Emplacement d'insertion (0..n) survolé pendant le drag. */
  const [overSlot, setOverSlot] = useState<number | null>(null);

  function commitCreate() {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (!name) return; // valeur vide = annulation silencieuse (spec §7.2)
    onCreate(name);
  }

  function slotFromEvent(e: DragEvent<HTMLDivElement>, index: number): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function endDrag() {
    setDragIndex(null);
    setOverSlot(null);
    onDragActive(false);
  }

  function commitDrop(slot: number) {
    if (dragIndex === null) return endDrag();
    const ids = categories.map((c) => c._id);
    const [moved] = ids.splice(dragIndex, 1);
    const at = dragIndex < slot ? slot - 1 : slot;
    if (moved !== undefined && at !== dragIndex) {
      ids.splice(at, 0, moved);
      onReorder(ids);
    }
    endDrag();
  }

  const indicator = (
    <div aria-hidden className="mx-1 h-0.5 rounded-pill bg-accent" />
  );

  return (
    <Card className="w-[268px] shrink-0 p-2">
      {/* En-tête : eyebrow + A→Z + création */}
      <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-mut">
          Catégories
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSortAlpha}
            title="Trier par ordre alphabétique"
            className="rounded-[7px] border border-line bg-surface2 px-2 py-[3px] text-[11px] font-extrabold text-ink transition-colors duration-200 hover:border-white/50"
          >
            A→Z
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="Nouvelle catégorie"
            aria-label="Nouvelle catégorie"
            className="rounded-[7px] border border-line bg-surface2 px-[7px] py-[3px] text-ink transition-colors duration-200 hover:border-white/50"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>

      {/* Ligne de création inline */}
      {creating && (
        <div className="mb-1 flex items-center gap-1.5 px-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            placeholder="Nom de la catégorie"
            aria-label="Nom de la nouvelle catégorie"
            className="min-w-0 flex-1 rounded-ctrl border border-white/6 bg-white/5 px-2.5 py-[7px] text-[13px] text-white outline-none transition-colors duration-200 placeholder:text-mut/75 focus:border-accent"
          />
          <button
            type="button"
            // mousedown : passe avant le blur de l'input
            onMouseDown={(e) => {
              e.preventDefault();
              commitCreate();
            }}
            aria-label="Créer la catégorie"
            title="Créer la catégorie"
            className="grid size-[30px] shrink-0 place-items-center rounded-ctrl bg-accent text-onaccent"
          >
            <Icon name="check" size={14} stroke={3} />
          </button>
        </div>
      )}

      {categories.length === 0 && !creating ? (
        <EmptyState
          icon="grid"
          title="Aucune catégorie"
          hint="Crée ta première catégorie pour organiser la carte."
          action={
            <Btn variant="ink" size="sm" icon="plus" onClick={() => setCreating(true)}>
              Catégorie
            </Btn>
          }
          className="p-6"
        />
      ) : (
        <div
          role="list"
          aria-label="Catégories de la carte"
          onDragLeave={(e) => {
            // sortie réelle de la liste (pas un enfant)
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSlot(null);
          }}
        >
          {categories.map((cat, i) => {
            const isSel = selected === cat._id;
            return (
              <div key={cat._id}>
                {overSlot === i && dragIndex !== null && indicator}
                <div
                  role="listitem"
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(i);
                    onDragActive(true);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", cat._id);
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverSlot(slotFromEvent(e, i));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    commitDrop(slotFromEvent(e, i));
                  }}
                  onDragEnd={endDrag}
                  onClick={() => onSelect(cat._id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(cat._id);
                    }
                  }}
                  tabIndex={0}
                  aria-current={isSel || undefined}
                  className={cx(
                    "flex cursor-pointer items-center gap-2 rounded-[9px] px-2 py-2 transition-colors duration-150",
                    isSel ? "bg-surface2" : "hover:bg-white/6",
                    dragIndex === i && "opacity-40",
                  )}
                >
                  <span
                    aria-hidden
                    title="Glisser pour réordonner"
                    className="shrink-0 cursor-grab select-none text-[11px] leading-none tracking-[-1px] text-mut"
                  >
                    ⋮⋮
                  </span>
                  <Icon
                    name="tag"
                    size={16}
                    className={cx("shrink-0", isSel ? "text-accent" : "text-mut")}
                  />
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-[13.5px] text-ink",
                      isSel && "font-bold",
                    )}
                  >
                    {cat.name}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-mut">
                    {cat.products.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(cat);
                    }}
                    title="Supprimer la catégorie"
                    aria-label={`Supprimer la catégorie ${cat.name}`}
                    className="shrink-0 text-mut transition-colors duration-150 hover:text-alertt"
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {overSlot === categories.length && dragIndex !== null && indicator}
        </div>
      )}

      {/* Rangée spéciale « Non rattachés » — visible si ≥ 1 orphelin */}
      {uncategorizedCount > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(UNCAT)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(UNCAT);
              }
            }}
            aria-current={selected === UNCAT || undefined}
            className={cx(
              "flex cursor-pointer items-center gap-2 rounded-[9px] px-2 py-2 transition-colors duration-150",
              selected === UNCAT ? "bg-surface2" : "hover:bg-white/6",
            )}
          >
            <Icon
              name="tag"
              size={16}
              className={cx("ml-[19px] shrink-0", selected === UNCAT ? "text-gold" : "text-mut")}
            />
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-[13.5px] text-ink",
                selected === UNCAT && "font-bold",
              )}
            >
              Non rattachés
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-mut">
              {uncategorizedCount}
            </span>
          </div>
        </div>
      )}

      {categories.length > 1 && (
        <p className="px-1.5 pb-1 pt-2 text-[11px] leading-[1.35] text-mut">
          Glisse ⋮⋮ pour réordonner — l&apos;ordre est celui de la carte client.
        </p>
      )}
    </Card>
  );
}
