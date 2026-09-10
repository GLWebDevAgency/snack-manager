import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, ScrollView, Text, View } from 'react-native';
import { TIMER_THRESHOLDS } from '@sm/client-core';
import { Icon } from '@sm/ui-native';
import type { KdsDensity, KdsPrefs, KdsTheme } from '../prefs';
import { useAccentText, useUi } from '../theme';
import { alpha, contrastOn, radius, SETTINGS_TRIGGER_ID } from '../ui';
import type { Layout } from '../useLayout';
import { Overlay, PanelHead, Segmented, Tap } from './primitives';

// Même version que le bundle de l'appareil, résolue au build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION = (require('../../package.json') as { version: string }).version;

const DENSITIES: { id: KdsDensity; label: string; hint: string }[] = [
  { id: 'comfort', label: 'Confort', hint: 'Cartes aérées, options sur une ligne entière. Pour une tablette posée sur le passe.' },
  { id: 'dense', label: 'Dense', hint: 'Plus de tickets visibles par colonne. Pour un écran mural ou un gros rush.' },
];

function Section({ title, layout, children }: { title: string; layout: Layout; children: ReactNode }) {
  const { type, ink } = useUi();
  return <View style={{ marginTop: layout.fs(18), gap: layout.fs(10) }}>
    <Text style={[type.micro, { color: ink.dim, fontSize: layout.fs(12), letterSpacing: 1.1, textTransform: 'uppercase' }]}>{title}</Text>
    {children}
  </View>;
}

function DensitySchema({ density, accent, layout }: { density: KdsDensity; accent: string; layout: Layout }) {
  const { surface, hair, hair2 } = useUi();
  return <View accessible={false} style={{ width: layout.fs(56), height: layout.fs(36), flexDirection: 'row',
    gap: layout.fs(2), padding: layout.fs(3), borderRadius: layout.fs(6), backgroundColor: surface.bg, borderWidth: 1, borderColor: hair }}>
    {Array.from({ length: density === 'dense' ? 3 : 2 }, (_, index) => <View key={index} style={{
      flex: 1, borderRadius: layout.fs(2), backgroundColor: density === 'dense' ? hair2 : alpha(accent, 0.22),
    }} />)}
  </View>;
}

