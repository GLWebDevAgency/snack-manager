"use client";

/**
 * Fiche produit — feuille montante de configuration.
 *
 * Un seul composant sert la création ET l’édition : « Modifier » depuis le
 * panier ouvre la même feuille pré-remplie (le `Draft` porte le `lineId`), il
 * n’y a jamais de re-saisie. Les bornes min/max sont celles du menu, y compris
 * les règles par variante (le nombre de viandes suit la taille du tacos).
 */

import { useState } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import type { MenuGroup } from "./api";
import {
  basePrice,
  choicePrice,
  draftBlocker,
  draftToLine,
  draftUnitPrice,
  groupRules,
  setVariant,
  toggleChoice,
  type CartLine,
  type Draft,
} from "./cart";
import { euros } from "./helpers";
import {
  Money,
  OptionChip,
  OptionRow,
  PrimaryAction,
  SectionLabel,
  Sheet,
  Stepper,
} from "./primitives";

/** Un groupe est rendu en lignes cochables dès qu’il porte des prix ou des sous-titres. */
function isPricedGroup(group: MenuGroup, variantKey: string | null): boolean {
  return group.choices.some((c) => choicePrice(group, c.key, variantKey) !== 0);
}

export function ProductSheet({
  draft,
  onChange,
  onClose,
  onSubmit,
  /** Commande suspendue : la configuration reste visible, l’ajout est bloqué. */
  blocked = false,
}: {
  draft: Draft | null;
  onChange: (next: Draft) => void;
  onClose: () => void;
  onSubmit: (line: CartLine) => void;
  blocked?: boolean;
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

  return (
    <Sheet
      open={draft !== null}
      onClose={onClose}
      title={product.name}
      headerExtra={
        <p className="mt-0.5 flex items-center gap-2 text-[13px] text-mut">
          <span className="tabular-nums">
            {euros(basePrice(product, current.variantKey))}
          </span>
          {product.isNew && (
            <span className="rounded-pill bg-accent px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.08em] text-onaccent">
              Nouveau
            </span>
          )}
        </p>
      }
      footer={
        <div className="flex items-center gap-3">
          <Stepper
            value={current.qty}
            min={1}
            label={product.name}
            onChange={(qty) => onChange({ ...current, qty })}
          />
          <div className="min-w-0 flex-1">
            <PrimaryAction
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
      <ProductHeader
        name={product.name}
        photoUrl={product.photoUrl}
        description={product.description}
      />

      <div className="flex flex-col gap-6 px-4 pb-6 pt-5">
        {product.variants.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <SectionLabel>Format</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((variant) => (
                <OptionChip
                  key={variant.key}
                  on={current.variantKey === variant.key}
                  onClick={() => onChange(setVariant(current, variant.key))}
                >
                  <span className="font-bold">{variant.name}</span>
                  <span className="text-[12px] font-bold tabular-nums opacity-70">
                    {euros(variant.price)}
                  </span>
                </OptionChip>
              ))}
            </div>
          </section>
        )}

        {product.groups.map((group) => (
          <GroupSection
            key={group.key}
            group={group}
            draft={current}
            onChange={onChange}
          />
        ))}

        {product.removables.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <SectionLabel hint="on retire, c’est offert">La recette</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <OptionChip
                on={current.removed.length === 0}
                onClick={() => onChange({ ...current, removed: [] })}
              >
                Complet
              </OptionChip>
              {product.removables.map((item) => {
                const on = current.removed.includes(item);
                return (
                  <OptionChip
                    key={item}
                    on={on}
                    onClick={() =>
                      onChange({
                        ...current,
                        removed: on
                          ? current.removed.filter((r) => r !== item)
                          : [...current.removed, item],
                      })
                    }
                  >
                    sans {item}
                  </OptionChip>
                );
              })}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2.5">
          <SectionLabel hint="facultatif">Un mot pour la cuisine</SectionLabel>
          <textarea
            value={current.note}
            onChange={(e) => onChange({ ...current, note: e.target.value })}
            rows={2}
            maxLength={200}
            placeholder="Ex : bien cuit, sauce à part…"
            className="w-full resize-none rounded-card border border-white/8 bg-white/5 px-3.5 py-3 text-[15px] text-ink outline-none transition-colors duration-200 ease-sm placeholder:text-mut/70 focus:border-accent"
          />
        </section>
      </div>
    </Sheet>
  );
}

/** Bandeau visuel : photo si le restaurant en a une, sinon typographie. */
function ProductHeader({
  name,
  photoUrl,
  description,
}: {
  name: string;
  photoUrl: string | null;
  description: string;
}) {
  return (
    <div>
      {photoUrl ? (
        // Photo produit : URL saisie par le restaurant, domaine non maîtrisé.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          className="h-44 w-full border-b border-white/6 object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="relative h-24 overflow-hidden border-b border-white/6 bg-[linear-gradient(180deg,#171717,#0d0d0d)]"
        >
          <span className="absolute -left-1 top-1/2 -translate-y-1/2 select-none whitespace-nowrap text-[62px] font-black uppercase leading-none tracking-[-0.04em] text-white/[0.05]">
            {name}
          </span>
          <span className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--cf-accent),transparent)] opacity-50" />
        </div>
      )}
      {description && (
        <p className="px-4 pt-4 text-[14px] leading-relaxed text-mut">
          {description}
        </p>
      )}
    </div>
  );
}

