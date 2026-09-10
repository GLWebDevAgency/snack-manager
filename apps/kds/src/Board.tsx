import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Order } from '@sm/client-core';
import {
  alpha,
  BOARD_STATUSES,
  CHANNEL_FILTERS,
  contrastOn,
  EMPTY_COPY,
  radius,
  STATUS_TONE,
  tabular,
  type BoardStatus,
  type ChannelFilter,
} from './ui';
import { clockHM } from './format';
import { makeUi } from './ui';
import { useUi } from './theme';
import type { KdsDensity } from './prefs';
import { SMMark, BRAND_GOLD } from '@sm/ui-native';
import { scaledStyles, type Layout } from './useLayout';
import { aggregate, AllDayPanel } from './components/AllDayPanel';
import { OrderCard } from './components/OrderCard';
import { StatusColumn } from './components/StatusColumn';
import { CompactBar, Toolbar } from './components/Toolbar';
import { CardSkeleton, EmptyState, Tap } from './components/primitives';

/**
 * Le plateau. Deux régimes, tranchés par `useLayout` et par lui seul :
 *
 *  - **colonnes** (≥ 900 px) — les trois statuts se partagent la largeur à
 *    parts égales ; le panneau « À lancer » n'apparaît que s'il reste la place
 *    (≥ 1240 px), sinon il se replie AVANT que les colonnes ne se serrent ;
 *  - **onglets** (< 900 px) — une seule liste, un onglet par statut avec son
 *    compteur, plus un onglet « À lancer ». C'est le comportement téléphone
 *    prévu par la spec, étendu à toute fenêtre étroite (tablette en portrait,
 *    gérant qui jette un œil depuis son bureau).
 */

export interface BoardProps {
  density?: KdsDensity;
  logoUrl?: string | null;
  onSettings?: () => void;
  onLogout?: () => void;
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
  /**
   * Panneau « À lancer » épinglé — décidé par `App`, pas ici.
   *
   * Cet état ne pilote pas seulement un affichage : il entre dans le calcul de
   * mise en page (`useLayout`), qui rend au panneau sa largeur et retire
   * d'autant aux colonnes. Le garder dans le tableau le privait de tout effet
   * dès que la fenêtre passait sous le seuil de repli.
   */
  allDayOn: boolean;
  onToggleAllDay: () => void;
  onAdvance: (order: Order) => void;
  reducedMotion: boolean;
  layout: Layout;
}

type CompactTab = BoardStatus | 'allday';

export function Board(props: BoardProps) {
  const { orders, layout } = props;
  const { theme, palette, type } = useUi();
  const styles = boardStyles(layout, theme);
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [tab, setTab] = useState<CompactTab>('new');

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

  /** Cumul « À lancer », pour le compteur de l'onglet en mode compact. */
  const toLaunch = useMemo(
    () => aggregate(visible).reduce((sum, line) => sum + line.qty, 0),
    [visible],
  );

  const filterLabel =
    filter === 'all' ? undefined : CHANNEL_FILTERS.find((f) => f.key === filter)?.label;

  const banner = props.error && !props.loading ? props.error : null;

  // ─── Régime onglets ───
  if (layout.compact) {
    return (
      <View style={styles.root}>
        <CompactBar
          tenantName={props.tenantName}
          logoUrl={props.logoUrl}
          onSettings={props.onSettings}
          filter={filter}
          onFilter={setFilter}
          accent={props.accent}
          clock={clockHM(props.now)}
          online={props.online}
          pending={props.pending}
          soundOn={props.soundOn}
          onToggleSound={props.onToggleSound}
          reducedMotion={props.reducedMotion}
          layout={layout}
        />
        {banner ? <OfflineBanner message={banner} pending={props.pending} layout={layout} /> : null}

        <View style={styles.tabs} accessibilityRole="tablist">
          {BOARD_STATUSES.map((status) => (
            <TabButton
              key={status}
              label={STATUS_TONE[status].short}
              count={counts[status]}
              active={tab === status}
              tone={STATUS_TONE[status].bg}
              onPress={() => setTab(status)}
              reducedMotion={props.reducedMotion}
              layout={layout}
            />
          ))}
          <TabButton
            label="À lancer"
            count={toLaunch}
            noun="article"
            active={tab === 'allday'}
            tone={props.accent}
            onPress={() => setTab('allday')}
            reducedMotion={props.reducedMotion}
            layout={layout}
          />
        </View>

        {tab === 'allday' ? (
          <View style={styles.compactAllDay}>
            <AllDayPanel
              orders={visible}
              accent={props.accent}
              filterLabel={filterLabel}
              style={styles.fill}
              layout={layout}
            />
          </View>
        ) : (
          <ScrollView
            style={styles.compactList}
            contentContainerStyle={styles.compactListContent}
            showsVerticalScrollIndicator={false}
          >
            {props.loading && grouped[tab].length === 0 ? (
              <>
                <CardSkeleton reducedMotion={props.reducedMotion} layout={layout} />
                <CardSkeleton reducedMotion={props.reducedMotion} layout={layout} />
              </>
            ) : grouped[tab].length === 0 ? (
              <EmptyState
                title={EMPTY_COPY[tab].title}
                hint={EMPTY_COPY[tab].hint}
                layout={layout}
              />
            ) : (
              grouped[tab].map((order) => (
                <OrderCard
                  density={props.density}
                  key={order._id}
                  order={order}
                  now={props.now}
                  accent={props.accent}
                  reducedMotion={props.reducedMotion}
                  pending={props.pendingIds.has(order._id)}
                  onAdvance={props.onAdvance}
                  layout={layout}
                />
              ))
            )}
          </ScrollView>
        )}
      </View>
    );
  }

  // ─── Régime colonnes ───
  //
  // `layout.allDayW` vaut 0 quand le panneau ne doit pas s'afficher — soit
  // parce que le cuisinier l'a décroché, soit parce que la fenêtre est trop
  // étroite ET qu'il ne l'a pas épinglé. La décision est prise dans
  // `computeLayout`, qui connaît la préférence : ici on ne fait que la lire.
  const showAllDay = props.allDayOn && layout.allDayW > 0;

  return (
    <View style={styles.root}>
      <Toolbar
        tenantName={props.tenantName}
        logoUrl={props.logoUrl}
        onSettings={props.onSettings}
        onLogout={props.onLogout}
        accent={props.accent}
        clock={clockHM(props.now)}
        online={props.online}
        pending={props.pending}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        soundOn={props.soundOn}
        onToggleSound={props.onToggleSound}
        allDayOn={props.allDayOn}
        onToggleAllDay={props.onToggleAllDay}
        reducedMotion={props.reducedMotion}
        layout={layout}
      />

      {banner ? <OfflineBanner message={banner} pending={props.pending} layout={layout} /> : null}

      <View style={styles.stage}>
        {showAllDay ? (
          <AllDayPanel
            orders={visible}
            accent={props.accent}
            filterLabel={filterLabel}
            style={{ width: layout.allDayW }}
            layout={layout}
          />
        ) : null}

        {BOARD_STATUSES.map((status) => (
          <StatusColumn
            density={props.density}
            key={status}
            status={status}
            orders={grouped[status]}
            now={props.now}
            accent={props.accent}
            reducedMotion={props.reducedMotion}
            loading={props.loading}
            pendingIds={props.pendingIds}
            onAdvance={props.onAdvance}
            layout={layout}
          />
        ))}
      </View>
      <View style={{ position: 'absolute', bottom: layout.fs(2), right: layout.pad + layout.fs(4), flexDirection: 'row', alignItems: 'center', gap: layout.fs(6), opacity: 0.55, pointerEvents: 'none' }}>
        <SMMark size={layout.fs(16)} color={palette.text} accessible={false} />
        <Text style={{ fontFamily: type.body.fontFamily, fontSize: layout.fs(10.5), fontWeight: '600', color: palette.text }}>Propulsé par Snack <Text style={{ color: BRAND_GOLD }}>Manager</Text></Text>
      </View>
    </View>
  );
}

