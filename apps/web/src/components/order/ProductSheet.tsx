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
 *   ├ choix obligatoires (pain, garniture, plat…) : segments ou chips
 *   ├ choix libres (sauces, viandes) : chips avec compteur « 1/2 »
 *   ├ « Personnaliser » : ce que je retire · ce que j’ajoute (payant)
 *   └ mot pour la cuisine
 *
 * Un seul composant sert la création ET l’édition : « Modifier » depuis le
 * panier ouvre la même feuille pré-remplie (le `Draft` porte le `lineId`), il
 * n’y a jamais de re-saisie. Les bornes min/max sont celles du menu, y compris
 * les règles par variante (le nombre de viandes suit la taille du tacos).
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import type { MenuGroup } from "./api";
import {
  basePrice,
  choicePrice,
  draftBlocker,
  draftToLine,
  draftUnitPrice,
  effectiveGroups,
  groupRules,
  setVariant,
  SUPPLEMENT_GROUP,
  toggleChoice,
  type CartLine,
  type Draft,
} from "./cart";
import { euros } from "./helpers";
import {
  Badge,
  OptionChip,
  OptionRow,
  Plate,
  PrimaryAction,
  Prix,
  RadioGroup,
  SectionLabel,
  Segmented,
  Sheet,
  Stepper,
  Tap,
} from "./primitives";

/**
 * Trois familles de groupes, trois traitements visuels :
 *  — `choice` : le client DOIT trancher (pain, garniture, plat) ;
 *  — `free`   : plusieurs choix offerts (sauces, viandes comprises dans le prix) ;
 *  — `extra`  : suppléments payants, regroupés sous « Ce que j’ajoute ».
 */
type GroupKind = "choice" | "free" | "extra";

function kindOf(group: MenuGroup, variantKey: string | null): GroupKind {
  const { min } = groupRules(group, variantKey);
  if (min >= 1) return "choice";
  const priced = group.choices.every(
    (c) => choicePrice(group, c.key, variantKey) > 0,
  );
  return priced ? "extra" : "free";
}

/** Un groupe plafonné à zéro pour la variante choisie n’a rien à montrer. */
function isMuted(group: MenuGroup, variantKey: string | null): boolean {
  const { max } = groupRules(group, variantKey);
  return max === 0;
}

