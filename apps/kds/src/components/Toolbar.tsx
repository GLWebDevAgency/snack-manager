import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@sm/ui-native';
import { alpha, CHANNEL_FILTERS, contrastOn, makeUi, radius, SETTINGS_TRIGGER_ID, tabular, type ChannelFilter } from '../ui';
import { useUi } from '../theme';
import { scaledStyles, type Layout } from '../useLayout';
import { Chip, Pill, StatusDot, Tap } from './primitives';

export interface Counts { new: number; preparing: number; ready: number; total: number }

export interface ToolbarProps {
  tenantName: string;
  logoUrl?: string | null;
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
  onSettings?: () => void;
  onLogout?: () => void;
  reducedMotion: boolean;
  layout: Layout;
}

function BrandTile({ name, logoUrl, accent, size }: { name: string; logoUrl?: string | null; accent: string; size: number }) {
  const { type } = useUi();
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  return (
    <View accessible accessibilityLabel={name} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
      {logoUrl && failedLogo !== logoUrl ? (
        <Image source={{ uri: logoUrl }} resizeMode="contain" onError={() => setFailedLogo(logoUrl)} accessible={false} style={{ width: '70%', height: '70%' }} />
      ) : (
        <Text style={{ fontFamily: type.title.fontFamily, fontSize: Math.round(size * 0.52), fontWeight: '800', letterSpacing: -0.5, color: contrastOn(accent) }}>
          {(name.trim()[0] ?? 'S').toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function Counter({ value, label, color, layout }: { value: number; label: string; color: string; layout: Layout }) {
  const { theme } = useUi();
  const bar = barStyles(layout, theme);
  return <View style={bar.counter}><Text style={[bar.counterValue, { color }]}>{value}</Text><Text style={bar.counterLabel}>{label}</Text></View>;
}

/** Le réseau affiché reste celui du tableau et de sa file d'envoi réelle. */
function SyncBadge({ online, pending, layout }: { online: boolean; pending: number; layout: Layout }) {
  const { palette, ink } = useUi();
  if (!online) return <Pill text="Hors ligne" color={ink.onRed} background={alpha(palette.red, 0.12)} border={alpha(palette.red, 0.4)} layout={layout} />;
  if (pending > 0) return <Pill text={`${pending} en attente`} color={ink.onAmber} background={alpha(palette.amber, 0.16)} border={alpha(palette.amber, 0.5)} layout={layout} />;
  return null;
}

function IconButton({ icon, label, nativeID, onPress, layout, reducedMotion }: { icon: string; label: string; nativeID?: string; onPress: () => void; layout: Layout; reducedMotion: boolean }) {
  const { theme, ink, surface } = useUi();
  const bar = barStyles(layout, theme);
  return <Tap nativeID={nativeID} label={label} onPress={onPress} reducedMotion={reducedMotion} style={bar.iconButton} pressedStyle={{ backgroundColor: surface.el2 }}><Icon name={icon} size={layout.fs(18)} color={ink.dim} /></Tap>;
}

function ChannelChips({ filter, onFilter, accent, reducedMotion, layout }: Pick<ToolbarProps, 'filter' | 'onFilter' | 'accent' | 'reducedMotion' | 'layout'>) {
  return <>{CHANNEL_FILTERS.map((option) => (
    <Chip key={option.key} text={option.label} active={filter === option.key} onPress={() => onFilter(option.key)} accent={accent} reducedMotion={reducedMotion} tone={{ bg: accent, fg: contrastOn(accent) }} layout={layout} />
  ))}</>;
}

export function Toolbar({
  tenantName, logoUrl, accent, clock, online, pending, counts, filter, onFilter,
  soundOn, onToggleSound, allDayOn, onToggleAllDay, onSettings, onLogout,
  reducedMotion, layout,
}: ToolbarProps) {
  const { theme, palette, surface, statusColors } = useUi();
  const bar = barStyles(layout, theme);
  return (
    <View style={bar.bar}>
      <View style={bar.topLine}>
        <View style={bar.left}>
          <BrandTile name={tenantName} logoUrl={logoUrl} accent={accent} size={layout.fs(42)} />
          <View style={bar.identity}>
            <Text style={bar.desktopTitle} numberOfLines={1}>Cuisine</Text>
            <View style={bar.connection}>
              <StatusDot color={online ? palette.green : palette.red} size={layout.fs(7)} />
              <Text style={bar.connectionText} numberOfLines={1}>{online ? 'En ligne' : 'Hors ligne'} · {tenantName}</Text>
            </View>
          </View>
        </View>
        <View style={bar.right}>
          {!layout.denseToolbar ? <>
            <Counter value={counts.new} label="Nouveau" color={statusColors.new.ink} layout={layout} />
            <Counter value={counts.preparing} label="En prépa" color={statusColors.preparing.ink} layout={layout} />
            <Counter value={counts.ready} label="Prêt" color={statusColors.ready.ink} layout={layout} />
            <View style={bar.divider} />
          </> : null}
          <Counter value={counts.total} label="Actives" color={palette.text} layout={layout} />
          <View style={bar.divider} />
          <Text style={bar.clock}>{clock}</Text>
          <SyncBadge online={online} pending={pending} layout={layout} />
          <Chip text={soundOn ? 'Son' : 'Muet'} icon={soundOn ? 'bell' : 'bellOff'} active={soundOn} onPress={onToggleSound} accent={accent} reducedMotion={reducedMotion} tone={{ bg: surface.el, fg: palette.text }} layout={layout} />
          {onSettings ? <IconButton nativeID={SETTINGS_TRIGGER_ID} icon="settings" label="Paramètres de l'écran" onPress={onSettings} layout={layout} reducedMotion={reducedMotion} /> : null}
          {onLogout ? <IconButton icon="lock" label="Fermer le service" onPress={onLogout} layout={layout} reducedMotion={reducedMotion} /> : null}
        </View>
      </View>
      <View style={bar.filterLine}>
        <View style={bar.filters} accessibilityRole="tablist" accessibilityLabel="Filtrer par canal de commande">
          <ChannelChips filter={filter} onFilter={onFilter} accent={accent} reducedMotion={reducedMotion} layout={layout} />
        </View>
        <Chip text="À lancer" icon="menu" active={allDayOn} onPress={onToggleAllDay} accent={accent} reducedMotion={reducedMotion} tone={{ bg: surface.el, fg: palette.text }} layout={layout} />
      </View>
    </View>
  );
}

/** Le filtre canal reste accessible après rotation vers le régime compact. */
export function CompactBar({
  tenantName, logoUrl, accent, clock, online, pending, soundOn, onToggleSound,
  onSettings, filter, onFilter, reducedMotion, layout,
}: Pick<ToolbarProps, 'tenantName' | 'logoUrl' | 'accent' | 'clock' | 'online' | 'pending' | 'soundOn' | 'onToggleSound' | 'onSettings' | 'filter' | 'onFilter' | 'reducedMotion' | 'layout'>) {
  const { theme, palette } = useUi();
  const bar = barStyles(layout, theme);
  return (
    <View style={bar.compactShell}>
      <View style={bar.compactBar}>
        <BrandTile name={tenantName} logoUrl={logoUrl} accent={accent} size={layout.fs(30)} />
        {layout.compactIdentity ? <View style={bar.identity}>
          <Text style={bar.appTitle} numberOfLines={1}>Cuisine</Text>
          <View style={bar.connection}>
            <StatusDot color={online ? palette.green : palette.red} size={layout.fs(7)} />
            <Text style={bar.connectionText} numberOfLines={1}>{online ? 'En ligne' : 'Hors ligne'}</Text>
          </View>
        </View> : null}
        <Text style={bar.clockSm}>{clock}</Text>
        <Chip text={soundOn ? 'Couper le son' : 'Activer le son'} icon={soundOn ? 'kds-bell' : 'bellOff'} iconOnly active={soundOn} onPress={onToggleSound} accent={accent} reducedMotion={reducedMotion} tone={{ bg: accent, fg: contrastOn(accent) }} layout={layout} />
        {onSettings ? <IconButton nativeID={SETTINGS_TRIGGER_ID} icon="gear" label="Paramètres de l'écran" onPress={onSettings} layout={layout} reducedMotion={reducedMotion} /> : null}
      </View>
      {!online || pending > 0 ? <View style={bar.compactSync}><SyncBadge online={online} pending={pending} layout={layout} /></View> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bar.compactFilters} contentContainerStyle={bar.compactFilterContent} accessibilityRole="tablist" accessibilityLabel="Filtrer par canal de commande">
        <ChannelChips filter={filter} onFilter={onFilter} accent={accent} reducedMotion={reducedMotion} layout={layout} />
      </ScrollView>
    </View>
  );
}

const barStyles = scaledStyles((l: Layout, theme) => {
  const { palette, surface, hair, hair2, ink, type } = makeUi(theme);
  return StyleSheet.create({
    bar: {
      gap: l.fs(20), paddingHorizontal: l.pad + 2, paddingTop: l.fs(20), paddingBottom: l.fs(8),
      backgroundColor: surface.bg, flexShrink: 0,
    },
    topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: l.fs(20), flexWrap: 'wrap' },
    filterLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: l.fs(12) },
    desktopTitle: { fontFamily: type.title.fontFamily, fontSize: l.fs(28), fontWeight: '700', letterSpacing: -0.9, color: palette.text },
    left: { flexDirection: 'row', alignItems: 'center', gap: l.fs(11), flexShrink: 1, minWidth: 0 },
    identity: { gap: l.fs(1), flexShrink: 1, minWidth: 0 },
    connection: { flexDirection: 'row', alignItems: 'center', gap: l.fs(6) },
    appTitle: { fontFamily: type.title.fontFamily, fontSize: l.fs(17), fontWeight: '700', letterSpacing: -0.4, color: palette.text },
    connectionText: { fontFamily: type.body.fontFamily, fontSize: l.fs(12.5), fontWeight: '600', color: ink.dim, flexShrink: 1 },
    filters: { flexDirection: 'row', alignItems: 'center', gap: l.fs(8), flexGrow: 1, flexShrink: 0, justifyContent: 'flex-start' },
    right: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: l.fs(14), flexWrap: 'wrap', rowGap: l.fs(8), flexGrow: 1 },
    counter: { alignItems: 'flex-start', minWidth: l.fs(44) },
    counterValue: { fontFamily: type.hero.fontFamily, fontSize: l.far(24), fontWeight: '700', letterSpacing: -1, lineHeight: l.far(26.5), ...tabular },
    counterLabel: { fontFamily: type.micro.fontFamily, fontSize: l.fs(11.5), fontWeight: '600', letterSpacing: -0.1, color: ink.dim },
    divider: { width: 1, alignSelf: 'stretch', minHeight: l.fs(30), backgroundColor: hair2 },
    clock: { fontFamily: type.clock.fontFamily, fontSize: l.far(18), fontWeight: '600', letterSpacing: -0.6, color: palette.text, ...tabular },
    iconButton: { width: l.touch, height: l.touch, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.card, borderWidth: 1, borderColor: hair2, flexShrink: 0 },
    compactShell: { backgroundColor: surface.card, borderBottomWidth: 1, borderBottomColor: hair, flexShrink: 0 },
    compactBar: { flexDirection: 'row', alignItems: 'center', gap: l.fs(8), paddingHorizontal: l.gap, paddingVertical: l.fs(9), flexShrink: 0 },
    clockSm: { marginLeft: 'auto', fontFamily: type.clock.fontFamily, fontSize: l.far(17), fontWeight: '800', letterSpacing: -0.4, color: palette.text, ...tabular },
    compactSync: { paddingHorizontal: l.gap, paddingBottom: l.fs(8), alignItems: 'flex-end' },
    compactFilters: { flexGrow: 0, flexShrink: 0 },
    compactFilterContent: { flexDirection: 'row', alignItems: 'center', gap: l.fs(8), paddingHorizontal: l.gap, paddingBottom: l.fs(8) },
  });
});
