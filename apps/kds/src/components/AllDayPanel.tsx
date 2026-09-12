import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { Order } from '@sm/client-core';
import { makeUi, radius, tabular } from '../ui';
import { useAccentText, useUi } from '../theme';
import { scaledStyles, type Layout } from '../useLayout';

/**
 * Panneau « À lancer » (All Day) — le cumul de production, toutes commandes
 * confondues, pour les statuts « Nouveau » et « En préparation ».
 *
 * La présentation conserve l'agrégation par nom ET variante, ainsi que le
 * filtre canal appliqué aux colonnes. Changer de thème ne change aucun cumul.
 */

export interface ProductionLine {
  key: string;
  name: string;
  variant: string | null;
  qty: number;
}

export function aggregate(orders: Order[]): ProductionLine[] {
  const totals = new Map<string, ProductionLine>();
  for (const order of orders) {
    if (order.status !== 'new' && order.status !== 'preparing') continue;
    for (const line of order.lines) {
      // Nom + variante : « Tacos L » et « Tacos XL » restent deux lignes.
      const key = `${line.name}||${line.variantName ?? ''}`;
      const current = totals.get(key);
      if (current) current.qty += Math.max(1, line.qty);
      else
        totals.set(key, {
          key,
          name: line.name,
          variant: line.variantName ?? null,
          qty: Math.max(1, line.qty),
        });
    }
  }
  return [...totals.values()].sort(
    (a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'fr'),
  );
}

export function AllDayPanel({
  orders,
  accent,
  filterLabel,
  style,
  layout,
}: {
  orders: Order[];
  accent: string;
  /** Nom du filtre canal actif, affiché en pied quand il n'est pas « Tous ». */
  filterLabel?: string;
  /**
   * Dimension imposée par le plateau : une largeur calculée en mode colonnes,
   * une occupation complète quand le panneau est le contenu d'un onglet.
   */
  style?: StyleProp<ViewStyle>;
  layout: Layout;
}) {
  const { theme } = useUi();
  const accentText = useAccentText(accent);
  const styles = panelStyles(layout, theme);
  const lines = useMemo(() => aggregate(orders), [orders]);
  const total = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <View style={[styles.panel, style]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>À lancer</Text>
        <View style={[styles.total, { borderColor: accent }]}>
          <Text style={[styles.totalText, { color: accentText }]}>{total}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {lines.length === 0 ? (
          <Text style={styles.empty}>Rien à préparer.</Text>
        ) : (
          lines.map((line) => (
            <View key={line.key} style={styles.row}>
              <Text style={[styles.qty, { color: accentText }]}>{line.qty}×</Text>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{line.name}</Text>
                {line.variant ? (
                  <View style={styles.variant}>
                    <Text style={styles.variantText}>{line.variant}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={2}>
          Cumul Nouveau + En préparation
          {filterLabel ? ` · ${filterLabel}` : ''}
        </Text>
      </View>
    </View>
  );
}

const panelStyles = scaledStyles((l: Layout, theme) => {
  const { surface, hair, hair2, ink, type, palette } = makeUi(theme);
  return StyleSheet.create({
    panel: {
      backgroundColor: surface.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: hair2,
      overflow: 'hidden',
      flexShrink: 0,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: Math.round(14 * l.scale),
      paddingVertical: Math.round(12 * l.scale),
      borderBottomWidth: 1,
      borderBottomColor: hair2,
    },
    title: {
      fontFamily: type.title.fontFamily,
      fontSize: l.fs(17),
      fontWeight: '700',
      letterSpacing: -0.3,
      color: palette.text,
    },
    total: {
      minWidth: l.far(30),
      height: l.far(26),
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    totalText: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(14),
      fontWeight: '900',
      ...tabular,
    },
    body: { flex: 1, minHeight: 0 },
    bodyContent: { paddingHorizontal: l.gap, paddingVertical: 10, gap: Math.round(10 * l.scale) },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingBottom: l.fs(10), borderBottomWidth: 1, borderBottomColor: hair2 },
    // Le cumul se lit en enfilade depuis le poste : quantité en échelle « loin ».
    qty: {
      fontFamily: type.qty.fontFamily,
      fontSize: l.far(18),
      fontWeight: '900',
      letterSpacing: -0.5,
      minWidth: l.far(34),
      lineHeight: l.far(21),
      ...tabular,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
    name: {
      fontFamily: type.item.fontFamily,
      fontSize: l.far(14.5),
      fontWeight: '700',
      lineHeight: l.far(19),
      color: palette.text,
    },
    variant: {
      backgroundColor: surface.el2,
      borderWidth: 1,
      borderColor: hair,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    variantText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(12.5),
      fontWeight: '800',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
      color: ink.dim,
    },
    empty: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13.5),
      color: ink.dim,
      paddingVertical: 8,
    },
    footer: {
      paddingHorizontal: l.gap,
      paddingVertical: 9,
      borderTopWidth: 1,
      borderTopColor: hair2,
    },
    footerText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11.5),
      fontWeight: '600',
      color: ink.dimmer,
      lineHeight: l.fs(15),
    },
  });
});
