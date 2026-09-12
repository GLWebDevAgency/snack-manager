import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Order } from '@sm/client-core';
import {
  EMPTY_COPY,
  makeUi,
  radius,
  space,
  STATUS_TONE,
  tabular,
  type BoardStatus,
} from '../ui';
import { useUi } from '../theme';
import { scaledStyles, type Layout } from '../useLayout';
import { CardSkeleton, EmptyState } from './primitives';
import { OrderCard } from './OrderCard';

/**
 * Une colonne de statut. Le repère et le compteur gardent la couleur
 * fonctionnelle : rouge = à prendre, ambre = en cours, vert = à remettre.
 * Le titre suit `far()` pour rester lisible depuis le poste de cuisson.
 *
 * Les trois colonnes se partagent la largeur à parts égales (`flex: 1`) : leur
 * dimension n'est jamais codée en dur, c'est `useLayout` qui décide seulement
 * s'il y a la place pour le panneau « À lancer » à côté.
 */
export function StatusColumn({
  status,
  orders,
  now,
  accent,
  reducedMotion,
  loading,
  pendingIds,
  onAdvance,
  layout,
  density = 'comfort',
}: {
  status: BoardStatus;
  orders: Order[];
  now: number;
  accent: string;
  reducedMotion: boolean;
  loading: boolean;
  pendingIds: Set<string>;
  onAdvance: (order: Order) => void;
  layout: Layout;
  density?: 'comfort' | 'dense';
}) {
  const { theme, statusColors } = useUi();
  const styles = columnStyles(layout, theme);
  const tone = STATUS_TONE[status];
  const empty = EMPTY_COPY[status];

  return (
    <View style={styles.column}>
      <View style={styles.header}>
        <View accessible={false} style={[styles.statusDot, { backgroundColor: tone.bg }]} />
        <Text accessibilityRole="header" style={styles.headerLabel} numberOfLines={1}>
          {tone.label}
        </Text>
        <View style={[styles.badge, { backgroundColor: statusColors[status].wash }]}>
          <Text style={[styles.badgeText, { color: statusColors[status].ink }]}>{orders.length}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        accessibilityLabel={`Colonne ${tone.label}, ${orders.length} commande(s)`}
      >
        {loading && orders.length === 0 ? (
          <>
            <CardSkeleton reducedMotion={reducedMotion} layout={layout} />
            <CardSkeleton reducedMotion={reducedMotion} layout={layout} />
          </>
        ) : orders.length === 0 ? (
          <EmptyState icon={status === 'new' ? 'kds-bell' : status === 'preparing' ? 'kds-flame' : 'check'} title={empty.title} hint={empty.hint} layout={layout} />
        ) : (
          orders.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              now={now}
              accent={accent}
              reducedMotion={reducedMotion}
              pending={pendingIds.has(order._id)}
              onAdvance={onAdvance}
              layout={layout}
              density={density}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const columnStyles = scaledStyles((l: Layout, theme) => {
  const { surface, type, palette } = makeUi(theme);
  return StyleSheet.create({
    column: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      backgroundColor: surface.column,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      paddingHorizontal: l.fs(2),
      paddingVertical: Math.round(12 * l.scale),
    },
    statusDot: { width: l.far(8), height: l.far(8), borderRadius: radius.pill },
    headerLabel: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(15),
      fontWeight: '700',
      letterSpacing: -0.3,
      flex: 1,
      color: palette.text,
    },
    badge: {
      minWidth: l.far(25),
      height: l.far(24),
      borderRadius: radius.xs,
      paddingHorizontal: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(13),
      fontWeight: '600',
      ...tabular,
    },
    body: { flex: 1, minHeight: 0 },
    bodyContent: { paddingHorizontal: 1, gap: l.gap, paddingBottom: l.gap + 6 },
  });
});
