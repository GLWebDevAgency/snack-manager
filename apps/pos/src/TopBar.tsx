/**
 * Barre haute (zone A) — identité du restaurant, mode de service, état de la
 * file offline, horloge et accès à la clôture.
 *
 * Elle reste visible sous toutes les surcouches : c'est le seul repère fixe du
 * poste pendant un coup de feu.
 *
 * Sous 900 px de large, tout cela ne tient plus sur une ligne : la barre passe
 * à deux rangées (identité + horloge + actions, puis le sélecteur de mode
 * pleine largeur) plutôt que de tronquer le mode de service, qui décide du
 * contenu de la commande.
 */
import { Text, View } from 'react-native';
import { palette } from '@sm/client-core';
import { FONT, R, S, sheet, shadow, type, withAlpha, type Brand } from './theme';
import { MODE_LABEL, type Mode } from './pos-state';
import { Press, Segmented, Sheen } from './ui';
import { useLayout } from './useLayout';

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
  const L = useLayout();
  const d = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const ss = String(d.getSeconds()).padStart(2, '0');
  const compact = L.compact;
  /** Sous 560 px, l'identité textuelle cède la place aux actions. */
  const showIdentityText = L.width >= 560;

  const segmented = (
    <Segmented
      value={mode}
      onChange={onMode}
      accent={brand.accent}
      onAccent={brand.onAccent}
      flex={compact}
      options={[
        { key: 'surplace', label: MODE_LABEL.surplace },
        { key: 'emporter', label: MODE_LABEL.emporter },
        { key: 'tel', label: MODE_LABEL.tel },
      ]}
    />
  );

  const status =
    pending > 0 || offline ? (
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
        <Text style={{ fontFamily: FONT, color: palette.amber, fontSize: L.fs(13), fontWeight: '700' }}>
          {pending > 0 ? `${pending}${compact ? '' : ' en attente'}${syncing ? ' · envoi…' : ''}` : 'Hors ligne'}
        </Text>
      </View>
    ) : null;

  return (
    <View
      style={[
        {
          flexDirection: 'column',
          paddingHorizontal: S.lg,
          paddingVertical: compact ? S.sm : 0,
          gap: compact ? S.sm : 0,
          backgroundColor: palette.surface,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        },
        shadow(1),
      ]}
    >
      <Sheen intensity={0.7} />

      <View style={{ height: L.topbarH, flexDirection: 'row', alignItems: 'center', gap: compact ? S.sm : S.lg }}>
        {/* Identité */}
        <View style={[sheet.row, { gap: 11 }]}>
          <View
            style={{
              width: L.sp(38),
              height: L.sp(38),
              borderRadius: 11,
              backgroundColor: brand.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: FONT, color: brand.onAccent, fontSize: L.fs(19), fontWeight: '800' }}>
              {brand.initial}
            </Text>
          </View>
          {showIdentityText ? (
            <View>
              <Text style={[type.h2, { fontSize: L.fs(16) }]} numberOfLines={1}>
                {brand.name}
              </Text>
              <Text style={[type.mut, { fontSize: L.fs(12.5), marginTop: 1 }]} numberOfLines={1}>
                Poste 1 · {staffName}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Mode de service — sur sa propre rangée en compact */}
        <View style={{ flex: 1, alignItems: 'center' }}>{compact ? null : segmented}</View>

        {status}

        {/* Horloge — les secondes sautent en premier quand la place manque */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={[type.display, { fontSize: L.fs(21) }]}>{hm}</Text>
          {compact ? null : (
            <Text style={[type.num, { fontSize: L.fs(13), color: palette.mut, fontWeight: '600' }]}>:{ss}</Text>
          )}
        </View>

        <BarButton
          label="Service"
          detail={String(serviceCount)}
          onPress={onService}
          accent={brand.accent}
          onAccent={brand.onAccent}
        />
        <BarButton label={compact ? 'Verrou' : 'Verrouiller'} accessibilityLabel="Verrouiller" onPress={onLock} />
      </View>

      {compact ? segmented : null}
    </View>
  );
}

function BarButton({
  label,
  detail,
  onPress,
  accent,
  onAccent,
  accessibilityLabel,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  accent?: string;
  onAccent?: string;
  accessibilityLabel?: string;
}) {
  const L = useLayout();
  const name = accessibilityLabel ?? label;
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={detail ? `${name} ${detail}` : name}
      style={{
        minHeight: L.touch(),
        paddingHorizontal: L.compact ? 11 : 14,
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
      <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(13.5), fontWeight: '600' }}>{label}</Text>
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
              fontSize: L.fs(12.5),
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
