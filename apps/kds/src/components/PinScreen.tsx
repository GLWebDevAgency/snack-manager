import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import {
  alpha,
  contrastOn,
  hair,
  hair2,
  ink,
  palette,
  radius,
  shadow,
  surface,
  tabular,
  TOUCH_MIN,
  type,
} from '../ui';
import { scaledStyles, type Layout } from '../useLayout';
import { Check, Sheen, Tap } from './primitives';

/**
 * Connexion par PIN — la seule porte d'entrée de l'écran cuisine.
 *
 * Pavé numérique plutôt que champ texte : gants, écran gras, aucun clavier
 * logiciel à faire apparaître. Les touches font 76 px à l'échelle de référence
 * (bien au-delà des 44 px réglementaires), grandissent avec l'écran, et
 * répondent à l'appui en moins de 100 ms.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MIN_PIN = 4;
const MAX_PIN = 6;

export function PinScreen({
  accent,
  tenantName,
  onSubmit,
  reducedMotion,
  layout,
}: {
  accent: string;
  tenantName: string;
  onSubmit: (pin: string) => Promise<void>;
  reducedMotion: boolean;
  layout: Layout;
}) {
  const styles = pinStyles(layout);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const push = useCallback(
    (digit: string) => {
      if (busy) return;
      setError(null);
      setPin((current) => (current.length >= MAX_PIN ? current : current + digit));
    },
    [busy],
  );

  const clear = useCallback(() => {
    if (busy) return;
    setError(null);
    setPin('');
  }, [busy]);

  const submit = useCallback(async () => {
    if (busy || pin.length < MIN_PIN) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible');
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [busy, onSubmit, pin]);

  // Confort de développement et d'exploitation : la tablette peut être reliée
  // à un clavier USB (installation, maintenance).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') push(event.key);
      else if (event.key === 'Backspace') setPin((c) => c.slice(0, -1));
      else if (event.key === 'Enter') void submit();
      else if (event.key === 'Escape') clear();
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [push, submit, clear]);

  const ready = pin.length >= MIN_PIN && !busy;

  return (
    <View style={styles.screen}>
      <View style={[styles.panel, shadow.panel]}>
        <Sheen height={160} radius={radius.xl} />

        <View style={styles.head}>
          <View style={[styles.brand, { backgroundColor: accent }]}>
            <Text style={[styles.brandLetter, { color: contrastOn(accent) }]}>
              {(tenantName.trim()[0] ?? 'S').toUpperCase()}
            </Text>
          </View>
          <Text style={styles.title}>Cuisine · KDS</Text>
          <Text style={styles.subtitle}>{tenantName}</Text>
        </View>

        <Text style={styles.prompt}>Code équipe</Text>

        <View style={styles.dots} accessibilityLabel={`${pin.length} chiffre(s) saisi(s)`}>
          {Array.from({ length: MAX_PIN }, (_, i) => {
            const filled = i < pin.length;
            const optional = i >= MIN_PIN;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  optional && styles.dotOptional,
                  filled && { backgroundColor: accent, borderColor: accent },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.errorSlot}>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>

        <View style={styles.pad}>
          {KEYS.map((key) => (
            <Tap
              key={key}
              onPress={() => push(key)}
              label={key}
              reducedMotion={reducedMotion}
              style={styles.key}
              pressedStyle={{ backgroundColor: surface.el2, borderColor: hair }}
            >
              <Text style={styles.keyText}>{key}</Text>
            </Tap>
          ))}

          <Tap
            onPress={clear}
            label="Effacer"
            reducedMotion={reducedMotion}
            style={[styles.key, styles.keyGhost]}
            pressedStyle={{ backgroundColor: surface.el }}
          >
            <Text style={styles.keyGhostText}>Effacer</Text>
          </Tap>

          <Tap
            onPress={() => push('0')}
            label="0"
            reducedMotion={reducedMotion}
            style={styles.key}
            pressedStyle={{ backgroundColor: surface.el2, borderColor: hair }}
          >
            <Text style={styles.keyText}>0</Text>
          </Tap>

          <Tap
            onPress={() => void submit()}
            disabled={!ready}
            label="Valider le code"
            reducedMotion={reducedMotion}
            style={[
              styles.key,
              {
                backgroundColor: ready ? accent : surface.el,
                borderColor: ready ? accent : hair2,
              },
            ]}
            pressedStyle={{ opacity: 0.82 }}
          >
            {busy ? (
              <ActivityIndicator color={contrastOn(accent)} />
            ) : (
              <Check color={ready ? contrastOn(accent) : ink.dimmer} size={layout.far(26)} />
            )}
          </Tap>
        </View>

        <Text style={styles.hint}>
          {MIN_PIN} à {MAX_PIN} chiffres, puis validez.
        </Text>
      </View>
    </View>
  );
}

const pinStyles = scaledStyles((l: Layout) => {
  const keyW = Math.round(76 * l.scale);
  const keyH = Math.max(TOUCH_MIN, l.touch, Math.round(62 * l.scale));
  const gap = 10;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.bg,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    // Le panneau suit l'échelle (340 px à la référence) mais ne descend jamais
    // sous la largeur du pavé : trois touches + deux gouttières + marges +
    // bordures — sinon la troisième colonne de touches passe à la ligne.
    panel: {
      width: Math.max(Math.round(340 * l.scale), keyW * 3 + gap * 2 + 46),
      maxWidth: '100%',
      backgroundColor: surface.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: hair2,
      paddingHorizontal: 20,
      paddingTop: 26,
      paddingBottom: 20,
      overflow: 'hidden',
    },
    head: { alignItems: 'center', gap: 8 },
    brand: {
      width: Math.round(52 * l.scale),
      height: Math.round(52 * l.scale),
      borderRadius: Math.round(15 * l.scale),
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    brandLetter: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(27),
      fontWeight: '800',
      letterSpacing: -0.8,
    },
    title: {
      fontFamily: type.title.fontFamily,
      fontSize: l.fs(19),
      fontWeight: '700',
      letterSpacing: -0.4,
      color: palette.text,
    },
    subtitle: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11.5),
      fontWeight: '700',
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: ink.dim,
    },
    prompt: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(11),
      fontWeight: '800',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: ink.dimmer,
      textAlign: 'center',
      marginTop: 22,
    },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 12 },
    dot: {
      width: l.fs(14),
      height: l.fs(14),
      borderRadius: l.fs(7),
      borderWidth: 1.5,
      borderColor: hair,
      backgroundColor: 'transparent',
    },
    dotOptional: { borderColor: alpha('#ffffff', 0.06) },
    errorSlot: { minHeight: 26, justifyContent: 'center' },
    error: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(13),
      fontWeight: '700',
      color: ink.onRed,
      textAlign: 'center',
    },
    pad: { flexDirection: 'row', flexWrap: 'wrap', gap, justifyContent: 'center' },
    key: {
      width: keyW,
      height: keyH,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: hair2,
      backgroundColor: surface.el,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyText: {
      fontFamily: type.hero.fontFamily,
      fontSize: l.far(26),
      fontWeight: '700',
      color: palette.text,
      ...tabular,
    },
    keyGhost: { backgroundColor: 'transparent', borderColor: hair2 },
    keyGhostText: {
      fontFamily: type.micro.fontFamily,
      fontSize: l.fs(12.5),
      fontWeight: '700',
      color: ink.dim,
    },
    hint: {
      fontFamily: type.body.fontFamily,
      fontSize: l.fs(12),
      color: ink.dimmer,
      textAlign: 'center',
      marginTop: 16,
    },
  });
});
