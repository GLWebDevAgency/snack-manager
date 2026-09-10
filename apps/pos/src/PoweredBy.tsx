import { useState } from 'react';
import { Text, View } from 'react-native';
import { SMMark } from './SMMark';
import { FONT, useTheme } from './theme';
import { useLayout } from './useLayout';

/** Signature de l'éditeur : sa couleur laiton ne dépend jamais de l'établissement. */
export function PoweredBy({ variant = 'rail', compact = false }: {
  variant?: 'rail' | 'ticket' | 'lockup';
  compact?: boolean;
}) {
  const { palette } = useTheme();
  const L = useLayout();
  const [hovered, setHovered] = useState(false);
  if (variant === 'ticket') {
    return <View accessible accessibilityLabel="Propulsé par Snack Manager" style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: L.sp(7),
      paddingVertical: L.sp(9), backgroundColor: palette.railBg, borderTopWidth: 1, borderTopColor: palette.line2,
    }}>
      <SMMark size={L.sp(16)} accessible={false} />
      <Text style={{ fontFamily: FONT, fontSize: L.fs(11), color: palette.dimText, fontWeight: '600' }}>
        Propulsé par <Text style={{ color: palette.text }}>Snack <Text style={{ color: palette.gold }}>Manager</Text></Text>
      </Text>
    </View>;
  }
  if (variant === 'lockup') {
    return <View accessible accessibilityLabel="Snack Manager" style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: L.sp(8), opacity: 0.6,
    }}>
      <SMMark size={L.sp(22)} accessible={false} />
      <Text style={{ fontFamily: FONT, fontSize: L.fs(14), fontWeight: '800', color: palette.text, letterSpacing: -0.3 }}>
        Snack <Text style={{ color: palette.gold }}>Manager</Text>
      </Text>
    </View>;
  }
  return <View accessible accessibilityLabel="Propulsé par Snack Manager"
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onTouchStart={() => setHovered(true)} onTouchEnd={() => setHovered(false)}
    style={{
      alignItems: 'center', gap: L.sp(7), paddingTop: L.sp(12), paddingBottom: L.sp(14),
      paddingHorizontal: L.sp(6), borderTopWidth: 1, borderTopColor: palette.line2, opacity: hovered ? 1 : 0.6,
    }}>
    {!compact ? <Text style={{ fontFamily: FONT, fontSize: L.fs(9), fontWeight: '600', letterSpacing: 1.1, color: palette.dimText }}>PROPULSÉ PAR</Text> : null}
    <SMMark size={L.sp(compact ? 24 : 26)} accessible={false} />
    {!compact ? <Text style={{ fontFamily: FONT, fontSize: L.fs(10.5), fontWeight: '700', lineHeight: L.fs(13.1), color: palette.text, textAlign: 'center', letterSpacing: -0.1 }}>
      Snack{'\n'}<Text style={{ color: palette.gold }}>Manager</Text>
    </Text> : null}
  </View>;
}
