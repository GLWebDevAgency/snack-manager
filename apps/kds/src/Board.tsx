import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Order } from '@sm/client-core';
import {
  alpha,
  BOARD_STATUSES,
  CHANNEL_FILTERS,
  contrastOn,
  EMPTY_COPY,
  hair2,
  ink,
  palette,
  radius,
  STATUS_TONE,
  surface,
  tabular,
  type,
  type BoardStatus,
  type ChannelFilter,
} from './ui';
import { clockHM } from './format';
import { AllDayPanel } from './components/AllDayPanel';
import { OrderCard } from './components/OrderCard';
import { StatusColumn } from './components/StatusColumn';
import { PhoneBar, Toolbar } from './components/Toolbar';
import { CardSkeleton, EmptyState, Tap } from './components/primitives';

const ALL_DAY_WIDTH = 224;

export interface BoardProps {
  orders: Order[];
  now: number;
  accent: string;
  tenantName: string;
  online: boolean;
  loading: boolean;
  error: string | null;
  pending: number;
  pendingIds: Set<string>;
  soundOn: boolean;
  onToggleSound: () => void;
  onAdvance: (order: Order) => void;
  reducedMotion: boolean;
  phone: boolean;
  compact: boolean;
}

type PhoneTab = BoardStatus | 'allday';

