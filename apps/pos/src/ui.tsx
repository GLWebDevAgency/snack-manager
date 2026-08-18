/**
 * Primitives d'interface de la caisse.
 *
 * Deux exigences pilotent ces composants :
 *  - retour tactile immédiat (< 100 ms) : l'enfoncement est rendu par l'état
 *    `pressed` de Pressable, sans animation différée ;
 *  - cibles ≥ 44 px (TOUCH_MIN) — cuisiniers gantés, écrans gras.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { TOUCH_MIN, palette } from '@sm/client-core';
import { DUR, FONT, R, S, TABULAR, sheet, shadow, type, withAlpha } from './theme';

// ─── Mouvement ───

/** Respecte le réglage système « réduire les animations ». */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(!!v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(!!v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Apparition « pop » : opacité + échelle uniquement (jamais de layout animé). */
export function Pop({
  children,
  style,
  delay = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, {
      toValue: 1,
      duration: DUR.base,
      delay,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [delay, reduced, v]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ─── Dégradé sans dépendance ───

/**
 * Voile clair dégressif superposé aux cartes (linear-gradient impossible en RN
 * pur : on empile trois bandes translucides).
 */
export function Sheen({ intensity = 1 }: { intensity?: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <View style={{ flex: 1, backgroundColor: `rgba(255,255,255,${0.05 * intensity})` }} />
      <View style={{ flex: 1, backgroundColor: `rgba(255,255,255,${0.025 * intensity})` }} />
      <View style={{ flex: 2, backgroundColor: 'transparent' }} />
    </View>
  );
}


// ─── Pressable de base ───

export interface PressProps {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Style ajouté pendant l'appui (variation de fond). */
  activeStyle?: StyleProp<ViewStyle>;
  scale?: number;
  children: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'checkbox' | 'radio';
  selected?: boolean;
  testID?: string;
}

export function Press({
  onPress,
  onLongPress,
  disabled,
  style,
  activeStyle,
  scale = 0.97,
  children,
  accessibilityLabel,
  accessibilityRole = 'button',
  selected,
  testID,
}: PressProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        accessibilityRole === 'checkbox' || accessibilityRole === 'radio'
          ? { disabled: !!disabled, checked: !!selected }
          : { disabled: !!disabled, selected }
      }
      style={({ pressed }) => [
        style,
        pressed && !disabled ? activeStyle : null,
        pressed && !disabled ? { transform: [{ scale }] } : null,
        disabled ? { opacity: 0.38 } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

// ─── Boutons ───

type BtnKind = 'primary' | 'solid' | 'ghost' | 'quiet' | 'danger' | 'positive';

export function Btn({
  label,
  sub,
  onPress,
  kind = 'solid',
  accent,
  onAccent,
  disabled,
  block,
  size = 'md',
  style,
  glyph,
  accessibilityLabel,
}: {
  label: string;
  sub?: string;
  onPress?: () => void;
  kind?: BtnKind;
  accent?: string;
  onAccent?: string;
  disabled?: boolean;
  block?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  glyph?: string;
  accessibilityLabel?: string;
}) {
  const h = size === 'lg' ? 60 : size === 'sm' ? TOUCH_MIN : 52;
  const fs = size === 'lg' ? 17 : size === 'sm' ? 14 : 15.5;

  const bg =
    kind === 'primary'
      ? (accent ?? palette.gold)
      : kind === 'solid'
        ? palette.surface2
        : kind === 'danger'
          ? withAlpha(palette.red, 0.16)
          : kind === 'positive'
            ? withAlpha(palette.green, 0.16)
            : 'transparent';

  const fg =
    kind === 'primary'
      ? (onAccent ?? '#12100d')
      : kind === 'danger'
        ? palette.red
        : kind === 'positive'
          ? palette.green
          : kind === 'quiet'
            ? palette.mut
            : palette.text;

  const border =
    kind === 'ghost'
      ? palette.line
      : kind === 'solid'
        ? palette.line2
        : kind === 'danger'
          ? withAlpha(palette.red, 0.4)
          : kind === 'positive'
            ? withAlpha(palette.green, 0.4)
            : 'transparent';

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      scale={0.975}
      style={[
        {
          minHeight: h,
          paddingHorizontal: size === 'sm' ? 14 : 18,
          borderRadius: R.pill,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
        },
        kind === 'primary' ? shadow(1) : null,
        block ? { alignSelf: 'stretch' } : null,
        style,
      ]}
      activeStyle={{ opacity: 0.86 }}
    >
      {glyph ? (
        <Text style={{ fontFamily: FONT, color: fg, fontSize: fs + 2, fontWeight: '700' }}>{glyph}</Text>
      ) : null}
      <View style={{ alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: FONT, color: fg, fontSize: fs, fontWeight: '700', letterSpacing: -0.2 }}
        >
          {label}
        </Text>
        {sub ? (
          <Text style={{ fontFamily: FONT, color: fg, opacity: 0.72, fontSize: 12.5, fontWeight: '600', ...TABULAR }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Press>
  );
}

/** Bouton rond « fermer » — 44 px de zone tactile pour un glyphe de 16. */
export function CloseBtn({ onPress, label = 'Fermer' }: { onPress: () => void; label?: string }) {
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: TOUCH_MIN,
        height: TOUCH_MIN,
        borderRadius: R.pill,
        backgroundColor: palette.surface2,
        borderWidth: 1,
        borderColor: palette.line2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      activeStyle={{ backgroundColor: '#242424' }}
    >
      <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: 17, fontWeight: '600', lineHeight: 20 }}>✕</Text>
    </Press>
  );
}

// ─── Chips ───

export function Chip({
  label,
  detail,
  on,
  onPress,
  disabled,
  accent,
  onAccent,
  tone = 'accent',
  minHeight = TOUCH_MIN,
}: {
  label: string;
  detail?: string;
  on?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accent?: string;
  onAccent?: string;
  tone?: 'accent' | 'red' | 'neutral';
  minHeight?: number;
}) {
  const activeBg =
    tone === 'red' ? withAlpha(palette.red, 0.18) : tone === 'neutral' ? '#efefef' : (accent ?? palette.gold);
  const activeFg = tone === 'red' ? palette.red : tone === 'neutral' ? '#111' : (onAccent ?? '#12100d');
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      selected={!!on}
      accessibilityRole="checkbox"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={{
        minHeight,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: on ? 'transparent' : palette.line,
        backgroundColor: on ? activeBg : palette.surface2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
      }}
      activeStyle={{ backgroundColor: on ? activeBg : '#262626' }}
    >
      <Text
        style={{
          fontFamily: FONT,
          fontSize: 14.5,
          fontWeight: on ? '700' : '600',
          color: on ? activeFg : palette.text,
          letterSpacing: -0.1,
        }}
      >
        {label}
      </Text>
      {detail ? (
        <Text
          style={{
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: '700',
            color: on ? activeFg : palette.mut,
            opacity: on ? 0.8 : 1,
            ...TABULAR,
          }}
        >
          {detail}
        </Text>
      ) : null}
    </Press>
  );
}

// ─── Segmented ───

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accent,
  onAccent,
  height = TOUCH_MIN,
  flex,
}: {
  value: T;
  options: { key: T; label: string; detail?: string }[];
  onChange: (key: T) => void;
  accent: string;
  onAccent: string;
  height?: number;
  flex?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: palette.surface2,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: palette.line2,
        padding: 3,
        gap: 3,
        alignSelf: flex ? 'stretch' : 'flex-start',
      }}
    >
      {options.map((opt) => {
        const on = opt.key === value;
        return (
          <Press
            key={opt.key}
            onPress={() => onChange(opt.key)}
            selected={on}
            accessibilityRole="tab"
            accessibilityLabel={opt.label}
            scale={0.98}
            style={{
              minHeight: height - 6,
              paddingHorizontal: 16,
              borderRadius: R.pill,
              backgroundColor: on ? accent : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              flex: flex ? 1 : undefined,
            }}
            activeStyle={{ backgroundColor: on ? accent : '#2a2a2a' }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONT,
                fontSize: 14.5,
                fontWeight: on ? '700' : '600',
                color: on ? onAccent : palette.mut,
                letterSpacing: -0.1,
              }}
            >
              {opt.label}
            </Text>
            {opt.detail ? (
              <Text
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: '700',
                  color: on ? onAccent : palette.mut,
                  opacity: 0.75,
                  ...TABULAR,
                }}
              >
                {opt.detail}
              </Text>
            ) : null}
          </Press>
        );
      })}
    </View>
  );
}

