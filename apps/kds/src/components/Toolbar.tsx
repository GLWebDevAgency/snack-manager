import { StyleSheet, Text, View } from 'react-native';
import {
  alpha,
  CHANNEL_FILTERS,
  contrastOn,
  hair,
  hair2,
  ink,
  palette,
  STATUS_TONE,
  surface,
  tabular,
  type,
  type ChannelFilter,
} from '../ui';
import { scaledStyles, type Layout } from '../useLayout';
import { Chip, Pill, Sheen, StatusDot } from './primitives';

export interface Counts {
  new: number;
  preparing: number;
  ready: number;
  total: number;
}

export interface ToolbarProps {
  tenantName: string;
  accent: string;
  clock: string;
  online: boolean;
  pending: number;
  counts: Counts;
  filter: ChannelFilter;
  onFilter: (value: ChannelFilter) => void;
  soundOn: boolean;
  onToggleSound: () => void;
  allDayOn: boolean;
  onToggleAllDay: () => void;
  reducedMotion: boolean;
  layout: Layout;
}

function BrandTile({
  name,
  accent,
  size = 34,
}: {
  name: string;
  accent: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.brand,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          backgroundColor: accent,
        },
      ]}
    >
      <Text
        style={[
          styles.brandLetter,
          { fontSize: Math.round(size * 0.52), color: contrastOn(accent) },
        ]}
      >
        {(name.trim()[0] ?? 'S').toUpperCase()}
      </Text>
    </View>
  );
}

function Counter({
  value,
  label,
  color,
  layout,
}: {
  value: number;
  label: string;
  color: string;
  layout: Layout;
}) {
  const bar = barStyles(layout);
  return (
    <View style={bar.counter}>
      <Text style={[bar.counterValue, { color }]}>{value}</Text>
      <Text style={bar.counterLabel}>{label}</Text>
    </View>
  );
}

/** Pastille d'état réseau + file offline — toujours visible, jamais alarmiste sans raison. */
function SyncBadge({
  online,
  pending,
  layout,
}: {
  online: boolean;
  pending: number;
  layout: Layout;
}) {
  if (!online) {
    return <Pill text="Hors ligne" color="#ffffff" background={palette.red} layout={layout} />;
  }
  if (pending > 0) {
    return (
      <Pill
        text={`${pending} en attente`}
        color={ink.onAmber}
        background={alpha(palette.amber, 0.16)}
        border={alpha(palette.amber, 0.5)}
        layout={layout}
      />
    );
  }
  return null;
}

export function Toolbar({
  tenantName,
  accent,
  clock,
  online,
  pending,
  counts,
  filter,
  onFilter,
  soundOn,
  onToggleSound,
  allDayOn,
  onToggleAllDay,
  reducedMotion,
  layout,
}: ToolbarProps) {
  const bar = barStyles(layout);
  return (
    <View style={bar.bar}>
      <Sheen height={layout.fs(70)} />

      {/* ─── Identité & état de connexion ─── */}
      <View style={styles.left}>
        <BrandTile name={tenantName} accent={accent} size={Math.round(34 * layout.scale)} />
        <View style={styles.identity}>
          <Text style={bar.appTitle} numberOfLines={1}>
            Cuisine · KDS
          </Text>
          <View style={styles.connection}>
            <StatusDot color={online ? palette.green : palette.red} size={layout.fs(9)} />
            <Text style={bar.connectionText} numberOfLines={1}>
              {online ? 'En ligne' : 'Hors ligne'} · {tenantName}
            </Text>
          </View>
        </View>
      </View>

      {/* ─── Filtre canal ─── */}
      <View
        style={bar.filters}
        accessibilityRole="tablist"
        accessibilityLabel="Filtrer par canal de commande"
      >
        {CHANNEL_FILTERS.map((option) => (
          <Chip
            key={option.key}
            text={option.label}
            active={filter === option.key}
            onPress={() => onFilter(option.key)}
            accent={accent}
            reducedMotion={reducedMotion}
            tone={{ bg: accent, fg: contrastOn(accent) }}
            layout={layout}
          />
        ))}
      </View>

      {/* ─── Compteurs, horloge, bascules ─── */}
      <View style={bar.right}>
        {!layout.denseToolbar ? (
          <>
            <Counter
              value={counts.new}
              label="Nouveau"
              color={STATUS_TONE.new.bg}
              layout={layout}
            />
            <Counter
              value={counts.preparing}
              label="En prépa"
              color={STATUS_TONE.preparing.bg}
              layout={layout}
            />
            <Counter
              value={counts.ready}
              label="Prêt"
              color={STATUS_TONE.ready.bg}
              layout={layout}
            />
            <View style={bar.divider} />
          </>
        ) : null}

        <Counter value={counts.total} label="Actives" color={palette.text} layout={layout} />

        <View style={bar.divider} />
        <Text style={bar.clock}>{clock}</Text>

        <SyncBadge online={online} pending={pending} layout={layout} />

        {/*
          LA BASCULE RESTE TOUJOURS LÀ, en régime colonnes.

          Elle disparaissait auparavant sous `ALLDAY_MIN_SCREEN`, « plutôt que
          de mentir sur son effet ». L'intention était juste, la conclusion
          inversée : un bouton qui ne peut rien doit être RENDU CAPABLE, pas
          effacé. Sur une tablette en portrait ou un écran de comptoir un peu
          étroit, le cuisinier perdait la seule vue qui agrège ce qu'il a à
          lancer — sans explication et sans recours.

          Épinglé, le panneau prend maintenant sa largeur minimale et les
          colonnes se resserrent. C'est un arbitrage, et il lui appartient.
          En régime compact, il reste un onglet : le bouton n'aurait pas de sens.
        */}
        <Chip
          text="À lancer"
          active={allDayOn}
          onPress={onToggleAllDay}
          accent={accent}
          reducedMotion={reducedMotion}
          tone={{ bg: accent, fg: contrastOn(accent) }}
          layout={layout}
        />
        <Chip
          text={soundOn ? 'Son' : 'Muet'}
          active={soundOn}
          onPress={onToggleSound}
          accent={accent}
          reducedMotion={reducedMotion}
          tone={{ bg: accent, fg: contrastOn(accent) }}
          layout={layout}
        />
      </View>
    </View>
  );
}

