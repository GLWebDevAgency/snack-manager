"use client";

/**
 * Fiche produit — feuille montante de configuration.
 *
 * C’est le moment clé du parcours : le client y passe plus de temps que sur
 * toute autre vue. Structure reprise de la maquette
 * (`docs/specs/commande-en-ligne.md` §5.3), dans l’ordre :
 *
 *   visuel plein cadre (photo ou typographie) — la croix flotte par-dessus
 *   ├ identité : nom, badge, prix de base, description
 *   ├ « Format » : contrôle segmenté (le choix qui pilote le prix)
 *   ├ composition : sections nommées, lignes de choix et règles explicites
 *   ├ retraits : ingrédients de la recette, sans raccourci synthétique
 *   ├ suppléments : catégories du catalogue d’ingrédients du restaurant
 *   └ mot pour la cuisine
 *
 * Un seul composant sert la création ET l’édition : « Modifier » depuis le
 * panier ouvre la même feuille pré-remplie (le `Draft` porte le `lineId`), il
 * n’y a jamais de re-saisie. Les bornes min/max sont celles du menu, y compris
 * les règles par variante (le nombre de viandes suit la taille du tacos).
 */

import { useState, type ReactNode } from "react";
import {
  basePrice,
  draftBlocker,
  draftToLine,
  draftUnitPrice,
  type CartLine,
  type Draft,
} from "./cart";
import { ProductConfiguration } from "./ProductConfiguration";
import {
  Badge,
  Plate,
  PrimaryAction,
  Prix,
  Sheet,
  Stepper,
} from "./primitives";

export function ProductSheet({
  draft,
  onChange,
  onClose,
  onSubmit,
  /** Commande suspendue : la configuration reste visible, l’ajout est bloqué. */
  blocked = false,
  /** Paire typographique du masque — obligatoire, comme sur `MenuBoard`. */
  prixMono,
  recommendations,
}: {
  recommendations?: ReactNode;
  draft: Draft | null;
  onChange: (next: Draft) => void;
  onClose: () => void;
  onSubmit: (line: CartLine) => void;
  blocked?: boolean;
  prixMono: boolean;
}) {
  // Une copie figée survit à la fermeture le temps de l’animation de sortie
  // (motif « ajuster l’état pendant le rendu » de la doc React, pas un effet).
  const [snapshot, setSnapshot] = useState<Draft | null>(draft);
  if (draft && draft !== snapshot) setSnapshot(draft);

  const current = draft ?? snapshot;

  if (!current) return null;

  const { product } = current;
  const unit = draftUnitPrice(current);
  const blocker = draftBlocker(current);
  const editing = current.lineId !== null;
  const base = basePrice(product, current.variantKey);
  const extras = unit - base;

  return (
    <Sheet
      open={draft !== null}
      onClose={onClose}
      chrome="float"
      title={product.name}
      zIndex={60}
      footer={
        <div className="sm-order-product-actions grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 max-[400px]:grid-cols-1 max-[400px]:justify-items-center max-[400px]:gap-2">
          <Stepper
            value={current.qty}
            min={1}
            label={product.name}
            onChange={(qty) => onChange({ ...current, qty })}
          />
          <div className="w-full min-w-0">
            <PrimaryAction
              mono={prixMono}
              disabled={blocked || blocker !== null}
              amount={blocker || blocked ? undefined : unit * current.qty}
              icon={editing ? "check" : "cart"}
              onClick={() => onSubmit(draftToLine(current))}
            >
              {blocked
                ? "Commande suspendue"
                : (blocker ?? (editing ? "Enregistrer" : "Ajouter"))}
            </PrimaryAction>
          </div>
        </div>
      }
    >
      <ProductHero name={product.name} photoUrl={product.photoUrl} cover={product.photoCover} />

      <div className="px-4 pb-1 pt-4">
        <div className="flex items-start gap-3">
          <h2 className="font-display min-w-0 flex-1 text-[clamp(1.4375rem,1.25rem+0.8vw,1.75rem)] font-extrabold leading-tight tracking-[-0.035em] text-ink">
            {product.name}
          </h2>
          {product.isNew && (
            <span className="mt-1.5">
              <Badge tone="new">Nouveau</Badge>
            </span>
          )}
        </div>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Prix
            cents={base}
            mono={prixMono}
            className="text-[16px] font-extrabold tracking-[-0.02em] text-ink"
          />
          {extras > 0 && (
            <span className="text-[13px] font-semibold text-accentink">
              + <Prix cents={extras} mono={prixMono} /> d’options
            </span>
          )}
        </p>
        {product.description && (
          <p className="mt-2.5 text-[14px] leading-relaxed text-mut">
            {product.description}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-7 px-4 pb-8 pt-5">
        <ProductConfiguration key={product.id} draft={current} onChange={onChange} prixMono={prixMono} />
        {!editing && recommendations}
      </div>
    </Sheet>
  );
}

/**
 * Visuel de tête. Avec photo : le plat entier, posé sur son plateau et fondu
 * vers la surface de la feuille — jamais recadré (les visuels de la carte sont
 * détourés, un `cover` leur couperait les deux bouts). Sans photo : bandeau
 * typographique — le nom du produit en très grand, en contour.
 */
function ProductHero({
  name,
  photoUrl,
  cover,
}: {
  name: string;
  photoUrl: string | null;
  cover?: boolean;
}) {
  if (photoUrl) {
    return (
      <div className="relative h-[210px] w-full overflow-hidden">
        <Plate
          photoUrl={photoUrl}
          cover={cover}
          name={name}
          mono={64}
          pad="p-6"
          radius="rounded-none"
          className="size-full border-0"
        />
        <span aria-hidden className="sm-scrim absolute inset-x-0 bottom-0 h-24" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="sm-grain relative h-[112px] overflow-hidden bg-[linear-gradient(180deg,var(--cf-surface-2),var(--cf-bg))]"
    >
      <span className="sm-ghost font-display absolute -left-2 top-1/2 -translate-y-1/2 text-[clamp(3.25rem,2.6rem+2vw,4.5rem)] font-black">
        {name}
      </span>
      <span className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--cf-accent),transparent)] opacity-60" />
    </div>
  );
}
