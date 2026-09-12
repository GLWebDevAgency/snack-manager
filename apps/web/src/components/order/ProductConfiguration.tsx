"use client";

import { useId, useState, type ReactNode } from "react";
import { groupSupplementsByCategory } from "@sm/client-core";
import { Icon } from "@/components/ui";
import type { MenuGroup } from "./api";
import {
  choicePrice, effectiveGroups, groupRules, setVariant,
  SUPPLEMENT_GROUP, toggleChoice, type Draft,
} from "./cart";
import { euros } from "./helpers";
import { OptionRow, RadioGroup, Segmented, Tap } from "./primitives";
import styles from "./product-configuration.module.css";

type Props = { draft: Draft; onChange: (next: Draft) => void; prixMono: boolean };

/** Presentation only: recipe identities, variant rules and prices stay in the
 * existing cart model. Categories come from the restaurant's ingredient data. */
export function ProductConfiguration({ draft, onChange, prixMono }: Props) {
  const noteId = useId();
  const removalId = useId();
  const supplementId = useId();
  const { product } = draft;
  const groups = effectiveGroups(product).filter(group => groupRules(group, draft.variantKey).max > 0);
  const isExtra = (group: MenuGroup) => groupRules(group, draft.variantKey).min === 0 &&
    group.choices.every(choice => choicePrice(group, choice.key, draft.variantKey) > 0);
  const composition = groups.filter(group => !isExtra(group));
  const extras = groups.filter(isExtra);
  const supplements = groupSupplementsByCategory(product.supplements);
  const pickedSupplements = draft.picked[SUPPLEMENT_GROUP] ?? [];

  return <div className={styles.flow}>
    {product.variants.length > 0 && <section className={styles.section}>
      <SectionHeading title="Format" hint="Choisissez votre format" status="Obligatoire" />
      <Segmented label="Format" mono={prixMono} value={draft.variantKey}
        onChange={key => onChange(setVariant(draft, key))}
        options={product.variants.map(variant => ({ key: variant.key, label: variant.name, sub: euros(variant.price) }))} />
    </section>}

    {composition.map(group => <GroupSection key={group.key} group={group} draft={draft} onChange={onChange} prixMono={prixMono} />)}

    {product.removables.length > 0 && <section className={styles.section}>
      <SectionHeading id={removalId} title="Ce que je retire" hint="Les ingrédients cochés seront retirés." status="Facultatif" />
      <div role="group" aria-labelledby={removalId}>
        <div className={styles.list}>
          {product.removables.map(item => {
            const on = draft.removed.includes(item.key);
            return <OptionRow key={item.key} on={on} title={`sans ${item.label.toLowerCase()}`}
              onClick={() => onChange({ ...draft, removed: on ? draft.removed.filter(key => key !== item.key) : [...draft.removed, item.key] })} />;
          })}
        </div>
        <Tap className={styles.reset} aria-label="Complet" aria-pressed={draft.removed.length === 0}
          onClick={() => onChange({ ...draft, removed: [] })}>
          <Icon name={draft.removed.length === 0 ? "check" : "back"} size={15} />
          Complet
          <span>{draft.removed.length === 0 ? "Aucun ingrédient retiré" : "Rétablir tous les ingrédients"}</span>
        </Tap>
      </div>
    </section>}

    {supplements.length > 0 && <section className={styles.section}>
      <SectionHeading id={supplementId} title="Suppléments" hint="À ajouter selon vos envies · prix par portion" status="Facultatif" />
      <div role="group" aria-labelledby={supplementId} className={styles.categories}>
        {supplements.map(category => <SupplementCategory key={category.category} label={category.label} prixMono={prixMono}
          items={category.items.map(sup => ({ key: sup.key, title: sup.label, price: sup.priceCents, on: pickedSupplements.includes(sup.key) }))}
          onPick={key => onChange({ ...draft, picked: { ...draft.picked,
            [SUPPLEMENT_GROUP]: pickedSupplements.includes(key) ? pickedSupplements.filter(value => value !== key) : [...pickedSupplements, key],
          } })} />)}
      </div>
    </section>}

    {extras.map(group => <GroupSection key={group.key} group={group} draft={draft} onChange={onChange} prixMono={prixMono} />)}

    <section className={styles.section}>
      <SectionHeading id={noteId} title="Un mot pour la cuisine" status="Facultatif" />
      <textarea value={draft.note} onChange={event => onChange({ ...draft, note: event.target.value })}
        aria-labelledby={noteId} rows={2} maxLength={200} placeholder="Ex : bien cuit, sauce à part…"
        className={styles.note} />
    </section>
  </div>;
}

function SectionHeading({ id, hintId, title, hint, status, complete = false }: {
  id?: string; hintId?: string; title: string; hint?: string; status?: ReactNode; complete?: boolean;
}) {
  return <div className={styles.heading}>
    <div><h3 id={id}>{title}</h3>{hint && <p id={hintId}>{hint}</p>}</div>
    {status && <span className={styles.status} data-complete={complete || undefined}>
      {complete && <Icon name="check" size={13} />} {status}
    </span>}
  </div>;
}

