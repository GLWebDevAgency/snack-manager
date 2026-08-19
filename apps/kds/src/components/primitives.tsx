import { type ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { hair, hair2, ink, palette, radius, surface, TOUCH_MIN, type } from '../ui';
import type { Layout } from '../useLayout';

/**
 * Le pilote natif d'Animated n'existe pas en web : le demander déclenche un
 * avertissement à chaque animation. On n'anime que des opacités, que le pilote
 * JS gère sans peine.
 */
const NATIVE_DRIVER = Platform.OS !== 'web';

// ─────────────────────────────────────────────────────────────
// Dégradé — sans dépendance graphique
// ─────────────────────────────────────────────────────────────

const SHEEN_STOPS = [0.055, 0.044, 0.034, 0.026, 0.019, 0.013, 0.008, 0.004];

/**
 * Le dégradé vertical subtil des cartes, obtenu en empilant des voiles blancs
 * de plus en plus discrets. Les paliers d'opacité sont si proches (≤ 0,013)
 * que la marche est invisible sur du noir, et l'astuce fonctionne à
 * l'identique en web et en natif — contrairement à un vrai gradient CSS.
 */
export function Sheen({ height = 110, radius: r = 0 }: { height?: number; radius?: number }) {
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          borderTopLeftRadius: r,
          borderTopRightRadius: r,
          overflow: 'hidden',
        },
      ]}
    >
      {SHEEN_STOPS.map((opacity, i) => (
        <View
          key={i}
          style={{
            height: height / SHEEN_STOPS.length,
            backgroundColor: `rgba(255,255,255,${opacity})`,
          }}
        />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Retour tactile
// ─────────────────────────────────────────────────────────────

export interface TapProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Style appliqué pendant l'appui, en plus de l'enfoncement. */
  pressedStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  label?: string;
  /** Appui « discret » : pas d'enfoncement (grandes zones, cartes). */
  flat?: boolean;
  reducedMotion?: boolean;
  selected?: boolean;
}

/**
 * Zone tactile de base. L'enfoncement (`scale .97`) et l'assombrissement sont
 * appliqués par l'état `pressed` de Pressable : la réponse est synchrone, donc
 * bien en dessous des 100 ms — sur un écran de comptoir, un appui sans retour
 * visible passe pour un bug.
 */
export function Tap({
  children,
  onPress,
  style,
  pressedStyle,
  disabled,
  label,
  flat,
  reducedMotion,
  selected,
}: TapProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      style={({ pressed }) => [
        style,
        disabled && { opacity: 0.4 },
        pressed && !disabled && [
          !flat && !reducedMotion && { transform: [{ scale: 0.97 }] },
          { opacity: 0.86 },
          pressedStyle,
        ],
      ]}
    >
      {children}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// Pastilles / chips
// ─────────────────────────────────────────────────────────────

export function Pill({
  text,
  color,
  background,
  border,
  style,
  layout,
}: {
  text: string;
  color: string;
  background?: string;
  border?: string;
  style?: StyleProp<ViewStyle>;
  /** Sans `layout`, la pastille garde sa taille de référence (écran 10"). */
  layout?: Layout;
}) {
  const size = layout ? layout.fs(13) : 13;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: background ?? 'transparent',
          borderColor: border ?? 'transparent',
          borderWidth: border ? 1 : 0,
          paddingHorizontal: Math.round(size * 0.7),
          paddingVertical: Math.round(size * 0.23),
        },
        style,
      ]}
    >
      <Text style={[styles.pillText, { color, fontSize: size }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Chip cliquable de la barre haute (filtres, bascules). Cible ≥ 44 px. */
export function Chip({
  text,
  active,
  onPress,
  accent,
  reducedMotion,
  tone,
  layout,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
  accent: string;
  reducedMotion?: boolean;
  /** Teinte d'état actif ; par défaut l'accent de marque. */
  tone?: { bg: string; fg: string };
  layout?: Layout;
}) {
  const on = tone ?? { bg: accent, fg: '#ffffff' };
  // La cible tactile suit l'écran mais ne descend jamais sous TOUCH_MIN.
  const minHeight = layout ? layout.touch : TOUCH_MIN;
  return (
    <Tap
      onPress={onPress}
      label={text}
      selected={active}
      reducedMotion={reducedMotion}
      style={[
        styles.chip,
        { minHeight, paddingHorizontal: Math.round(minHeight * 0.36) },
        active
          ? { backgroundColor: on.bg, borderColor: on.bg }
          : { backgroundColor: surface.el, borderColor: hair },
      ]}
      pressedStyle={{ backgroundColor: active ? on.bg : surface.el2 }}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? on.fg : ink.dim, fontSize: layout ? layout.fs(13.5) : 13.5 },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </Tap>
  );
}

// ─────────────────────────────────────────────────────────────
// Signes dessinés (aucune dépendance SVG ni police d'icônes)
// ─────────────────────────────────────────────────────────────

export function Check({ color, size = 18 }: { color: string; size?: number }) {
  const bar = Math.max(2, size * 0.14);
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: size * 0.06,
          top: size * 0.52,
          width: size * 0.4,
          height: bar,
          borderRadius: bar,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size * 0.28,
          top: size * 0.42,
          width: size * 0.72,
          height: bar,
          borderRadius: bar,
          backgroundColor: color,
          transform: [{ rotate: '-50deg' }],
        }}
      />
    </View>
  );
}