/** Barre du mode compact (téléphone, petite tablette) — titre, horloge, réseau, son. */
export function CompactBar({
  tenantName,
  accent,
  clock,
  online,
  pending,
  soundOn,
  onToggleSound,
  reducedMotion,
  layout,
}: Pick<
  ToolbarProps,
  | 'tenantName'
  | 'accent'
  | 'clock'
  | 'online'
  | 'pending'
  | 'soundOn'
  | 'onToggleSound'
  | 'reducedMotion'
  | 'layout'
>) {
  const bar = barStyles(layout);
  return (
    <View style={bar.compactBar}>
      <Sheen height={layout.fs(56)} />
      <BrandTile name={tenantName} accent={accent} size={Math.round(30 * layout.scale)} />
      <View style={styles.identity}>
        <Text style={bar.appTitle} numberOfLines={1}>
          Cuisine
        </Text>
        <View style={styles.connection}>
          <StatusDot color={online ? palette.green : palette.red} size={layout.fs(7)} />
          <Text style={bar.connectionText} numberOfLines={1}>
            {online ? 'En ligne' : 'Hors ligne'}
          </Text>
        </View>
      </View>
      <SyncBadge online={online} pending={pending} layout={layout} />
      <Text style={bar.clockSm}>{clock}</Text>
      <Chip
        text={soundOn ? 'Son' : 'Muet'}
        active={soundOn}
        onPress={onToggleSound}
        accent={accent}
        reducedMotion={reducedMotion}
        tone={{ bg: accent, fg: contrastOn(accent) }}
        layout={layout}
      />
    </View>
  );
}

/** Ce qui dépend de l'échelle : tailles de texte et respiration de la barre. */
const barStyles = scaledStyles((l: Layout) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Math.round(16 * l.scale),
      rowGap: 10,
      flexWrap: 'wrap',
      paddingHorizontal: l.pad + 2,
      paddingVertical: Math.round(10 * l.scale),
      backgroundColor: surface.card,
      borderBottomWidth: 1,
      borderBottomColor: hair,
      flexShrink: 0,
    },
    compactBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: l.gap,
      paddingVertical: Math.round(9 * l.scale),
      backgroundColor: surface.card,
      borderBottomWidth: 1,
      borderBottomColor: hair,
      flexShrink: 0,
    },
    appTitle: {
      fontFamily: type.title.fontFamily,
      fontSize: l.fs(17),
      fontWeight: '700',
      letterSpacing: -0.4,
      color: palette.text,
    },
    connectionText: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(12.5),
      fontWeight: '600',
      color: ink.dim,
      flexShrink: 1,
    },
    counter: { alignItems: 'flex-start', minWidth: Math.round(44 * l.scale) },
    counterValue: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(24),
      fontWeight: '900',
      letterSpacing: -1,
      lineHeight: l.far(27),
      ...tabular,
    },
    counterLabel: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(10.5),
      fontWeight: '700',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: ink.dim,
    },
    // L'horloge est lue de loin (« ça fait combien de temps ? ») : échelle far().
    clock: {
      fontFamily: type.clock.fontFamily,
      fontSize: l.far(23),
      fontWeight: '800',
      letterSpacing: -0.6,
      color: palette.text,
      ...tabular,
    },
    clockSm: {
      fontFamily: type.clock.fontFamily,
      fontSize: l.far(17),
      fontWeight: '800',
      letterSpacing: -0.4,
      color: palette.text,
      ...tabular,
    },
    filters: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Math.round(8 * l.scale),
      flexGrow: 1,
      flexShrink: 1,
      justifyContent: 'center',
    },
    // `flexGrow` + `flex-end` : quand la barre passe sur deux lignes (écran
    // étroit, pastille « Hors ligne » présente), ce groupe reste collé à droite
    // au lieu de repartir à gauche et d'inverser la lecture.
    right: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: Math.round(14 * l.scale),
      flexWrap: 'wrap',
      rowGap: 8,
      flexGrow: 1,
    },
    divider: {
      width: 1,
      alignSelf: 'stretch',
      minHeight: Math.round(30 * l.scale),
      backgroundColor: hair2,
    },
  }),
);

const styles = StyleSheet.create({
  left: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brand: { alignItems: 'center', justifyContent: 'center' },
  brandLetter: { fontFamily: type.title.fontFamily, fontWeight: '800', letterSpacing: -0.5 },
  identity: { gap: 3, flexShrink: 1, minWidth: 0 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 7 },
});
