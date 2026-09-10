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
 * Une colonne de statut. L'en-tête porte la couleur fonctionnelle du statut —
 * c'est le seul aplat coloré large de l'écran, et il sert de repère à distance :
 * rouge = à prendre, ambre = en cours, vert = à remettre. Il suit donc l'échelle
 * `far()` : sur un mural, on doit reconnaître la colonne avant de lire un mot.
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
  const { theme } = useUi();
  const styles = columnStyles(layout, theme);
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
  const { surface, hair2, type } = makeUi(theme);
  return StyleSheet.create({
    column: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
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
      paddingHorizontal: Math.round(14 * l.scale),
      paddingVertical: Math.round(11 * l.scale),
    },
    headerLabel: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(15),
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      flexShrink: 1,
    },
    badge: {
      minWidth: l.far(30),
      height: l.far(26),
      borderRadius: radius.pill,
      paddingHorizontal: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(15),
      fontWeight: '900',
      ...tabular,
    },
    body: { flex: 1, minHeight: 0 },
    bodyContent: { padding: l.gap, gap: l.gap, paddingBottom: l.gap + 6 },
  });
});