// ─── Stepper quantité ───

export function Stepper({
  qty,
  onChange,
  min = 0,
  max = 99,
  compact,
}: {
  qty: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  compact?: boolean;
}) {
  const size = compact ? TOUCH_MIN : 48;
  const btn: ViewStyle = {
    width: size,
    height: size,
    alignItems: 'center',
    justifyContent: 'center',
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: palette.surface2,
        borderRadius: R.pill,
        borderWidth: 1,
        borderColor: palette.line2,
        overflow: 'hidden',
      }}
    >
      <Press
        onPress={() => onChange(Math.max(min, qty - 1))}
        disabled={qty <= min}
        accessibilityLabel="Moins"
        style={btn}
        activeStyle={{ backgroundColor: '#2c2c2c' }}
      >
        <Text style={{ fontFamily: FONT, color: palette.text, fontSize: 20, fontWeight: '700' }}>−</Text>
      </Press>
      <Text
        style={{
          fontFamily: FONT,
          color: palette.text,
          fontSize: 16,
          fontWeight: '800',
          minWidth: 26,
          textAlign: 'center',
          ...TABULAR,
        }}
      >
        {qty}
      </Text>
      <Press
        onPress={() => onChange(Math.min(max, qty + 1))}
        disabled={qty >= max}
        accessibilityLabel="Plus"
        style={btn}
        activeStyle={{ backgroundColor: '#2c2c2c' }}
      >
        <Text style={{ fontFamily: FONT, color: palette.text, fontSize: 20, fontWeight: '700' }}>+</Text>
      </Press>
    </View>
  );
}

