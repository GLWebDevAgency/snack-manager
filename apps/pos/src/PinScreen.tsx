/**
 * Écran de connexion par PIN.
 *
 * Un poste de caisse est allumé le matin et partagé toute la journée : la
 * saisie doit être lisible à bout de bras et pardonner l'erreur (secousse +
 * message clair, jamais de blocage).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import { TOUCH_MIN, palette } from '@sm/client-core';
import { client, TENANT_SLUG, type PinLoginResponse, type Session } from './client';
import { FONT, R, makeBrand, shadow, type } from './theme';
import { Press, Sheen, useReducedMotion } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;

export function PinScreen({
  onSession,
  tenantName,
  brandColor,
  notice,
}: {
  onSession: (s: Session) => void;
  tenantName: string;
  brandColor: string;
  /** Raison du verrouillage (session expirée, fin de poste…). */
  notice?: string | null;
}) {
  const brand = makeBrand(tenantName, brandColor);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const reduced = useReducedMotion();
  const shake = useRef(new Animated.Value(0)).current;

  const fail = useCallback(
    (message: string) => {
      setError(message);
      setPin('');
      setBusy(false);
      if (reduced) return;
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0.6, duration: 55, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    },
    [reduced, shake],
  );

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await client.direct<PinLoginResponse>('POST', '/auth/pin', {
          tenantSlug: TENANT_SLUG,
          pin: code,
        });
        client.setToken(res.token);
        onSession({
          token: res.token,
          staffName: res.staff.name,
          staffRole: res.staff.role,
          tenantName: res.tenant.name,
          tenantSlug: res.tenant.slug,
          brandColor: res.tenant.brandColor,
          at: Date.now(),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Connexion impossible';
        fail(/PIN|invalide|Unauthorized/i.test(msg) ? 'PIN incorrect — réessayez' : msg);
      }
    },
    [fail, onSession],
  );

  const push = useCallback(
    (digit: string) => {
      if (busy) return;
      setError(null);
      setPin((cur) => {
        const next = (cur + digit).slice(0, 4);
        if (next.length === 4) void submit(next);
        return next;
      });
    },
    [busy, submit],
  );

  const back = useCallback(() => {
    if (busy) return;
    setError(null);
    setPin((cur) => cur.slice(0, -1));
  }, [busy]);

  // Clavier physique (poste avec clavier, démonstration navigateur).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) push(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Escape') setPin('');
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [back, push]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
      {/* Filet d'accent en tête d'écran : signature de marque discrète. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: brand.accent,
          opacity: 0.55,
        }}
      />

      <Animated.View
        style={{
          alignItems: 'center',
          transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }) }],
        }}
      >
        <View
          style={[
            {
              width: 72,
              height: 72,
              borderRadius: 22,
              backgroundColor: brand.accent,
              alignItems: 'center',
              justifyContent: 'center',
            },
            shadow(2),
          ]}
        >
          <Text style={{ fontFamily: FONT, color: brand.onAccent, fontSize: 34, fontWeight: '800' }}>
            {brand.initial}
          </Text>
        </View>

        <Text style={[type.h1, { fontSize: 26, marginTop: 18 }]}>{brand.name}</Text>
        <Text style={[type.eyebrow, { marginTop: 8 }]}>Poste de caisse · Poste 1</Text>

        {/* Points de saisie */}
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 30, height: 18, alignItems: 'center' }}>
          {[0, 1, 2, 3].map((i) => {
            const filled = pin.length > i;
            return (
              <View
                key={i}
                style={{
                  width: filled ? 16 : 12,
                  height: filled ? 16 : 12,
                  borderRadius: 8,
                  backgroundColor: filled ? brand.accent : 'transparent',
                  borderWidth: filled ? 0 : 1.5,
                  borderColor: '#3a3a3a',
                }}
              />
            );
          })}
        </View>

        <View style={{ height: 30, justifyContent: 'center' }}>
          <Text
            style={{
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: '600',
              color: error ? palette.red : palette.mut,
              opacity: error || busy ? 1 : 0.7,
            }}
          >
            {error ?? (busy ? 'Vérification…' : 'Saisissez votre code à 4 chiffres')}
          </Text>
        </View>

        {/* Pavé numérique — posé sur un panneau, pour la stratification
            fond → panneau → touche plutôt qu'un aplat unique. */}
        <View
          style={{
            width: 378,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 12,
            padding: 18,
            borderRadius: 26,
            backgroundColor: '#0b0b0b',
            borderWidth: 1,
            borderColor: palette.line2,
            justifyContent: 'center',
          }}
        >
          {KEYS.map((k) => {
            if (k === 'clear') {
              return (
                <PadKey key={k} label="C" muted onPress={() => setPin('')} accessibilityLabel="Effacer" />
              );
            }
            if (k === 'back') {
              return <PadKey key={k} label="⌫" muted onPress={back} accessibilityLabel="Corriger" />;
            }
            return <PadKey key={k} label={k} onPress={() => push(k)} />;
          })}
        </View>
      </Animated.View>

      <Text style={[type.mut, { position: 'absolute', bottom: 22, color: '#5a5a5a', fontSize: 13 }]}>
        Snack Manager · Caisse
      </Text>
    </View>
  );
}

function PadKey({
  label,
  onPress,
  muted,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      scale={0.94}
      style={[
        {
          width: 104,
          height: 72,
          minHeight: TOUCH_MIN,
          borderRadius: R.panel,
          backgroundColor: palette.surface,
          borderWidth: 1,
          borderColor: palette.line2,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        shadow(1),
      ]}
      activeStyle={{ backgroundColor: '#212121' }}
    >
      <Sheen />
      <Text
        style={{
          fontFamily: FONT,
          color: muted ? palette.mut : palette.text,
          fontSize: muted ? 22 : 27,
          fontWeight: '700',
          letterSpacing: -0.5,
        }}
      >
        {label}
      </Text>
    </Press>
  );
}