export function Board(props: BoardProps) {
  const { orders, phone } = props;
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [allDay, setAllDay] = useState(true);
  const [tab, setTab] = useState<PhoneTab>('new');

  const visible = useMemo(
    () => (filter === 'all' ? orders : orders.filter((o) => o.channel === filter)),
    [orders, filter],
  );

  const grouped = useMemo(() => {
    const map: Record<BoardStatus, Order[]> = { new: [], preparing: [], ready: [] };
    for (const order of visible) {
      const bucket = map[order.status as BoardStatus];
      // La plus ancienne en tête : en cuisine, on produit dans l'ordre d'arrivée.
      if (bucket) bucket.push(order);
    }
    for (const key of BOARD_STATUSES) {
      map[key].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    }
    return map;
  }, [visible]);

  const counts = {
    new: grouped.new.length,
    preparing: grouped.preparing.length,
    ready: grouped.ready.length,
    total: visible.length,
  };

  const filterLabel =
    filter === 'all' ? undefined : CHANNEL_FILTERS.find((f) => f.key === filter)?.label;

  const banner = props.error && !props.loading ? props.error : null;

  if (phone) {
    return (
      <View style={styles.root}>
        <PhoneBar
          tenantName={props.tenantName}
          accent={props.accent}
          clock={clockHM(props.now)}
          online={props.online}
          pending={props.pending}
          soundOn={props.soundOn}
          onToggleSound={props.onToggleSound}
          reducedMotion={props.reducedMotion}
        />
        {banner ? <OfflineBanner message={banner} pending={props.pending} /> : null}

        <View style={styles.tabs}>
          {BOARD_STATUSES.map((status) => (
            <PhoneTabButton
              key={status}
              label={STATUS_TONE[status].short}
              count={counts[status]}
              active={tab === status}
              tone={STATUS_TONE[status].bg}
              onPress={() => setTab(status)}
              reducedMotion={props.reducedMotion}
            />
          ))}
          <PhoneTabButton
            label="À lancer"
            active={tab === 'allday'}
            tone={props.accent}
            onPress={() => setTab('allday')}
            reducedMotion={props.reducedMotion}
          />
        </View>

        {tab === 'allday' ? (
          <View style={styles.phoneAllDay}>
            <AllDayPanel orders={visible} accent={props.accent} filterLabel={filterLabel} />
          </View>
        ) : (
          <ScrollView
            style={styles.phoneList}
            contentContainerStyle={styles.phoneListContent}
            showsVerticalScrollIndicator={false}
          >
            {props.loading && grouped[tab].length === 0 ? (
              <>
                <CardSkeleton reducedMotion={props.reducedMotion} />
                <CardSkeleton reducedMotion={props.reducedMotion} />
              </>
            ) : grouped[tab].length === 0 ? (
              <EmptyState title={EMPTY_COPY[tab].title} hint={EMPTY_COPY[tab].hint} />
            ) : (
              grouped[tab].map((order) => (
                <OrderCard
                  key={order._id}
                  order={order}
                  now={props.now}
                  accent={props.accent}
                  reducedMotion={props.reducedMotion}
                  pending={props.pendingIds.has(order._id)}
                  onAdvance={props.onAdvance}
                />
              ))
            )}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Toolbar
        tenantName={props.tenantName}
        accent={props.accent}
        clock={clockHM(props.now)}
        online={props.online}
        pending={props.pending}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        soundOn={props.soundOn}
        onToggleSound={props.onToggleSound}
        allDayOn={allDay}
        onToggleAllDay={() => setAllDay((v) => !v)}
        reducedMotion={props.reducedMotion}
        compact={props.compact}
      />

      {banner ? <OfflineBanner message={banner} pending={props.pending} /> : null}

      <View style={styles.stage}>
        {allDay ? (
          <AllDayPanel
            orders={visible}
            accent={props.accent}
            filterLabel={filterLabel}
            style={{ width: ALL_DAY_WIDTH }}
          />
        ) : null}

        {BOARD_STATUSES.map((status) => (
          <StatusColumn
            key={status}
            status={status}
            orders={grouped[status]}
            now={props.now}
            accent={props.accent}
            reducedMotion={props.reducedMotion}
            loading={props.loading}
            pendingIds={props.pendingIds}
            onAdvance={props.onAdvance}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Bandeau de dégradation : le service continue, mais le cuisinier doit savoir
 * que ce qu'il voit n'est plus rafraîchi et que ses appuis partent en file.
 */
function OfflineBanner({ message, pending }: { message: string; pending: number }) {
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text style={styles.bannerText} numberOfLines={2}>
        Serveur injoignable — le service continue hors ligne.
        {pending > 0 ? ` ${pending} changement(s) partiront à la reconnexion.` : ''}
        <Text style={styles.bannerDetail}>{`  (${message})`}</Text>
      </Text>
    </View>
  );
}

function PhoneTabButton({
  label,
  count,
  active,
  tone,
  onPress,
  reducedMotion,
}: {
  label: string;
  count?: number;
  active: boolean;
  tone: string;
  onPress: () => void;
  reducedMotion: boolean;
}) {
  return (
    <Tap
      onPress={onPress}
      label={count === undefined ? label : `${label}, ${count} commande(s)`}
      selected={active}
      reducedMotion={reducedMotion}
      style={[
        styles.tab,
        active ? { backgroundColor: tone, borderColor: tone } : { borderColor: hair2 },
      ]}
      pressedStyle={{ backgroundColor: active ? tone : surface.el }}
    >
      <Text
        style={[styles.tabText, { color: active ? contrastOn(tone) : ink.dim }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {count === undefined ? null : (
        <Text style={[styles.tabCount, { color: active ? contrastOn(tone) : palette.text }]}>
          {count}
        </Text>
      )}
    </Tap>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  stage: { flex: 1, flexDirection: 'row', gap: 12, padding: 14, minHeight: 0 },

  banner: {
    backgroundColor: alpha(palette.red, 0.14),
    borderBottomWidth: 1,
    borderBottomColor: alpha(palette.red, 0.4),
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  bannerText: {
    fontFamily: type.body.fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: ink.onRed,
    lineHeight: 17,
  },
  bannerDetail: { fontWeight: '500', color: alpha('#ff8b7b', 0.75) },

  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    gap: 1,
  },
  tabText: {
    fontFamily: type.micro.fontFamily,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  tabCount: {
    fontFamily: type.title.fontFamily,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 20,
    ...tabular,
  },

  phoneList: { flex: 1, minHeight: 0 },
  phoneListContent: { padding: 12, gap: 12, paddingBottom: 24 },
  phoneAllDay: { flex: 1, padding: 12, minHeight: 0 },
});
