/**
 * Config express — panneau latéral ou modale selon l’espace disponible.
 *
 * Les règles min/max sont lues PAR VARIANTE via `ruleFor` du noyau partagé :
 * un tacos M impose 1 viande, un XXL en impose 4. Le bouton d'ajout reste
 * désactivé tant que `missingRequired` n'est pas vide, et l'écran dit
 * précisément ce qui manque plutôt qu'un « formulaire invalide ».
 */
import { useTheme } from './theme';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  euros,
  missingRequired,
  ruleFor,
  SUPPLEMENT_GROUP,
  unitPrice,
  type CartLine,
  type MenuSupplement,
  type OptionGroup,
  type Product,
  type SelectedOption,
} from '@sm/client-core';
import { FONT, R, S, withAlpha, type Brand } from './theme';
import { Btn, Chip, Field, InlinePanel, Overlay, Press, PanelHead, Stepper } from './ui';
import { useLayout } from './useLayout';
import { optionsForVariant } from './quick-config-options';

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
  inline = false,
  visible = true,
  onClose,
  onSubmit,
}: {
  product: Product;
  categoryName?: string;
  brand: Brand;
  initial?: ConfigDraft;
  inline?: boolean;
  visible?: boolean;
  onClose: () => void;
  onSubmit: (draft: ConfigDraft) => void;
}) {
  const { sheet, palette, type } = useTheme();
  const L = useLayout();
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
    // Changer de taille resserre les règles : on tronque les groupes au nouveau
    // plafond. Ce qui NE RELÈVE PAS d'un groupe de la carte est conservé tel
    // quel — les suppléments, notamment.
    setOptions((cur) => optionsForVariant(groups, cur, key));
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

  /**
   * Les suppléments voyagent comme des options du groupe réservé
   * « supplements » : le serveur y retrouve le prix depuis la fiche
   * ingrédient. Le montant porté ici ne sert qu'à l'affichage immédiat au
   * comptoir — il est recalculé à la création de la commande.
   */
  function toggleSupplement(sup: MenuSupplement) {
    setOptions((cur) => {
      const already = cur.some(
        (o) => o.groupKey === SUPPLEMENT_GROUP && o.choiceKey === sup.key,
      );
      if (already) {
        return cur.filter(
          (o) => !(o.groupKey === SUPPLEMENT_GROUP && o.choiceKey === sup.key),
        );
      }
      return [
        ...cur,
        {
          groupKey: SUPPLEMENT_GROUP,
          choiceKey: sup.key,
          name: sup.label,
          priceDelta: sup.priceCents,
        },
      ];
    });
  }

  const ctaLabel = missing.length === 0 ? `${initial?.lineId ? 'Mettre à jour' : 'Ajouter'} · ${euros(unit * qty)}` : 'Complétez la configuration';

  const content = (
    <>
      <PanelHead
        title={product.name}
        sub={[categoryName, product.description].filter(Boolean).join(' · ') || undefined}
        onClose={onClose}
      />
      <View style={sheet.hairline} />

      <ScrollView
        // Plus de hauteur figée : la modale est bornée à l'écran et c'est ce
        // bloc qui absorbe la différence. Sur une 10" en portrait, le pied et
        // son bouton d'ajout restent visibles, le contenu défile.
        style={inline ? { flex: 1, minHeight: 0 } : { flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: L.sp(inline ? 16 : 20), paddingTop: L.sp(6), paddingBottom: L.sp(16), gap: L.sp(14) }}
        keyboardShouldPersistTaps="handled"
      >
        {variants.length > 0 ? (
          <Section title="Taille" hint={`${variants.length} formats`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {variants.map((v) => (
                <Press
                  key={v.key}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${v.name} ${euros(v.price)}`}
                  selected={v.key === variantKey}
                  onPress={() => pickVariant(v.key)}
                  style={{ minWidth: L.sp(120), flexBasis: '46%', flexGrow: 1, minHeight: L.touch(64), padding: L.sp(12), borderRadius: R.card, borderWidth: 1, borderColor: v.key === variantKey ? brand.accent : palette.line2, backgroundColor: v.key === variantKey ? brand.tint : palette.surface2 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: L.sp(8) }}>
                    <Text style={[type.strong, { flex: 1, flexShrink: 1, fontSize: L.fs(15) }]}>{v.name}</Text>
                    <Text style={[type.num, { flexShrink: 0, fontWeight: '800', fontSize: L.fs(14) }]}>{euros(v.price)}</Text>
                  </View>
                </Press>
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
              hintTone={info.tone === 'need' ? palette.amberText : info.tone === 'ok' ? palette.greenText : palette.mut}
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
                      detail={delta === 0 ? 'Inclus' : `+${euros(delta)}`}
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
          <Section
            title="Retraits express"
            hint={removed.length === 0 ? 'Complet par défaut' : 'Ce que le client ne veut pas'}
          >
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              <Chip
                label="Complet"
                on={removed.length === 0}
                onPress={() => setRemoved([])}
                accent={brand.accent}
                onAccent={brand.onAccent}
              />
              {product.removables.map((item) => (
                <Chip
                  key={item.key}
                  label={`sans ${item.label.toLowerCase()}`}
                  on={removed.includes(item.key)}
                  onPress={() => toggleRemoved(item.key)}
                  tone="red"
                />
              ))}
            </View>
          </Section>
        ) : null}

        {product.supplements?.length ? (
          <Section title="Suppléments" hint="Ce que le client ajoute — facturé">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
              {product.supplements.map((sup) => (
                <Chip
                  key={sup.key}
                  label={`${sup.label} +${euros(sup.priceCents)}`}
                  on={options.some(
                    (o) => o.groupKey === SUPPLEMENT_GROUP && o.choiceKey === sup.key,
                  )}
                  onPress={() => toggleSupplement(sup)}
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

      <View style={{ padding: L.sp(inline ? 16 : 20), gap: L.sp(S.md), backgroundColor: palette.footBg }}>
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
            <Text style={{ fontFamily: FONT, color: palette.amberText, fontSize: L.fs(13.5), fontWeight: '700', flex: 1 }}>
              {missingDetail.join(' · ')}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Stepper qty={qty} onChange={(n) => setQty(Math.max(1, n))} min={1} />
          <View style={{ flex: 1 }}>
            <Btn
              label={missing.length > 0 && L.width < 380 ? 'Choix requis' : ctaLabel}
              accessibilityLabel={ctaLabel}
              sub={missing.length === 0 && qty > 1 ? `${euros(unit)} l'unité` : undefined}
              kind="primary"
              size="md"
              style={{ paddingHorizontal: L.sp(8) }}
              accent={brand.accent}
              onAccent={brand.onAccent}
              disabled={missing.length > 0}
              onPress={() => onSubmit({ lineId: initial?.lineId, variantKey, options, removed, note, qty })}
              block
            />
          </View>
        </View>
      </View>
    </>
  );
  if (!visible) return null;
  return inline ? (
    <InlinePanel width={L.cfgW} onClose={onClose} label={`Configurer ${product.name}`}>{content}</InlinePanel>
  ) : (
    <Overlay onClose={onClose} accessibilityLabel={`Configurer ${product.name}`} width={520}>{content}</Overlay>
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
  const { sheet, type, palette } = useTheme();
  return (
    <View style={{ gap: S.md }}>
      <View style={[sheet.between, { gap: S.sm, flexWrap: 'wrap' }]}>
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
              <Text style={{ fontFamily: FONT, color: palette.amberText, fontSize: 11, fontWeight: '800' }}>REQUIS</Text>
            </View>
          ) : null}
        </View>
        {hint ? (
          <Text style={{ fontFamily: FONT, color: hintTone ?? palette.mut, fontSize: 13, fontWeight: '700', flexShrink: 1 }}>
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
