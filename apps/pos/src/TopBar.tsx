/**
 * Barre haute (zone A) — identité du restaurant, mode de service, état de la
 * file offline, horloge et accès à la clôture.
 *
 * Elle reste visible sous toutes les surcouches : c'est le seul repère fixe du
 * poste pendant un coup de feu.
 */
import { Text, View } from 'react-native';
import { TOUCH_MIN, palette } from '@sm/client-core';
import { FONT, R, S, TOPBAR_H, sheet, shadow, type, withAlpha, type Brand } from './theme';
import { MODE_LABEL, type Mode } from './pos-state';
import { Press, Segmented, Sheen } from './ui';

export function TopBar({
  brand,
  staffName,
  mode,
  onMode,
  pending,
  syncing,
  offline,
  now,
  serviceCount,
  onService,
  onLock,
}: {
  brand: Brand;
  staffName: string;
  mode: Mode;
  onMode: (m: Mode) => void;
  pending: number;
  syncing: boolean;
  offline: boolean;
  now: number;
  serviceCount: number;
  onService: () => void;
  onLock: () => void;
}) {
  const d = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ss = String(d.getSeconds()).padStart(2, '0');

  return (
    <View
      style={[
        {
          height: TOPBAR_H,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: S.lg,
          gap: S.lg,
          backgroundColor: palette.surface,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        },
        shadow(1),
      ]}
    >
      <Sheen intensity={0.7} />

      {/* Identité */}
      <View style={[sheet.row, { gap: 11 }]}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            backgroundColor: brand.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: FONT, color: brand.onAccent, fontSize: 19, fontWeight: '800' }}>
            {brand.initial}
          </Text>
        </View>
        <View>
          <Text style={[type.h2, { fontSize: 16 }]} numberOfLines={1}>
            {brand.name}
          </Text>
          <Text style={[type.mut, { fontSize: 12.5, marginTop: 1 }]} numberOfLines={1}>
            Poste 1 · {staffName}
          </Text>
        </View>
      </View>

      {/* Mode de service */}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Segmented
          value={mode}
          onChange={onMode}
          accent={brand.accent}
          onAccent={brand.onAccent}
          options={[
            { key: 'surplace', label: MODE_LABEL.surplace },
            { key: 'emporter', label: MODE_LABEL.emporter },
            { key: 'tel', label: MODE_LABEL.tel },
          ]}
        />
      </View>

      {/* État réseau */}
      {pending > 0 || offline ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            minHeight: 36,
            borderRadius: R.pill,
            backgroundColor: withAlpha(palette.amber, 0.12),
            borderWidth: 1,
            borderColor: withAlpha(palette.amber, 0.3),
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.amber }} />
          <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: 13, fontWeight: '700' }}>
            {pending > 0 ? `${pending} en attente${syncing ? ' · envoi…' : ''}` : 'Menu hors ligne'}
          </Text>
        </View>
      ) : null}

      {/* Horloge */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={[type.display, { fontSize: 21 }]}>{hm}</Text>
        <Text style={[type.num, { fontSize: 13, color: palette.mut, fontWeight: '600' }]}>:{ss}</Text>
      </View>

      <BarButton
        label="Service"
        detail={String(serviceCount)}
        onPress={onService}
        accent={brand.accent}
        onAccent={brand.onAccent}
      />
      <BarButton label="Verrouiller" onPress={onLock} />
    </View>
  );
}

function BarButton({
  label,
  detail,
  onPress,
  accent,
  onAccent,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  accent?: string;
  onAccent?: string;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={detail ? `${label} ${detail}` : label}
      style={{
        minHeight: TOUCH_MIN,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.surface2,
      }}
      activeStyle={{ backgroundColor: '#282828' }}
    >
      <Text style={{ fontFamily: FONT, color: palette.text, fontSize: 13.5, fontWeight: '600' }}>{label}</Text>
      {detail ? (
        <View
          style={{
            minWidth: 24,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: R.pill,
            backgroundColor: accent ?? palette.line,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: FONT,
              color: onAccent ?? palette.text,
              fontSize: 12.5,
              fontWeight: '800',
              fontVariant: ['tabular-nums'],
            }}
          >
            {detail}
          </Text>
        </View>
      ) : null}
    </Press>
  );
}
