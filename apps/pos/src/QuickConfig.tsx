/**
 * Config express (V2) — la modale ouverte au tap sur un produit.
 *
 * Les règles min/max sont lues PAR VARIANTE via `ruleFor` du noyau partagé :
 * un tacos M impose 1 viande, un XXL en impose 4. Le bouton d'ajout reste
 * désactivé tant que `missingRequired` n'est pas vide, et l'écran dit
 * précisément ce qui manque plutôt qu'un « formulaire invalide ».
 */
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  euros,
  missingRequired,
  ruleFor,
  unitPrice,
  type CartLine,
  type OptionGroup,
  type Product,
  type SelectedOption,
} from '@sm/client-core';
import { FONT, R, S, palette, sheet, type, withAlpha, type Brand } from './theme';
import { Btn, Chip, Field, Overlay, PanelHead, Stepper } from './ui';

export interface ConfigDraft {
  lineId?: string;
  variantKey: string | null;
  options: SelectedOption[];
  removed: string[];
  note: string;
  qty: number;
}

/** Delta de prix effectif d'un choix (l'override par variante prime). */
function deltaFor(group: OptionGroup, variantKey: string | null, fallback: number): number {
  return ruleFor(group, variantKey).priceDelta ?? fallback;
}

function ruleLabel(min: number, max: number, count: number): { text: string; tone: 'need' | 'ok' | 'free' } {
  const capped = Number.isFinite(max);
  if (min > 0 && count < min) {
    return { text: `${count}/${min} choisi${min > 1 ? 's' : ''}`, tone: 'need' };
  }
  if (capped && max > 0) {
    return { text: `${count}/${max} choisi${max > 1 ? 's' : ''}`, tone: count > 0 ? 'ok' : 'free' };
  }
  return { text: count > 0 ? `${count} choisi${count > 1 ? 's' : ''}` : 'facultatif', tone: count > 0 ? 'ok' : 'free' };
}

