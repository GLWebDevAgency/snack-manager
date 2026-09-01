"use client";

/**
 * Carte « Catégories » (spec backoffice-restaurant §7.2) — 268 px, padding 8.
 * Tri A→Z, création inline (Enter/Escape), drag & drop HTML5 natif avec
 * indicateur d'insertion, suppression protégée, rangée « Non rattachés ».
 */

import { useState, type DragEvent } from "react";
import { cx } from "@/lib/cx";
import { Btn, Card, EmptyState, Icon, Modal } from "@/components/ui";
import { UNCAT, type Category } from "./types";

type Props = {
  categories: Category[];
  uncategorizedCount: number;
  /** Id de catégorie sélectionnée, ou sentinelle UNCAT. */
  selected: string | null;
  onSelect: (id: string) => void;
  /** Rend vrai si la création a abouti — l'échec rétablit la ligne de saisie. */
  onCreate: (name: string) => Promise<boolean>;
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
  /**
   * Catégorie VIDE en attente de confirmation de suppression : le parent ne
   * montre sa modale §7.4 que sur 409 (produits rattachés) — sans garde ici,
   * une catégorie vide partait au premier clic corbeille.
   */
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);

  function commitCreate() {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (!name) return; // valeur vide = annulation silencieuse (spec §7.2)
    // L'échec du POST rétablit la ligne AVEC le nom saisi : le toast
    // « Création impossible » ne doit pas coûter la saisie en plus.
    void onCreate(name).then((cree) => {
      if (!cree) {
        setCreating(true);
        setNewName(name);
      }
    });
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
    // Pleine largeur sous `lg` (colonne empilée au-dessus des produits) ;
    // 268 px fixes dès que les deux colonnes tiennent côte à côte.
    <Card className="w-full shrink-0 p-2 lg:w-[268px]">
      {/* En-tête : eyebrow + A→Z + création */}
      <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-mut">
          Catégories
        </span>
        <div className="flex items-center gap-1.5">
          {/* aria-label : le contenu prime sur le title, sans lui le lecteur
              d'écran lit « A flèche Z ». py-1.5 + marge négative : cibles
              ~28 px (WCAG 2.5.8) sans épaissir l'en-tête. */}
          <button
            type="button"
            onClick={onSortAlpha}
            title="Trier par ordre alphabétique"
            aria-label="Trier par ordre alphabétique"
            className="cf-press -my-1 rounded-xs border border-line bg-[image:var(--cf-elev-gradient)] px-2 py-1.5 text-[11px] font-extrabold text-ink hover:border-white/40 hover:bg-[image:var(--cf-elev-hover)]"
          >
            A→Z
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="Nouvelle catégorie"
            aria-label="Nouvelle catégorie"
            className="cf-press -my-1 rounded-xs border border-line bg-[image:var(--cf-elev-gradient)] px-2 py-1.5 text-ink hover:border-white/40 hover:bg-[image:var(--cf-elev-hover)]"
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
            className="min-w-0 flex-1 rounded-ctrl border border-white/6 bg-white/5 px-2.5 py-[7px] text-[13px] text-white outline-none transition-colors duration-200 ease-sm placeholder:text-mut hover:border-white/16 focus:border-accent focus:bg-white/8"
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
            className="cf-press grid size-[30px] shrink-0 place-items-center rounded-ctrl bg-accent text-onaccent hover:opacity-85"
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
          // Sous `lg`, la liste défile dans son cadre : vingt catégories
          // empilées repousseraient les produits — la raison d'être de la
          // page — à deux écrans du pouce.
          className="cf-scroll max-lg:max-h-[300px] max-lg:overflow-y-auto"
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
                {/* Le div ne porte que la sémantique de liste et le drag :
                    la sélection est un VRAI bouton (annoncé actionnable au
                    lecteur d'écran, Enter/Espace natifs, aria-current dessus),
                    la corbeille son frère — plus d'action destructive imbriquée
                    dans une zone cliquable. */}
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
                  className={cx(
                    "flex items-center gap-2 rounded-ctrl px-2",
                    isSel
                      ? "bg-[image:var(--cf-elev-gradient)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
                      : "hover:bg-white/6",
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
                  <button
                    type="button"
                    onClick={() => onSelect(cat._id)}
                    aria-current={isSel || undefined}
                    className="cf-press-row flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-left"
                  >
                    <Icon
                      name="tag"
                      size={16}
                      className={cx("shrink-0", isSel ? "text-accent" : "text-mut")}
                    />
                    {/* Le nom porte son `title` : dernier filet pour lire un
                        nom tronqué dans la colonne de 268 px avant la corbeille
                        — motif DeviceRow de la fiche client. */}
                    <span
                      title={cat.name}
                      className={cx(
                        "min-w-0 flex-1 truncate text-[13.5px] text-ink",
                        isSel && "font-bold",
                      )}
                    >
                      {cat.name}
                    </span>
                    <span className="cf-fig shrink-0 text-[11px] font-bold text-mut">
                      {cat.products.length}
                    </span>
                  </button>
                  {/* size-7 : cible ≥ 24 px (WCAG 2.5.8) pour le geste
                      destructif ; -mr-1 garde la densité de la colonne. */}
                  <button
                    type="button"
                    onClick={() =>
                      cat.products.length === 0 ? setConfirmDelete(cat) : onDelete(cat)
                    }
                    title="Supprimer la catégorie"
                    aria-label={`Supprimer la catégorie ${cat.name}`}
                    className="cf-press -mr-1 grid size-7 shrink-0 place-items-center rounded-xs text-mut hover:bg-alert/15 hover:text-alertt"
                  >
                    <Icon name="trash" size={15} />
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
              "cf-press-row flex cursor-pointer items-center gap-2 rounded-ctrl px-2 py-2",
              selected === UNCAT
                ? "bg-[image:var(--cf-elev-gradient)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
                : "hover:bg-white/6",
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
            <span className="cf-fig shrink-0 text-[11px] font-bold text-mut">
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

      {/* ── Confirmation pour une catégorie VIDE ── Le DELETE du parent part
          immédiatement quand rien n'est rattaché (sa modale §7.4 ne s'ouvre
          que sur 409) : la garde se joue donc ici, même habillage que la §7.4.
          Pour une catégorie avec produits, le flux 409 → §7.4 reste seul. */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        destructive
        title={
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-[38px] shrink-0 place-items-center rounded-ctrl text-alert"
              style={{
                background: "color-mix(in srgb, var(--cf-red) 22%, var(--cf-surface))",
              }}
            >
              <Icon name="trash" size={18} />
            </span>
            <span className="min-w-0 truncate">
              Supprimer «&nbsp;{confirmDelete?.name}&nbsp;» ?
            </span>
          </span>
        }
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Annuler
            </Btn>
            <Btn
              size="sm"
              icon="trash"
              // Rouge fonctionnel imposé (§7.4) — jamais l'accent tenant.
              style={{ background: "var(--cf-red)", color: "var(--cf-text)" }}
              onClick={() => {
                if (confirmDelete) onDelete(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Supprimer la catégorie
            </Btn>
          </>
        }
      >
        <p className="leading-[1.5] text-mut">
          Cette catégorie est vide : aucun produit ne sera touché. Elle sera
          supprimée immédiatement — il faudra la recréer pour la retrouver.
        </p>
      </Modal>
    </Card>
  );
}
