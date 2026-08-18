import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Order } from '@sm/client-core';
import { hair, hair2, ink, radius, surface, tabular, type } from '../ui';
import { Sheen } from './primitives';

/**
 * Panneau « À lancer » (All Day) — le cumul de production, toutes commandes
 * confondues, pour les statuts « Nouveau » et « En préparation ».
 *
 * Deux écarts assumés avec la maquette :
 *  1. l'agrégation inclut la **variante** (« Tacos XL » ≠ « Tacos L ») : en
 *     cuisine ce sont deux gestes différents, les cumuler serait trompeur ;
 *  2. le panneau **suit le filtre canal** de la barre haute, pour rester
 *     cohérent avec ce que les colonnes affichent au même instant.
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
}: {
  orders: Order[];
  accent: string;
  /** Nom du filtre canal actif, affiché en pied quand il n'est pas « Tous ». */
  filterLabel?: string;
  style?: { width?: number };
}) {
  const lines = useMemo(() => aggregate(orders), [orders]);
  const total = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <View style={[styles.panel, style]}>
      <Sheen height={80} radius={radius.lg} />

      <View style={styles.header}>
        <Text style={styles.title}>À lancer</Text>
        <View style={[styles.total, { borderColor: accent }]}>
          <Text style={[styles.totalText, { color: accent }]}>{total}</Text>
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
              <Text style={[styles.qty, { color: accent }]}>{line.qty}×</Text>
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

const styles = StyleSheet.create({
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
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: hair2,
  },
  title: {
    fontFamily: type.title.fontFamily,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#ffffff',
  },
  total: {
    minWidth: 30,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalText: { fontFamily: type.title.fontFamily, fontSize: 14, fontWeight: '900', ...tabular },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  qty: {
    fontFamily: type.qty.fontFamily,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.5,
    minWidth: 34,
    lineHeight: 21,
    ...tabular,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  name: {
    fontFamily: type.item.fontFamily,
    fontSize: 14.5,
    fontWeight: '700',
    lineHeight: 19,
    color: '#ffffff',
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
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: ink.dim,
  },
  empty: { fontFamily: type.body.fontFamily, fontSize: 13.5, color: ink.dim, paddingVertical: 8 },
  footer: { paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: hair2 },
  footerText: {
    fontFamily: type.micro.fontFamily,
    fontSize: 11.5,
    fontWeight: '600',
    color: ink.dimmer,
    lineHeight: 15,
  },
});