export function QuickConfig({
  product,
  categoryName,
  brand,
  initial,
  onClose,
  onSubmit,
}: {
  product: Product;
  categoryName?: string;
  brand: Brand;
  initial?: ConfigDraft;
  onClose: () => void;
  onSubmit: (draft: ConfigDraft) => void;
}) {
  const variants = product.variants ?? [];
  const [variantKey, setVariantKey] = useState<string | null>(
    initial?.variantKey ?? (variants.length ? (variants[0]?.key ?? null) : null),
  );
  const [options, setOptions] = useState<SelectedOption[]>(initial?.options ?? []);
  const [removed, setRemoved] = useState<string[]>(initial?.removed ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [qty, setQty] = useState(initial?.qty ?? 1);

  const groups = useMemo(
    () => (product.optionGroups ?? []).filter((g) => g.choices.length > 0),
    [product.optionGroups],
  );

  const unit = unitPrice(product, variantKey, options);
  const missing = missingRequired(product, variantKey, options);

  /** Détail exact du manque — « Viandes : 2 de plus ». */
  const missingDetail = useMemo(() => {
    const parts: string[] = [];
    for (const group of groups) {
      const { min, max } = ruleFor(group, variantKey);
      const count = options.filter((o) => o.groupKey === group.key).length;
      if (count < min) parts.push(`${group.name} : ${min - count} de plus`);
      else if (count > max) parts.push(`${group.name} : ${count - max} de trop`);
    }
    return parts;
  }, [groups, options, variantKey]);

  function pickVariant(key: string) {
    setVariantKey(key);
    // Changer de taille resserre les règles : on tronque les groupes au nouveau plafond.
    setOptions((cur) => {
      const kept: SelectedOption[] = [];
      const perGroup = new Map<string, number>();
      for (const opt of cur) {
        const group = groups.find((g) => g.key === opt.groupKey);
        if (!group) continue;
        const { max } = ruleFor(group, key);
        const used = perGroup.get(opt.groupKey) ?? 0;
        if (used >= max) continue;
        perGroup.set(opt.groupKey, used + 1);
        kept.push({ ...opt, priceDelta: deltaFor(group, key, opt.priceDelta) });
      }
      return kept;
    });
  }

  function toggleChoice(group: OptionGroup, choiceKey: string, name: string, priceDelta: number) {
    const { max } = ruleFor(group, variantKey);
    setOptions((cur) => {
      const exists = cur.some((o) => o.groupKey === group.key && o.choiceKey === choiceKey);
      if (exists) return cur.filter((o) => !(o.groupKey === group.key && o.choiceKey === choiceKey));
      const inGroup = cur.filter((o) => o.groupKey === group.key);
      const next: SelectedOption = {
        groupKey: group.key,
        choiceKey,
        name,
        priceDelta: deltaFor(group, variantKey, priceDelta),
      };
      if (inGroup.length >= max) {
        // Plafond atteint : un groupe à choix unique remplace, un groupe
        // multiple ignore (les chips sont alors visiblement désactivées).
        if (max === 1) return [...cur.filter((o) => o.groupKey !== group.key), next];
        return cur;
      }
      return [...cur, next];
    });
  }

  function toggleRemoved(item: string) {
    setRemoved((cur) => (cur.includes(item) ? cur.filter((r) => r !== item) : [...cur, item]));
  }

  const ctaLabel = missing.length === 0 ? `Ajouter · ${euros(unit * qty)}` : 'Complétez la configuration';

  return (
    <Overlay onClose={onClose} width={520}>
      <PanelHead
        title={product.name}
        sub={[categoryName, product.description].filter(Boolean).join(' · ') || undefined}
        onClose={onClose}
      />
      <View style={sheet.hairline} />

      <ScrollView
        style={{ maxHeight: 470 }}
        contentContainerStyle={{ padding: S.xl, gap: S.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {variants.length > 0 ? (
          <Section title="Taille" hint={`${variants.length} formats`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {variants.map((v) => (
                <Chip
                  key={v.key}
                  label={v.name}
                  detail={euros(v.price)}
                  on={v.key === variantKey}
                  onPress={() => pickVariant(v.key)}
                  accent={brand.accent}
                  onAccent={brand.onAccent}
                  minHeight={52}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {groups.map((group) => {
          const rule = ruleFor(group, variantKey);
          if (rule.max === 0) return null;
          const inGroup = options.filter((o) => o.groupKey === group.key);
          const full = inGroup.length >= rule.max;
          const info = ruleLabel(rule.min, rule.max, inGroup.length);
          return (
            <Section
              key={group.key}
              title={group.name}
              hint={info.text}
              hintTone={info.tone === 'need' ? palette.amber : info.tone === 'ok' ? palette.green : palette.mut}
              required={rule.min > 0}
            >
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                {group.choices.map((choice) => {
                  const on = inGroup.some((o) => o.choiceKey === choice.key);
                  const delta = deltaFor(group, variantKey, choice.priceDelta);
                  const blocked = !on && full && rule.max !== 1;
                  return (
                    <Chip
                      key={choice.key}
                      label={choice.name}
                      detail={delta ? `+${euros(delta)}` : undefined}
                      on={on}
                      disabled={blocked}
                      onPress={() => toggleChoice(group, choice.key, choice.name, choice.priceDelta)}
                      accent={brand.accent}
                      onAccent={brand.onAccent}
                    />
                  );
                })}
              </View>
            </Section>
          );
        })}

        {product.removables?.length ? (
          <Section title="Retraits" hint="Ce que le client ne veut pas">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {product.removables.map((item) => (
                <Chip
                  key={item}
                  label={`sans ${item}`}
                  on={removed.includes(item)}
                  onPress={() => toggleRemoved(item)}
                  tone="red"
                />
              ))}
            </View>
          </Section>
        ) : null}

        <Section title="Note pour la cuisine" hint="Facultatif">
          <Field
            value={note}
            onChangeText={setNote}
            placeholder="Bien cuit, sauce à part…"
            maxLength={200}
            accent={brand.accent}
          />
        </Section>
      </ScrollView>

      <View style={sheet.hairline} />

      <View style={{ padding: S.xl, gap: S.md }}>
        {missingDetail.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderRadius: R.ctrl,
              backgroundColor: withAlpha(palette.amber, 0.12),
              borderWidth: 1,
              borderColor: withAlpha(palette.amber, 0.35),
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.amber }} />
            <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: 13.5, fontWeight: '700', flex: 1 }}>
              {missingDetail.join(' · ')}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Stepper qty={qty} onChange={(n) => setQty(Math.max(1, n))} min={1} />
          <View style={{ flex: 1 }}>
            <Btn
              label={ctaLabel}
              sub={missing.length === 0 && qty > 1 ? `${euros(unit)} l'unité` : undefined}
              kind="primary"
              size="lg"
              accent={brand.accent}
              onAccent={brand.onAccent}
              disabled={missing.length > 0}
              onPress={() => onSubmit({ lineId: initial?.lineId, variantKey, options, removed, note, qty })}
              block
            />
          </View>
        </View>
      </View>
    </Overlay>
  );
}

function Section({
  title,
  hint,
  hintTone,
  required,
  children,
}: {
  title: string;
  hint?: string;
  hintTone?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: S.md }}>
      <View style={[sheet.between, { gap: S.sm }]}>
        <View style={[sheet.row, { gap: 8 }]}>
          <Text style={type.eyebrow}>{title}</Text>
          {required ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: R.pill,
                backgroundColor: withAlpha(palette.amber, 0.14),
              }}
            >
              <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: 11, fontWeight: '800' }}>REQUIS</Text>
            </View>
          ) : null}
        </View>
        {hint ? (
          <Text style={{ fontFamily: FONT, color: hintTone ?? palette.mut, fontSize: 13, fontWeight: '700' }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Convertit un brouillon de configuration en ligne de panier. */
export function draftToLine(product: Product, draft: ConfigDraft, lineId: string): CartLine {
  const variant = product.variants?.find((v) => v.key === draft.variantKey) ?? null;
  return {
    lineId,
    productId: product._id,
    name: product.name,
    variantKey: draft.variantKey,
    variantName: variant?.name ?? null,
    options: draft.options,
    removed: draft.removed,
    note: draft.note.trim() || undefined,
    qty: draft.qty,
    unitPrice: unitPrice(product, draft.variantKey, draft.options),
  };
}
