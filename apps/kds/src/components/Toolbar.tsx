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
  /** Écran étroit : les compteurs détaillés cèdent la place. */
  compact: boolean;
}

function BrandTile({ name, accent, size = 34 }: { name: string; accent: string; size?: number }) {
  return (
    <View
      style={[
        styles.brand,
        { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: accent },
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

function Counter({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.counter}>
      <Text style={[styles.counterValue, { color }]}>{value}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

/** Pastille d'état réseau + file offline — toujours visible, jamais alarmiste sans raison. */
function SyncBadge({ online, pending }: { online: boolean; pending: number }) {
  if (!online) {
    return (
      <Pill
        text="Hors ligne"
        color="#ffffff"
        background={palette.red}
      />
    );
  }
  if (pending > 0) {
    return (
      <Pill
        text={`${pending} en attente`}
        color={ink.onAmber}
        background={alpha(palette.amber, 0.16)}
        border={alpha(palette.amber, 0.5)}
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
  compact,
}: ToolbarProps) {
  return (
    <View style={styles.bar}>
      <Sheen height={70} />

      {/* ─── Identité & état de connexion ─── */}
      <View style={styles.left}>
        <BrandTile name={tenantName} accent={accent} />
        <View style={styles.identity}>
          <Text style={styles.appTitle} numberOfLines={1}>
            Cuisine · KDS
          </Text>
          <View style={styles.connection}>
            <StatusDot color={online ? palette.green : palette.red} />
            <Text style={styles.connectionText} numberOfLines={1}>
              {online ? 'En ligne' : 'Hors ligne'} · {tenantName}
            </Text>
          </View>
        </View>
      </View>

      {/* ─── Filtre canal ─── */}
      <View
        style={styles.filters}
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
          />
        ))}
      </View>

      {/* ─── Compteurs, horloge, bascules ─── */}
      <View style={styles.right}>
        {!compact ? (
          <>
            <Counter value={counts.new} label="Nouveau" color={STATUS_TONE.new.bg} />
            <Counter value={counts.preparing} label="En prépa" color={STATUS_TONE.preparing.bg} />
            <Counter value={counts.ready} label="Prêt" color={STATUS_TONE.ready.bg} />
            <View style={styles.divider} />
          </>
        ) : null}

        <Counter value={counts.total} label="Actives" color={palette.text} />

        <View style={styles.divider} />
        <Text style={styles.clock}>{clock}</Text>

        <SyncBadge online={online} pending={pending} />

        <Chip
          text="À lancer"
          active={allDayOn}
          onPress={onToggleAllDay}
          accent={accent}
          reducedMotion={reducedMotion}
          tone={{ bg: accent, fg: contrastOn(accent) }}
        />
        <Chip
          text={soundOn ? 'Son' : 'Muet'}
          active={soundOn}
          onPress={onToggleSound}
          accent={accent}
          reducedMotion={reducedMotion}
          tone={{ bg: accent, fg: contrastOn(accent) }}
        />
      </View>
    </View>
  );
}

/** Barre du mode téléphone — titre, horloge, réseau, son. */
export function PhoneBar({
  tenantName,
  accent,
  clock,
  online,
  pending,
  soundOn,
  onToggleSound,
  reducedMotion,
}: Pick<
  ToolbarProps,
  'tenantName' | 'accent' | 'clock' | 'online' | 'pending' | 'soundOn' | 'onToggleSound' | 'reducedMotion'
>) {
  return (
    <View style={styles.phoneBar}>
      <Sheen height={56} />
      <BrandTile name={tenantName} accent={accent} size={30} />
      <View style={styles.identity}>
        <Text style={styles.appTitle} numberOfLines={1}>
          Cuisine
        </Text>
        <View style={styles.connection}>
          <StatusDot color={online ? palette.green : palette.red} size={7} />
          <Text style={styles.connectionText} numberOfLines={1}>
            {online ? 'En ligne' : 'Hors ligne'}
          </Text>
        </View>
      </View>
      <SyncBadge online={online} pending={pending} />
      <Text style={styles.clockSm}>{clock}</Text>
      <Chip
        text={soundOn ? 'Son' : 'Muet'}
        active={soundOn}
        onPress={onToggleSound}
        accent={accent}
        reducedMotion={reducedMotion}
        tone={{ bg: accent, fg: contrastOn(accent) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    rowGap: 10,
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: surface.card,
    borderBottomWidth: 1,
    borderBottomColor: hair,
    flexShrink: 0,
  },
  phoneBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: surface.card,
    borderBottomWidth: 1,
    borderBottomColor: hair,
    flexShrink: 0,
  },

  left: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brand: { alignItems: 'center', justifyContent: 'center' },
  brandLetter: { fontFamily: type.title.fontFamily, fontWeight: '800', letterSpacing: -0.5 },
  identity: { gap: 3, flexShrink: 1, minWidth: 0 },
  appTitle: {
    fontFamily: type.title.fontFamily,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: palette.text,
  },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  connectionText: {
    fontFamily: type.body.fontFamily,
    fontSize: 12.5,
    fontWeight: '600',
    color: ink.dim,
    flexShrink: 1,
  },

  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
  },

  // `flexGrow` + `flex-end` : quand la barre passe sur deux lignes (écran étroit,
  // pastille « Hors ligne » présente), ce groupe reste collé à droite au lieu de
  // repartir à gauche et d'inverser la lecture.
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
    flexWrap: 'wrap',
    rowGap: 8,
    flexGrow: 1,
  },
  counter: { alignItems: 'flex-start', minWidth: 44 },
  counterValue: {
    fontFamily: type.hero.fontFamily,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 27,
    ...tabular,
  },
  counterLabel: {
    fontFamily: type.micro.fontFamily,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: ink.dim,
  },
  divider: { width: 1, alignSelf: 'stretch', minHeight: 30, backgroundColor: hair2 },
  clock: {
    fontFamily: type.clock.fontFamily,
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: palette.text,
    ...tabular,
  },
  clockSm: {
    fontFamily: type.clock.fontFamily,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: palette.text,
    ...tabular,
  },
});