/** Une section d’options : chips pour les choix gratuits, lignes pour les payants. */
function GroupSection({
  group,
  draft,
  onChange,
}: {
  group: MenuGroup;
  draft: Draft;
  onChange: (next: Draft) => void;
}) {
  const picked = draft.picked[group.key] ?? [];
  const { min, max } = groupRules(group, draft.variantKey);
  // Plafond atteint : seul un groupe à choix MULTIPLE grise les choix restants.
  // Sur un choix unique, cliquer un autre remplace la sélection — le griser
  // rendrait le groupe non modifiable une fois la valeur par défaut posée.
  const capped =
    group.type === "multi" && max > 1 && Number.isFinite(max) && picked.length >= max;
  const priced = isPricedGroup(group, draft.variantKey);

  const hint = (() => {
    if (Number.isFinite(max) && max > 1) return `${picked.length}/${max}`;
    if (min >= 1) return "obligatoire";
    return group.type === "multi" ? "plusieurs choix" : "facultatif";
  })();

  const satisfied = picked.length >= min;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel
        hint={
          <span className={cx("tabular-nums", !satisfied && "text-alertt")}>
            {hint}
          </span>
        }
      >
        {group.name}
      </SectionLabel>

      {priced ? (
        <div className="rounded-card border border-white/8 bg-white/[0.02] px-3.5">
          {group.choices.map((choice) => {
            const on = picked.includes(choice.key);
            return (
              <OptionRow
                key={choice.key}
                on={on}
                radio={group.type === "single" || max === 1}
                disabled={!on && capped}
                title={choice.name}
                price={choicePrice(group, choice.key, draft.variantKey)}
                onClick={() => onChange(toggleChoice(draft, group, choice.key))}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {group.choices.map((choice) => {
            const on = picked.includes(choice.key);
            return (
              <OptionChip
                key={choice.key}
                on={on}
                disabled={!on && capped}
                onClick={() => onChange(toggleChoice(draft, group, choice.key))}
              >
                {choice.name}
              </OptionChip>
            );
          })}
        </div>
      )}

      {capped && group.type === "multi" && (
        <p className="flex items-center gap-1.5 text-[13px] text-mut">
          <Icon name="check" size={14} className="text-ok" />
          Sélection complète — décochez pour changer.
        </p>
      )}
    </section>
  );
}

/** Total unitaire réutilisable (récap panier). */
export function UnitPrice({ cents }: { cents: number }) {
  return <Money cents={cents} className="text-[15px]" />;
}