export function ProductSheet({
  draft,
  onChange,
  onClose,
  onSubmit,
  /** Commande suspendue : la configuration reste visible, l’ajout est bloqué. */
  blocked = false,
  /** Paire typographique du masque — obligatoire, comme sur `MenuBoard`. */
  prixMono,
}: {
  draft: Draft | null;
  onChange: (next: Draft) => void;
  onClose: () => void;
  onSubmit: (line: CartLine) => void;
  blocked?: boolean;
  prixMono: boolean;
}) {
  const noteId = useId();
  const retraitsId = useId();
  const supplementsId = useId();
  // Une copie figée survit à la fermeture le temps de l’animation de sortie
  // (motif « ajuster l’état pendant le rendu » de la doc React, pas un effet).
  const [snapshot, setSnapshot] = useState<Draft | null>(draft);
  if (draft && draft !== snapshot) setSnapshot(draft);

  const current = draft ?? snapshot;

  const groups = useMemo(() => {
    if (!current) return { choice: [], free: [], extra: [] };
    const bucket: Record<GroupKind, MenuGroup[]> = { choice: [], free: [], extra: [] };
    for (const group of effectiveGroups(current.product)) {
      if (isMuted(group, current.variantKey)) continue;
      bucket[kindOf(group, current.variantKey)].push(group);
    }
    return bucket;
  }, [current]);

  if (!current) return null;

  const { product } = current;
  const unit = draftUnitPrice(current);
  const blocker = draftBlocker(current);
  const editing = current.lineId !== null;
  const base = basePrice(product, current.variantKey);
  const extras = unit - base;
  const canCustomize =
    product.removables.length > 0 ||
    groups.extra.length > 0 ||
    product.supplements.length > 0;

  return (
    <Sheet
      open={draft !== null}
      onClose={onClose}
      chrome="float"
      title={product.name}
      zIndex={60}
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
      <ProductHero name={product.name} photoUrl={product.photoUrl} />

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

      <div className="flex flex-col gap-6 px-4 pb-8 pt-5">
        {/* ── Format : le choix qui pilote le prix, donc le premier ── */}
        {product.variants.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <SectionLabel hint="obligatoire">Format</SectionLabel>
            <Segmented
              label="Format"
              mono={prixMono}
              value={current.variantKey}
              onChange={(key) => onChange(setVariant(current, key))}
              options={product.variants.map((variant) => ({
                key: variant.key,
                label: variant.name,
                sub: euros(variant.price),
              }))}
            />
          </section>
        )}

        {/* ── Choix obligatoires, dans l’ordre voulu par le restaurant ── */}
        {groups.choice.map((group) => (
          <GroupSection
            key={group.key}
            group={group}
            draft={current}
            prixMono={prixMono}
            onChange={onChange}
          />
        ))}

        {/* ── Choix compris dans le prix ── */}
        {groups.free.map((group) => (
          <GroupSection
            key={group.key}
            group={group}
            draft={current}
            prixMono={prixMono}
            onChange={onChange}
          />
        ))}

        {/* ── Personnaliser : retraits gratuits · ajouts payants ── */}
        {canCustomize && (
          <section className="flex flex-col gap-4">
            <SectionLabel hint="à votre goût">Personnaliser</SectionLabel>

            {product.removables.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SubLabel id={retraitsId} icon="minus">
                  Ce que je retire
                </SubLabel>
                {/* Les chips `aria-pressed` d'une même grappe forment un
                    GROUPE, et il doit être nommé : sans lui, « sans oignons »
                    se lisait sans qu'on sache de quel choix il relève. */}
                <div
                  role="group"
                  aria-labelledby={retraitsId}
                  className="flex flex-wrap gap-2"
                >
                  <OptionChip
                    on={current.removed.length === 0}
                    onClick={() => onChange({ ...current, removed: [] })}
                  >
                    Complet
                  </OptionChip>
                  {product.removables.map((item) => {
                    const on = current.removed.includes(item.key);
                    return (
                      <OptionChip
                        key={item.key}
                        on={on}
                        onClick={() =>
                          onChange({
                            ...current,
                            removed: on
                              ? current.removed.filter((r) => r !== item.key)
                              : [...current.removed, item.key],
                          })
                        }
                      >
                        sans {item.label.toLowerCase()}
                      </OptionChip>
                    );
                  })}
                </div>
                <p className="text-[12.5px] text-mut">
                  Ce que vous retirez est offert et part tel quel en cuisine.
                </p>
              </div>
            )}

            {product.supplements.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SubLabel id={supplementsId} icon="plus">
                  Suppléments
                </SubLabel>
                <div
                  role="group"
                  aria-labelledby={supplementsId}
                  className="flex flex-wrap gap-2"
                >
                  {product.supplements.map((sup) => {
                    const on = (current.picked[SUPPLEMENT_GROUP] ?? []).includes(sup.key);
                    return (
                      <OptionChip
                        key={sup.key}
                        on={on}
                        onClick={() => {
                          const picked = current.picked[SUPPLEMENT_GROUP] ?? [];
                          onChange({
                            ...current,
                            picked: {
                              ...current.picked,
                              [SUPPLEMENT_GROUP]: on
                                ? picked.filter((k) => k !== sup.key)
                                : [...picked, sup.key],
                            },
                          });
                        }}
                      >
                        {sup.label}
                        <span className="ml-1.5 tabular-nums opacity-70">
                          +{euros(sup.priceCents)}
                        </span>
                      </OptionChip>
                    );
                  })}
                </div>
              </div>
            )}

            {groups.extra.length > 0 && (
              <div className="flex flex-col gap-2.5">
                <SubLabel icon="plus">Ce que j’ajoute</SubLabel>
                <div className="overflow-hidden rounded-card border border-ink/8 bg-ink/[0.02]">
                  {groups.extra.map((group) => (
                    <ExtraGroup
                      key={group.key}
                      group={group}
                      draft={current}
                      onChange={onChange}
                      showName={groups.extra.length > 1}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Mot pour la cuisine ── */}
        <section className="flex flex-col gap-2.5">
          {/* Le titre de section NOMME le champ : sans `aria-labelledby`, ce
              `<textarea>` n'avait aucun nom accessible (1.3.1, 4.1.2) — le
              `<h3>` juste au-dessus ne lui était relié par rien. */}
          <SectionLabel id={noteId} hint="facultatif">
            Un mot pour la cuisine
          </SectionLabel>
          <textarea
            value={current.note}
            onChange={(e) => onChange({ ...current, note: e.target.value })}
            aria-labelledby={noteId}
            rows={2}
            maxLength={200}
            placeholder="Ex : bien cuit, sauce à part…"
            className="w-full resize-none rounded-card border border-ink/8 bg-ink/5 px-3.5 py-3 text-[15px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut focus:border-focus"
          />
        </section>
      </div>
    </Sheet>
  );
}

/** Intitulé de sous-bloc dans « Personnaliser ». */
function SubLabel({
  children,
  icon,
  id,
}: {
  children: ReactNode;
  icon: "plus" | "minus";
  /** Nomme la grappe de chips qui suit (`aria-labelledby`). */
  id?: string;
}) {
  return (
    <p id={id} className="flex items-center gap-2 text-[13px] font-bold text-ink">
      <span
        aria-hidden
        className={cx(
          "grid size-5 place-items-center rounded-full",
          icon === "plus" ? "bg-accent text-onaccent" : "bg-ink/12 text-ink",
        )}
      >
        <Icon name={icon} size={12} stroke={3} />
      </span>
      {children}
    </p>
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
}: {
  name: string;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <div className="relative h-[210px] w-full overflow-hidden">
        <Plate
          photoUrl={photoUrl}
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

/**
 * Section d’un groupe de choix : segments quand l’alternative est courte,
 * chips au-delà. Le compteur « 1/2 » vit dans l’intitulé, à droite — le client
 * sait toujours combien il lui reste de choix sans compter les pastilles.
 */
function GroupSection({
  group,
  draft,
  prixMono,
  onChange,
}: {
  group: MenuGroup;
  draft: Draft;
  prixMono: boolean;
  onChange: (next: Draft) => void;
}) {
  const titreId = useId();
  const picked = draft.picked[group.key] ?? [];
  const { min, max } = groupRules(group, draft.variantKey);
  // Plafond atteint : seul un groupe à choix MULTIPLE grise les choix restants.
  // Sur un choix unique, cliquer un autre remplace la sélection — le griser
  // rendrait le groupe non modifiable une fois la valeur par défaut posée.
  const capped =
    group.type === "multi" && max > 1 && Number.isFinite(max) && picked.length >= max;
  const satisfied = picked.length >= min;

  const hint = (() => {
    // Compteur dès qu’on peut en cocher plusieurs — « 1/2 » vaut mieux qu’un
    // adjectif : le client sait ce qu’il lui reste sans compter les pastilles.
    if (group.type === "multi" && Number.isFinite(max)) {
      return `${picked.length}/${max}`;
    }
    if (min >= 1) return "obligatoire";
    return group.type === "multi" ? "plusieurs choix" : "facultatif";
  })();

  // Deux à quatre alternatives exclusives : un segment se lit d’un coup d’œil.
  const asSegments = group.type === "single" && group.choices.length <= 4;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel
        id={titreId}
        hint={
          <span className={cx("tabular-nums", !satisfied && "text-alertt")}>{hint}</span>
        }
      >
        {group.name}
      </SectionLabel>

      {asSegments ? (
        <Segmented
          label={group.name}
          mono={prixMono}
          value={picked[0] ?? null}
          onChange={(key) => onChange(toggleChoice(draft, group, key))}
          options={group.choices.map((choice) => {
            const price = choicePrice(group, choice.key, draft.variantKey);
            return {
              key: choice.key,
              label: choice.name,
              sub: price === 0 ? "Inclus" : `+${euros(price)}`,
            };
          })}
        />
      ) : (
        // Le groupe est NOMMÉ par son intitulé (« Sauces 1/2 ») : sans lui, un
        // lecteur d'écran annonçait « Ketchup, non pressé » sans jamais dire à
        // quel choix la chip appartenait.
        <div role="group" aria-labelledby={titreId} className="flex flex-wrap gap-2">
          {group.choices.map((choice) => {
            const on = picked.includes(choice.key);
            const price = choicePrice(group, choice.key, draft.variantKey);
            return (
              <OptionChip
                key={choice.key}
                on={on}
                disabled={!on && capped}
                price={price}
                onClick={() => onChange(toggleChoice(draft, group, choice.key))}
              >
                {choice.name}
                {price === 0 && <span className="text-[12px] font-bold text-mut">Inclus</span>}
              </OptionChip>
            );
          })}
        </div>
      )}

      {capped && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-mut">
          {/* `okt`, la teinte TEXTE du vert : `ok` est un aplat, il ne tient
              pas 3:1 sur la surface de la feuille. */}
          <Icon name="check" size={13} className="text-okt" />
          Sélection complète — décochez pour changer.
        </p>
      )}
    </section>
  );
}

/** Au-delà de ce seuil, un groupe de suppléments est replié : 28 lignes de
 *  fromages ne se lisent pas, elles s’endurent. */
const EXTRAS_PREVIEW = 6;

/**
 * Un groupe de suppléments payants, en lignes cochables. Les groupes longs
 * n’affichent que leurs premières lignes et ce qui est déjà coché : la fiche
 * reste parcourable au pouce, tout est à un appui.
 */
function ExtraGroup({
  group,
  draft,
  onChange,
  showName,
}: {
  group: MenuGroup;
  draft: Draft;
  onChange: (next: Draft) => void;
  /** Plusieurs groupes de suppléments : on rappelle lequel. */
  showName: boolean;
}) {
  const groupeId = useId();
  const [expanded, setExpanded] = useState(false);
  const picked = draft.picked[group.key] ?? [];
  const { max } = groupRules(group, draft.variantKey);
  const capped =
    group.type === "multi" && max > 1 && Number.isFinite(max) && picked.length >= max;
  const single = group.type === "single" || max === 1;

  const foldable = group.choices.length > EXTRAS_PREVIEW + 2;
  const shown =
    !foldable || expanded
      ? group.choices
      : group.choices.filter(
          (choice, i) => i < EXTRAS_PREVIEW || picked.includes(choice.key),
        );
  const hidden = group.choices.length - shown.length;

  const radio = single && group.choices.length > 1;
  /*
   * Un `role="radio"` doit vivre dans un `radiogroup` — ces lignes n'en
   * avaient aucun. `RadioGroup` le pose ET rend les flèches opérantes ; le
   * tabindex tournant se calcule ici, seul endroit qui voie tout le groupe :
   * la ligne cochée prend la halte de tabulation, ou la première quand rien
   * n'est encore choisi (sinon le groupe devenait inatteignable au clavier).
   */
  const lignes = shown.map((choice, i) => {
    const on = picked.includes(choice.key);
    return (
      <OptionRow
        key={choice.key}
        on={on}
        radio={radio}
        tabIndex={on || (picked.length === 0 && i === 0) ? 0 : -1}
        disabled={!on && capped}
        title={choice.name}
        price={choicePrice(group, choice.key, draft.variantKey)}
        onClick={() => onChange(toggleChoice(draft, group, choice.key))}
      />
    );
  });

  return (
    <div className="border-b border-ink/6 px-3.5 last:border-b-0">
      {showName && (
        <p id={groupeId} className="pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
          {group.name}
        </p>
      )}
      {radio ? (
        <RadioGroup label={showName ? undefined : group.name} labelledBy={showName ? groupeId : undefined}>
          {lignes}
        </RadioGroup>
      ) : (
        lignes
      )}
      {foldable && hidden > 0 && (
        <Tap
          onClick={() => setExpanded(true)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 py-3 text-[13px] font-bold text-accentink"
        >
          Voir les {hidden} autres
          <Icon name="arrow" size={13} stroke={2.6} className="rotate-90" />
        </Tap>
      )}
      {foldable && expanded && (
        <Tap
          onClick={() => setExpanded(false)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 py-3 text-[13px] font-bold text-mut hover:text-ink"
        >
          Réduire
          <Icon name="arrow" size={13} stroke={2.6} className="-rotate-90" />
        </Tap>
      )}
    </div>
  );
}