// ─── Champ texte ───

export function Field({
  value,
  onChangeText,
  placeholder,
  label,
  keyboardType,
  style,
  autoFocus,
  maxLength,
  invalid,
  accent,
  multiline,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  label?: string;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
  maxLength?: number;
  invalid?: boolean;
  accent?: string;
  multiline?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={style}>
      {label ? <Text style={[type.eyebrow, { marginBottom: 6 }]}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#6b6b6b"
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        maxLength={maxLength}
        multiline={multiline}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        accessibilityLabel={label ?? placeholder}
        style={{
          minHeight: TOUCH_MIN,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: R.ctrl,
          backgroundColor: palette.surface2,
          borderWidth: 1,
          borderColor: invalid ? palette.red : focus ? (accent ?? palette.gold) : palette.line2,
          color: palette.text,
          fontFamily: FONT,
          fontSize: 15,
          fontWeight: '600',
          ...(multiline ? { textAlignVertical: 'top', minHeight: 64 } : null),
        }}
      />
    </View>
  );
}

// ─── Overlay modal ───

export function Overlay({
  onClose,
  children,
  width = 520,
  align = 'center',
  dim = 0.66,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'center' | 'top';
  dim?: number;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: reduced ? 0 : DUR.fast,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [reduced, v]);

  // Échap ferme la surcouche (poste au clavier / démonstration navigateur).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', justifyContent: align === 'top' ? 'flex-start' : 'center', zIndex: 70 },
      ]}
    >
      {/* Fond cliquable : purement pointeur, les lecteurs d'écran passent par
          le bouton « Fermer » explicite et la touche Échap. */}
      <Pressable
        importantForAccessibility="no"
        accessibilityElementsHidden
        onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]}
      />
      <Animated.View
        style={{
          width,
          maxWidth: '94%',
          maxHeight: '92%',
          marginTop: align === 'top' ? 24 : 0,
          opacity: v,
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        }}
      >
        <View style={sheet.panel}>
          <Sheen intensity={0.9} />
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

/** En-tête standard des surcouches : titre + sous-titre + bouton fermer. */
export function PanelHead({
  title,
  sub,
  onClose,
  right,
}: {
  title: string;
  sub?: string;
  onClose?: () => void;
  right?: ReactNode;
}) {
  return (
    <View
      style={[
        sheet.between,
        { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: S.md },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.h1, { fontSize: 20 }]}>{title}</Text>
        {sub ? <Text style={[type.mut, { marginTop: 3 }]}>{sub}</Text> : null}
      </View>
      {right}
      {onClose ? <CloseBtn onPress={onClose} /> : null}
    </View>
  );
}

// ─── Toasts ───

export interface Toast {
  id: string;
  text: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'neutral') => {
    seq.current += 1;
    const id = `t${seq.current}`;
    setItems((cur) => [...cur, { id, text, tone }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 2600);
  }, []);
  const host = useMemo(() => <ToastHost items={items} />, [items]);
  return { push, host };
}

function ToastHost({ items }: { items: Toast[] }) {
  if (items.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center', gap: 8, zIndex: 9000 }}
    >
      {items.map((t) => {
        const color =
          t.tone === 'good'
            ? palette.green
            : t.tone === 'warn'
              ? palette.amber
              : t.tone === 'bad'
                ? palette.red
                : palette.mut;
        return (
          <Pop key={t.id}>
            <View
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  borderRadius: R.pill,
                  backgroundColor: '#171717',
                  borderWidth: 1,
                  borderColor: palette.line,
                },
                shadow(2),
              ]}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
              <Text style={{ fontFamily: FONT, color: palette.text, fontSize: 14.5, fontWeight: '600' }}>
                {t.text}
              </Text>
            </View>
          </Pop>
        );
      })}
    </View>
  );
}

// ─── États transverses ───

export function EmptyState({ title, sub, glyph = '·' }: { title: string; sub?: string; glyph?: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 56, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: palette.line,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <Text style={{ fontFamily: FONT, color: '#4a4a4a', fontSize: 24, fontWeight: '300' }}>{glyph}</Text>
      </View>
      <Text style={[type.strong, { color: palette.mut, textAlign: 'center' }]}>{title}</Text>
      {sub ? (
        <Text style={[type.mut, { textAlign: 'center', marginTop: 5, color: '#6f6f6f' }]}>{sub}</Text>
      ) : null}
    </View>
  );
}

/** Barre d'attente indéterminée (chargement du menu). */
export function Loading({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <Animated.View
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: palette.line,
          opacity: reduced ? 0.6 : v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
        }}
      />
      <Text style={type.mut}>{label}</Text>
    </View>
  );
}

export { ScrollView, Text, View, sheet, type, palette, S, R };