function ToggleRow({ title, hint, value, onToggle, layout, reducedMotion, disabled = false }: {
  title: string;
  hint: string;
  value: boolean;
  onToggle: () => void;
  layout: Layout;
  reducedMotion: boolean;
  disabled?: boolean;
}) {
  const { type, palette, surface, hair2, ink } = useUi();
  const position = useRef(new Animated.Value(value ? 20 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(position, { toValue: value ? 20 : 0, duration: reducedMotion ? 0 : 200,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [position, reducedMotion, value]);
  return <Tap role="switch" selected={value} label={title} onPress={onToggle} disabled={disabled} reducedMotion={reducedMotion}
    style={{ flexDirection: 'row', alignItems: 'center', gap: layout.fs(12), minHeight: layout.actionH,
    paddingVertical: layout.fs(10), paddingHorizontal: layout.fs(14), borderRadius: radius.md,
    backgroundColor: surface.el, borderWidth: 1, borderColor: hair2 }}>
    <View style={{ flex: 1 }}>
      <Text style={[type.title, { fontSize: layout.fs(14.5) }]}>{title}</Text>
      <Text style={[type.body, { fontSize: layout.fs(12.5), lineHeight: layout.fs(16.25), marginTop: layout.fs(2) }]}>{hint}</Text>
    </View>
    <View accessible={false} style={{ width: 46, height: 26, flexShrink: 0, borderRadius: radius.pill,
      backgroundColor: value ? palette.green : hair2 }}>
      <Animated.View style={{ position: 'absolute', left: 3, top: 3, width: 20, height: 20, borderRadius: radius.pill,
        backgroundColor: ink.onDark, transform: [{ translateX: position }],
        ...(Platform.OS === 'web' ? { boxShadow: '0 1px 3px rgba(0,0,0,.4)' } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0.4, elevation: 1 }) }} />
    </View>
  </Tap>;
}

/** Préférences du poste uniquement : aucun handler de commande n'entre dans ce dialogue. */
export function SettingsSheet({ layout, reducedMotion, prefs, onTheme, onDensity, onToggleSound, onToggleAllDay,
  onToggleSplash, onClose, onLogout, tenantName, deviceName, pending, soundSupported, accent: accentProp }: {
  layout: Layout;
  reducedMotion: boolean;
  prefs: KdsPrefs;
  onTheme: (theme: KdsTheme) => void;
  onDensity: (density: KdsDensity) => void;
  onToggleSound: () => void;
  onToggleAllDay: () => void;
  onToggleSplash: () => void;
  onClose: () => void;
  onLogout: () => void;
  tenantName: string;
  deviceName: string;
  pending: number;
  soundSupported: boolean;
  accent?: string;
}) {
  const { type, palette, surface, ink, hair2 } = useUi();
  const accent = accentProp ?? palette.gold;
  const accentText = useAccentText(accent);
  const rows = [
    { label: 'Restaurant', value: tenantName },
    { label: 'Appareil', value: deviceName },
    { label: 'File d’envoi', value: pending > 0 ? `${pending} en attente` : 'À jour', color: pending > 0 ? ink.onAmber : ink.onGreen },
    { label: 'Seuils minuteur', value: `${TIMER_THRESHOLDS.warn} min · ${TIMER_THRESHOLDS.late} min` },
    { label: 'Version', value: `KDS ${VERSION}` },
  ];
  return <Overlay layout={layout} reducedMotion={reducedMotion} onClose={onClose} label="Paramètres de l'écran" returnFocusId={SETTINGS_TRIGGER_ID}>
    <PanelHead title="Paramètres de l'écran" sub="Appliqués immédiatement · propres à cet écran"
      onClose={onClose} layout={layout} reducedMotion={reducedMotion} />
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: layout.fs(20), paddingTop: layout.fs(6), paddingBottom: layout.fs(16) }}>
      <Section title="Densité des cartes" layout={layout}>
        <View role="radiogroup" accessibilityLabel="Densité des cartes" style={{ gap: layout.fs(8) }}>
          {DENSITIES.map((density) => {
            const selected = prefs.density === density.id;
            return <Tap key={density.id} role="radio" selected={selected} label={`${density.label}. ${density.hint}`}
              onPress={() => onDensity(density.id)} reducedMotion={reducedMotion}
              style={{ flexDirection: 'row', alignItems: 'center', gap: layout.fs(14), minHeight: layout.actionH + layout.fs(12),
                paddingVertical: layout.fs(12), paddingHorizontal: layout.fs(14), borderRadius: radius.md, borderWidth: 1,
                backgroundColor: selected ? alpha(accent, 0.12) : surface.el, borderColor: selected ? accent : hair2 }}
              pressedStyle={{ backgroundColor: selected ? alpha(accent, 0.22) : surface.el2 }}>
              <DensitySchema density={density.id} accent={accent} layout={layout} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.title, { fontSize: layout.fs(15) }]}>{density.label}</Text>
                <Text style={[type.body, { fontSize: layout.fs(12.5), lineHeight: layout.fs(16.25), marginTop: layout.fs(2) }]}>{density.hint}</Text>
              </View>
              {selected ? <Icon name="check" size={layout.fs(18)} color={accentText} /> : null}
            </Tap>;
          })}
        </View>
      </Section>
      <Section title="Thème" layout={layout}>
        <Segmented value={prefs.theme} onChange={onTheme} options={[{ key: 'dark', label: 'Sombre' }, { key: 'light', label: 'Clair' }]}
          accent={accent} layout={layout} reducedMotion={reducedMotion} label="Thème" />
      </Section>
      <Section title="Service" layout={layout}>
        <View style={{ gap: layout.fs(8) }}>
          <ToggleRow title="Alerte sonore" hint={soundSupported ? 'Un bip par nouveau ticket, rappel toutes les 60 s' : 'Alerte sonore indisponible sur cet appareil'}
            value={prefs.sound} onToggle={onToggleSound} disabled={!soundSupported} layout={layout} reducedMotion={reducedMotion} />
          <ToggleRow title="Panneau « À lancer » épinglé" hint="Visible même sur écran étroit ; les colonnes se resserrent"
            value={prefs.allDay} onToggle={onToggleAllDay} layout={layout} reducedMotion={reducedMotion} />
          <ToggleRow title="Animation du logo au démarrage" hint="Au lancement à froid uniquement"
            value={prefs.splash} onToggle={onToggleSplash} layout={layout} reducedMotion={reducedMotion} />
        </View>
      </Section>
      <Section title="Écran" layout={layout}>
        <View>{rows.map((row) => <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between',
          gap: layout.fs(12), paddingVertical: layout.fs(10), borderBottomWidth: 1, borderBottomColor: hair2 }}>
          <Text style={[type.body, { fontSize: layout.fs(14) }]}>{row.label}</Text>
          <Text style={[type.body, { flexShrink: 1, textAlign: 'right', fontSize: layout.fs(14), fontWeight: '700',
            color: row.color ?? palette.text, fontVariant: ['tabular-nums'] }]}>{row.value}</Text>
        </View>)}</View>
        {layout.compact ? <Tap onPress={onLogout} label="Fermer le service" reducedMotion={reducedMotion}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: layout.fs(8), minHeight: layout.touch,
            backgroundColor: surface.el, borderWidth: 1, borderColor: hair2, borderRadius: radius.pill }}>
          <Icon name="lock" size={layout.fs(16)} color={palette.text} />
          <Text style={[type.action, { fontSize: layout.fs(14), color: palette.text }]}>Fermer le service</Text>
        </Tap> : null}
      </Section>
    </ScrollView>
    <View style={{ paddingHorizontal: layout.fs(20), paddingTop: layout.fs(14), paddingBottom: layout.fs(18),
      backgroundColor: palette.footBg, borderTopWidth: 1, borderTopColor: hair2 }}>
      <Tap onPress={onClose} label="Fermer" reducedMotion={reducedMotion}
        style={{ minHeight: layout.actionH, borderRadius: radius.pill, backgroundColor: palette.btnDark,
          alignItems: 'center', justifyContent: 'center' }}>
        <Text style={[type.action, { fontSize: layout.fs(15), color: contrastOn(palette.btnDark), letterSpacing: -0.2 }]}>Fermer</Text>
      </Tap>
    </View>
  </Overlay>;
}