export function Chevron({ color, size = 16 }: { color: string; size?: number }) {
  const bar = Math.max(2, size * 0.15);
  return (
    <View style={{ width: size * 0.7, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: size * 0.24,
          width: size * 0.52,
          height: bar,
          borderRadius: bar,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: size * 0.58,
          width: size * 0.52,
          height: bar,
          borderRadius: bar,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

/** Pastille d'état de connexion, avec halo. */
export function StatusDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: color,
        borderWidth: size * 0.34,
        borderColor: `${color}33`,
        // La bordure translucide fait office de halo sans ombre colorée.
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Pulsation (carte neuve / carte en retard)
// ─────────────────────────────────────────────────────────────

/**
 * Respiration lente d'un liseré. Uniquement l'opacité est animée (jamais une
 * propriété de mise en page), et l'animation s'arrête complètement sous
 * `prefers-reduced-motion`.
 */
export function PulseRing({
  color,
  radius: r,
  active,
  reducedMotion,
}: {
  color: string;
  radius: number;
  active: boolean;
  reducedMotion: boolean;
}) {
  const value = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (!active || reducedMotion) {
      value.setValue(active ? 0.55 : 0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.95,
          duration: 900,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: NATIVE_DRIVER,
        }),
        Animated.timing(value, {
          toValue: 0.28,
          duration: 900,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: NATIVE_DRIVER,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reducedMotion, value]);

  if (!active) return null;
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          borderRadius: r,
          borderWidth: 2,
          borderColor: color,
          opacity: value,
        },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// États transverses
// ─────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  hint,
  layout,
}: {
  title: string;
  hint?: string;
  layout?: Layout;
}) {
  const scale = layout?.scale ?? 1;
  return (
    <View style={[styles.empty, { paddingVertical: Math.round(34 * scale) }]}>
      <View style={styles.emptyMark} />
      <Text style={[styles.emptyTitle, { fontSize: layout ? layout.fs(14) : 14 }]}>{title}</Text>
      {hint ? (
        <Text style={[styles.emptyHint, { fontSize: layout ? layout.fs(12.5) : 12.5 }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Squelette de carte — occupe la place réelle pendant le premier chargement. */
export function CardSkeleton({
  reducedMotion,
  layout,
}: {
  reducedMotion: boolean;
  layout?: Layout;
}) {
  const value = useRef(new Animated.Value(0.5)).current;
  const scale = layout?.scale ?? 1;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(value, { toValue: 0.45, duration: 700, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, value]);

  return (
    <Animated.View style={[styles.skeleton, { opacity: reducedMotion ? 0.6 : value }]}>
      <View style={[styles.skeletonHead, { height: Math.round(44 * scale) }]} />
      <View style={[styles.skeletonLine, { width: '70%' }]} />
      <View style={[styles.skeletonLine, { width: '45%' }]} />
      <View style={[styles.skeletonAction, { height: layout?.actionH ?? 40 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  // 13 px minimum : une pastille porte de l'information de service
  // (« Payé », « En retard »), pas de la décoration.
  pillText: {
    fontFamily: type.micro.fontFamily,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  chip: {
    minHeight: TOUCH_MIN,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontFamily: type.micro.fontFamily, fontSize: 13.5, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 34, paddingHorizontal: 18, gap: 8 },
  emptyMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: hair,
    backgroundColor: surface.el,
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: type.body.fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: ink.dim,
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily: type.body.fontFamily,
    fontSize: 12.5,
    fontWeight: '500',
    color: ink.dimmer,
    textAlign: 'center',
  },
  skeleton: {
    backgroundColor: surface.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: hair2,
    padding: 12,
    gap: 10,
  },
  skeletonHead: { height: 44, borderRadius: radius.xs, backgroundColor: surface.el },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: surface.el },
  skeletonAction: { height: 40, borderRadius: radius.xs, backgroundColor: surface.el, marginTop: 4 },
});
