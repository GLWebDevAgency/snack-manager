import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Icon } from './Icon';
import { LAYOUTS, type PosLayoutId } from './prefs';
import { FONT, R, type Brand, useTheme } from './theme';
import { Btn, Overlay, PanelHead, Press, Segmented } from './ui';
import { useLayout } from './useLayout';
import { usePrefs } from './usePrefs';

// Même source de version que le heartbeat du poste, résolue au build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_VERSION = (require('../package.json') as { version: string }).version;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { type } = useTheme();
  const L = useLayout();
  return <View style={{ marginTop: L.sp(18), gap: L.sp(10) }}>
    <Text style={[type.eyebrow, { fontSize: L.fs(12) }]}>{title}</Text>
    {children}
  </View>;
}

function Schema({ layout, brand }: { layout: PosLayoutId; brand: Brand }) {
  const { palette } = useTheme();
  const L = useLayout();
  const zones = layout === 'B' ? ['ticket', 'grid'] : ['rail', layout === 'C' ? 'list' : 'grid', 'ticket'];
  return <View accessible={false} style={{
    width: L.sp(56), height: L.sp(36), flexDirection: 'row', gap: L.sp(2), padding: L.sp(3),
    borderRadius: L.sp(6), backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.line,
  }}>
    {zones.map((zone) => <View key={zone} style={{
      width: zone === 'rail' ? L.sp(8) : zone === 'ticket' ? L.sp(16) : undefined,
      flex: zone === 'grid' || zone === 'list' ? 1 : undefined,
      borderRadius: L.sp(2), overflow: 'hidden',
      backgroundColor: zone === 'ticket' ? brand.tintStrong : zone === 'rail' ? palette.line : palette.line2,
    }}>{zone === 'list' ? [0, 1, 2, 3].map((row) => <View key={row} style={{ height: L.sp(3), marginBottom: L.sp(3), backgroundColor: palette.line }} />) : null}</View>)}
  </View>;
}

export function SettingsModal({ brand, restaurant, deviceName = 'Poste 1', pending, onClose, onLayoutChange }: {
  brand: Brand;
  restaurant?: string;
  deviceName?: string;
  pending: number;
  onClose: () => void;
  onLayoutChange?: (layout: PosLayoutId) => void;
}) {
  const { prefs, setLayout, setTheme, setSplash, ready } = usePrefs();
  const { palette, type, semanticText } = useTheme();
  const L = useLayout();
  const values = [
    ['Restaurant', restaurant ?? brand.name],
    ['Appareil', deviceName],
    ['File d’envoi', pending ? `${pending} en attente` : 'À jour'],
    ['Version', `Caisse ${APP_VERSION}`],
  ];
  return <Overlay onClose={onClose} accessibilityLabel="Paramètres du poste" width={520}>
    <PanelHead title="Paramètres du poste" sub="Appliqués immédiatement · propres à ce poste" onClose={onClose} />
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: L.sp(20), paddingTop: L.sp(6), paddingBottom: L.sp(16) }}>
      <Section title="Disposition de l’écran">
        <View role="radiogroup" accessibilityLabel="Disposition de l’écran" style={{ gap: L.sp(8) }}>
          {(Object.keys(LAYOUTS) as PosLayoutId[]).map((layout) => {
            const option = LAYOUTS[layout];
            const selected = prefs.layout === layout;
            return <Press key={layout} accessibilityRole="radio" selected={selected} disabled={!ready}
              accessibilityLabel={`${layout} · ${option.label}. ${option.hint}`}
              onPress={() => { if (!selected) { setLayout(layout); onLayoutChange?.(layout); } }}
              activeStyle={{ backgroundColor: palette.press }} style={{
                flexDirection: 'row', alignItems: 'center', gap: L.sp(14), minHeight: L.touch(64),
                paddingVertical: L.sp(12), paddingHorizontal: L.sp(14), borderRadius: R.card,
                borderWidth: 1, borderColor: selected ? brand.accent : palette.line2,
                backgroundColor: selected ? brand.tint : palette.surface2,
              }}>
              <Schema layout={layout} brand={brand} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.strong, { fontSize: L.fs(15) }]}>{layout} · {option.label}</Text>
                <Text style={[type.mut, { fontSize: L.fs(12.5), lineHeight: L.fs(16.25), marginTop: L.sp(2) }]}>{option.hint}</Text>
              </View>
              {selected ? <Icon name="check" size={L.sp(18)} strokeWidth={2.4} color={brand.accent} /> : null}
            </Press>;
          })}
        </View>
      </Section>
      <Section title="Thème">
        <Segmented value={prefs.theme} options={[{ key: 'dark', label: 'Sombre' }, { key: 'light', label: 'Clair' }]}
          onChange={setTheme} accent={brand.accent} onAccent={brand.onAccent} flex />
      </Section>
      <Section title="Démarrage">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: L.sp(12), minHeight: L.touch(52), paddingVertical: L.sp(10), paddingHorizontal: L.sp(14), borderRadius: R.card, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.line2 }}>
          <View style={{ flex: 1 }}>
            <Text style={[type.strong, { fontSize: L.fs(14.5) }]}>Animation du logo au démarrage</Text>
            <Text style={[type.mut, { fontSize: L.fs(12.5), marginTop: L.sp(2) }]}>Au lancement à froid uniquement</Text>
          </View>
          <Press onPress={() => setSplash(!prefs.splash)} disabled={!ready}
            accessibilityRole="switch" selected={prefs.splash}
            accessibilityLabel="Animation du logo au démarrage"
            style={{ minWidth: L.touch(46), minHeight: L.touch(), justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: L.sp(46), height: L.sp(26), padding: L.sp(3), borderRadius: R.pill,
              backgroundColor: prefs.splash ? palette.green : palette.line, alignItems: prefs.splash ? 'flex-end' : 'flex-start' }}>
              <View style={{ width: L.sp(20), height: L.sp(20), borderRadius: R.pill, backgroundColor: '#ffffff' }} />
            </View>
          </Press>
        </View>
      </Section>
      <Section title="Poste">
        <View>{values.map(([label, value]) => <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: L.sp(12), paddingVertical: L.sp(10), borderBottomWidth: 1, borderBottomColor: palette.line2 }}>
          <Text style={[type.mut, { fontSize: L.fs(14) }]}>{label}</Text>
          <Text style={{ flexShrink: 1, fontFamily: FONT, fontSize: L.fs(14), fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'], color: label === 'File d’envoi' ? pending ? semanticText.warning : semanticText.positive : palette.text }}>{value}</Text>
        </View>)}</View>
      </Section>
    </ScrollView>
    <View style={{ paddingTop: L.sp(14), paddingHorizontal: L.sp(20), paddingBottom: L.sp(18), borderTopWidth: 1, borderTopColor: palette.line2, backgroundColor: palette.footBg }}>
      <Btn label="Fermer" onPress={onClose} kind="solid" block />
    </View>
  </Overlay>;
}