function groupHint(group: MenuGroup, variantKey: string | null): string {
  const { min, max } = groupRules(group, variantKey);
  if (group.type === "single" || max === 1) return min > 0 ? "Choisissez 1 option" : "1 choix maximum · facultatif";
  if (min === max) return `Choisissez ${min} options`;
  if (Number.isFinite(max)) return min > 0 ? `De ${min} à ${max} choix` : `Jusqu’à ${max} choix · facultatif`;
  return min > 0 ? `${min} choix minimum` : "Plusieurs choix possibles · facultatif";
}

function GroupSection({ group, draft, onChange, prixMono }: Props & { group: MenuGroup }) {
  const titleId = useId();
  const hintId = useId();
  const picked = draft.picked[group.key] ?? [];
  const { min, max } = groupRules(group, draft.variantKey);
  const single = group.type === "single" || max === 1;
  // An optional, solitary extra is a toggle. A one-item radiogroup would
  // re-click itself on ArrowRight and unexpectedly remove a paid selection.
  const radio = single && !(min === 0 && group.choices.length === 1);
  const capped = !single && Number.isFinite(max) && picked.length >= max;
  const complete = min > 0 && picked.length >= min;
  const status = !single && Number.isFinite(max) ? `${picked.length}/${max}` : min > 0 ? (complete ? "Choisi" : "Obligatoire") : undefined;
  return <section className={styles.section}>
    <SectionHeading id={titleId} hintId={hintId} title={group.name} hint={groupHint(group, draft.variantKey)} status={status} complete={complete} />
    <ChoiceList label={group.name} labelledBy={titleId} describedBy={hintId} radio={radio} prixMono={prixMono} included
      items={group.choices.map(choice => ({ key: choice.key, title: choice.name,
        price: choicePrice(group, choice.key, draft.variantKey), on: picked.includes(choice.key), disabled: !picked.includes(choice.key) && capped }))}
      onPick={key => onChange(toggleChoice(draft, group, key))} />
    {capped && <p className={styles.feedback} role="status">Sélection complète — décochez pour changer.</p>}
  </section>;
}

type Choice = { key: string; title: string; price: number; on: boolean; disabled?: boolean };
function SupplementCategory({ label, items, onPick, prixMono }: { label: string; items: Choice[]; onPick: (key: string) => void; prixMono: boolean }) {
  const titleId = useId();
  const count = items.filter(item => item.on).length;
  return <div className={styles.category}>
    <div className={styles.categoryHeading}><h4 id={titleId}>{label}</h4>{count > 0 && <span>{count} ajouté{count > 1 ? "s" : ""}</span>}</div>
    <ChoiceList label={label} labelledBy={titleId} items={items} onPick={onPick} prixMono={prixMono} />
  </div>;
}

const PREVIEW_COUNT = 6;
/** A long group reveals progressively, but selected choices never disappear.
 * Expanding before deselecting an out-of-preview row also preserves its focus. */
function ChoiceList({ label, labelledBy, describedBy, items, onPick, radio = false, included = false, prixMono }: {
  label: string; labelledBy: string; describedBy?: string; items: Choice[]; onPick: (key: string) => void;
  radio?: boolean; included?: boolean; prixMono: boolean;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const foldable = items.length > PREVIEW_COUNT + 2;
  const shown = expanded || !foldable ? items : items.filter((item, i) => i < PREVIEW_COUNT || item.on);
  const hidden = items.length - shown.length;
  const stop = shown.find(item => item.on)?.key ?? shown[0]?.key;
  const rows = shown.map(item => <OptionRow key={item.key} on={item.on} radio={radio} disabled={item.disabled}
    title={item.title} price={item.price} included={included} mono={prixMono} tabIndex={item.key === stop ? 0 : -1}
    onClick={() => {
      if (!expanded && items.findIndex(choice => choice.key === item.key) >= PREVIEW_COUNT) setExpanded(true);
      onPick(item.key);
    }} />);
  return <div className={styles.choiceList}>
    <div id={listId} className={styles.list}>
      {radio ? <RadioGroup labelledBy={labelledBy} describedBy={describedBy}>{rows}</RadioGroup> : <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>{rows}</div>}
    </div>
    {foldable && <Tap className={styles.disclosure} aria-expanded={expanded} aria-controls={listId}
      onClick={() => setExpanded(value => !value)} aria-label={expanded ? `Réduire ${label}` : `Voir tous les choix : ${label}`}>
      {expanded ? "Réduire la liste" : hidden > 0 ? `Voir les ${hidden} autres` : "Voir toute la liste"}
      <Icon name="arrow" size={14} className={expanded ? "-rotate-90" : "rotate-90"} />
    </Tap>}
  </div>;
}