/**
 * Bandeau de dégradation : le service continue, mais le cuisinier doit savoir
 * que ce qu'il voit n'est plus rafraîchi et que ses appuis partent en file.
 */
function OfflineBanner({
  message,
  pending,
  layout,
}: {
  message: string;
  pending: number;
  layout: Layout;
}) {
  const { theme } = useUi();
  const styles = boardStyles(layout, theme);
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

/**
 * Onglet de statut du mode compact. Il remplace un en-tête de colonne : il en
 * porte donc la couleur ET le compteur, sinon on perd le coup d'œil « combien
 * il en reste » qui fait tout l'intérêt du tableau.
 */
function TabButton({
  label,
  count,
  noun = 'commande',
  active,
  tone,
  onPress,
  reducedMotion,
  layout,
}: {
  label: string;
  count?: number;
  /** Ce que compte le badge — des commandes, sauf « À lancer » qui cumule des articles. */
  noun?: 'commande' | 'article';
  active: boolean;
  tone: string;
  onPress: () => void;
  reducedMotion: boolean;
  layout: Layout;
}) {
  const { theme, palette, hair2, ink, surface } = useUi();
  const styles = boardStyles(layout, theme);
  return (
    <Tap
      onPress={onPress}
      label={count === undefined ? label : `${label}, ${count} ${noun}(s)`}
      selected={active}
      role="tab"
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

const boardStyles = scaledStyles((l: Layout, theme) => {
  const { palette, surface, ink, hair2, type } = makeUi(theme);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.bg },
    stage: { flex: 1, flexDirection: 'row', gap: l.gap, padding: l.pad, paddingBottom: l.pad + l.fs(14), minHeight: 0 },

    banner: {
      backgroundColor: alpha(palette.red, 0.14),
      borderBottomWidth: 1,
      borderBottomColor: alpha(palette.red, 0.4),
      paddingHorizontal: l.pad + 2,
      paddingVertical: 9,
    },
    bannerText: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13),
      fontWeight: '700',
      color: ink.onRed,
      lineHeight: l.fs(17),
    },
    bannerDetail: { fontWeight: '500', color: ink.onRed },

    tabs: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: l.gap,
      paddingTop: 10,
      paddingBottom: 4,
    },
    // Un onglet est la navigation principale du mode compact : au moins aussi
    // haut qu'un bouton d'action, donc ≥ 56 px, et jamais sous la cible tactile.
    tab: {
      flex: 1,
      minHeight: Math.max(l.touch, l.actionH),
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
      fontSize: l.fs(12),
      fontWeight: '800',
      letterSpacing: 0.3,
      textAlign: 'center',
    },
    tabCount: {
      fontFamily: type.title.fontFamily,
      fontSize: l.far(18),
      fontWeight: '900',
      lineHeight: l.far(21),
      ...tabular,
    },

    compactList: { flex: 1, minHeight: 0 },
    compactListContent: { padding: l.gap, gap: l.gap, paddingBottom: l.gap * 2 },
    compactAllDay: { flex: 1, padding: l.gap, minHeight: 0 },
    // Longhands (et non `flex: 1`) : le panneau porte déjà `flexShrink: 0`,
    // seule une surcharge propriété par propriété le neutralise à coup sûr.
    fill: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
  });
});
