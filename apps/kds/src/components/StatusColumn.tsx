import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Order } from '@sm/client-core';
import {
  EMPTY_COPY,
  hair2,
  radius,
  space,
  STATUS_TONE,
  surface,
  tabular,
  type,
  type BoardStatus,
} from '../ui';
import { CardSkeleton, EmptyState } from './primitives';
import { OrderCard } from './OrderCard';

/**
 * Une colonne de statut. L'en-tête porte la couleur fonctionnelle du statut —
 * c'est le seul aplat coloré large de l'écran, et il sert de repère à distance :
 * rouge = à prendre, ambre = en cours, vert = à remettre.
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
}: {
  status: BoardStatus;
  orders: Order[];
  now: number;
  accent: string;
  reducedMotion: boolean;
  loading: boolean;
  pendingIds: Set<string>;
  onAdvance: (order: Order) => void;
}) {
  const tone = STATUS_TONE[status];
  const empty = EMPTY_COPY[status];

  return (
    <View style={styles.column}>
      <View style={[styles.header, { backgroundColor: tone.bg }]}>
        <Text style={[styles.headerLabel, { color: tone.fg }]} numberOfLines={1}>
          {tone.label}
        </Text>
        <View style={[styles.badge, { backgroundColor: tone.badge }]}>
          <Text style={[styles.badgeText, { color: tone.fg }]}>{orders.length}</Text>
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
            <CardSkeleton reducedMotion={reducedMotion} />
            <CardSkeleton reducedMotion={reducedMotion} />
          </>
        ) : orders.length === 0 ? (
          <EmptyState title={empty.title} hint={empty.hint} />
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
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    minWidth: 0,
    backgroundColor: surface.column,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: hair2,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  headerLabel: {
    fontFamily: type.title.fontFamily,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  badge: {
    minWidth: 30,
    height: 26,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: type.title.fontFamily, fontSize: 15, fontWeight: '900', ...tabular },
  body: { flex: 1, minHeight: 0 },
  bodyContent: { padding: 12, gap: 12, paddingBottom: 18 },
});
