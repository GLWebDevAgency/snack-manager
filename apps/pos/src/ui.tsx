/**
 * Primitives d'interface de la caisse.
 *
 * Deux exigences pilotent ces composants :
 *  - retour tactile immédiat (< 100 ms) : l'enfoncement est rendu par l'état
 *    `pressed` de Pressable, sans animation différée ;
 *  - cibles ≥ 44 px (TOUCH_MIN) — cuisiniers gantés, écrans gras.
 */
import { Icon } from './Icon';
import { useTheme } from './theme';
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
import { TOUCH_MIN } from '@sm/client-core';
import { DUR, FONT, R, S, TABULAR, withAlpha } from './theme';
import { useLayout } from './useLayout';
import { usePrefs } from './usePrefs';
import { ModalSurface } from './ModalSurface';

// ─── Mouvement ───

/** Respecte le réglage système « réduire les animations ». */
export function useReducedMotion(): boolean {
  const { prefs } = usePrefs();
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
  return reduced || prefs.reduceMotion;
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
      useNativeDriver: Platform.OS !== 'web',
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
  const { palette } = useTheme();
  const { prefs } = usePrefs();
  if (prefs.reduceTransparency) return null;
  if (Platform.OS === 'web') return <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', opacity: intensity, backgroundImage: `linear-gradient(180deg, ${palette.sheen}, transparent 60%)` } as ViewStyle]} />;
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
  accessibilityRole?: 'button' | 'tab' | 'checkbox' | 'radio' | 'switch';
  selected?: boolean;
  testID?: string;
}

export function Press({
  onPress,
  onLongPress,
  disabled,
  style,
  activeStyle,
  scale = 0.985,
  children,
  accessibilityLabel,
  accessibilityRole = 'button',
  selected,
  testID,
}: PressProps) {
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      onFocus={(event) => {
        if (Platform.OS !== 'web') return;
        const target = event.target as unknown as { matches?: (selector: string) => boolean };
        setFocused(target.matches?.(':focus-visible') ?? false);
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      aria-checked={accessibilityRole === 'checkbox' || accessibilityRole === 'radio' || accessibilityRole === 'switch' ? !!selected : undefined}
      aria-selected={accessibilityRole === 'tab' ? !!selected : undefined}
      accessibilityState={
        accessibilityRole === 'checkbox' || accessibilityRole === 'radio' || accessibilityRole === 'switch'
          ? { disabled: !!disabled, checked: !!selected }
          : { disabled: !!disabled, selected }
      }
      style={({ pressed }) => [
        style,
        Platform.OS === 'web' && focused ? { outlineWidth: 3, outlineStyle: 'solid', outlineColor: palette.text, outlineOffset: 2 } as ViewStyle : null,
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
  icon,
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
  icon?: string;
  accessibilityLabel?: string;
}) {
  const { palette, semanticText, shadow } = useTheme();
  const L = useLayout();
  // La hauteur suit l'écran mais ne passe jamais sous TOUCH_MIN : c'est
  // `touch()` qui porte cette garantie, pas l'appelant.
  const h = L.touch(size === 'lg' ? 60 : size === 'sm' ? TOUCH_MIN : 52);
  const fs = L.fs(size === 'lg' ? 17 : size === 'sm' ? 14 : 15.5);

  const bg =
    kind === 'primary'
      ? (accent ?? palette.gold)
      : kind === 'solid'
        ? palette.btnDark
        : kind === 'danger'
          ? withAlpha(palette.red, 0.16)
          : kind === 'positive'
            ? withAlpha(palette.green, 0.16)
            : 'transparent';

  const fg =
    kind === 'primary'
      ? (onAccent ?? '#12100d')
      : kind === 'danger'
        ? semanticText.danger
        : kind === 'positive'
          ? palette.greenText
          : kind === 'quiet'
            ? palette.mut
            : kind === 'solid' ? '#ffffff' : palette.text;

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
      scale={0.985}
      style={[
        {
          minHeight: h,
          paddingHorizontal: size === 'sm' ? 14 : 18,
          borderRadius: R.ctrl,
          borderCurve: 'continuous',
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
      {icon ? <Icon name={icon} size={L.fs(16)} color={fg} /> : null}
      {glyph ? (
        <Text style={{ fontFamily: FONT, color: fg, fontSize: fs + 2, fontWeight: '700' }}>{glyph}</Text>
      ) : null}
      <View style={{ alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
        <Text
          numberOfLines={2}
          style={{ fontFamily: FONT, color: fg, fontSize: fs, fontWeight: '700', letterSpacing: -0.2, textAlign: 'center', flexShrink: 1 }}
        >
          {label}
        </Text>
        {sub ? (
          <Text style={{ fontFamily: FONT, color: fg, opacity: 0.72, fontSize: L.fs(12.5), fontWeight: '600', ...TABULAR }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Press>
  );
}

/** Bouton « fermer » — 44 px de zone tactile au minimum pour un glyphe de 16. */
export function CloseBtn({ onPress, label = 'Fermer' }: { onPress: () => void; label?: string }) {
  const { palette } = useTheme();
  const L = useLayout();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: L.touch(),
        height: L.touch(),
        borderRadius: R.ctrl,
        backgroundColor: palette.surface2,
        borderWidth: 1,
        borderColor: palette.line2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      activeStyle={{ backgroundColor: palette.press2 }}
    >
      <Text style={{ fontFamily: FONT, color: palette.mut, fontSize: L.fs(17), fontWeight: '600', lineHeight: L.fs(20) }}>
        ✕
      </Text>
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
  accessibilityRole = 'checkbox',
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
  accessibilityRole?: 'checkbox' | 'radio' | 'tab';
}) {
  const { palette, semanticText } = useTheme();
  const L = useLayout();
  const activeBg =
    tone === 'red' ? withAlpha(palette.red, 0.18) : tone === 'neutral' ? '#efefef' : (accent ?? palette.gold);
  const activeFg = tone === 'red' ? semanticText.danger : tone === 'neutral' ? '#111' : (onAccent ?? '#12100d');
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      selected={!!on}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={{
        minHeight: L.touch(minHeight),
        paddingHorizontal: L.sp(14),
        paddingVertical: L.sp(8),
        borderRadius: R.ctrl,
        borderWidth: 1,
        borderColor: on ? 'transparent' : palette.line,
        backgroundColor: on ? activeBg : palette.surface2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
      }}
      activeStyle={{ backgroundColor: on ? activeBg : palette.press2 }}
    >
      <Text
        style={{
          fontFamily: FONT,
          fontSize: L.fs(14.5),
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
            fontSize: L.fs(13),
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

/**
 * Sélecteur segmenté. Un onglet peut porter un `detail` — un compteur — rendu
 * en PASTILLE à côté du libellé, sur la même ligne : posé dessous, il doublait
 * la hauteur du contrôle et cassait l'alignement de la barre haute.
 *
 * `badge` colore cette pastille quand le compteur demande un geste (une
 * commande prête à appeler, par exemple). Sans lui, elle reste discrète : un
 * compteur toujours coloré ne signale plus rien.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accent,
  onAccent,
  height = TOUCH_MIN,
  flex,
  badge,
  tone = 'surface',
}: {
  value: T;
  options: { key: T; label: string; detail?: string; icon?: string }[];
  onChange: (key: T) => void;
  accent: string;
  onAccent: string;
  height?: number;
  flex?: boolean;
  badge?: string;
  tone?: 'surface' | 'strong' | 'brand';
}) {
  const { palette } = useTheme();
  const L = useLayout();
  const h = L.touch(height);
  const selectedBackground = tone === 'brand' ? accent : tone === 'strong' ? palette.text : palette.surface;
  const selectedText = tone === 'brand' ? onAccent : tone === 'strong' ? palette.surface : palette.text;
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: palette.surface2,
        borderRadius: R.ctrl + 3,
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
            accessibilityLabel={opt.detail ? `${opt.label}, ${opt.detail}` : opt.label}
            scale={0.98}
            style={{
              minHeight: h,
              paddingHorizontal: opt.detail ? Math.min(L.segmentPadX, L.sp(12)) : L.segmentPadX,
              borderRadius: R.ctrl,
              backgroundColor: on ? selectedBackground : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              flex: flex ? 1 : undefined,
            }}
            activeStyle={{ backgroundColor: on ? selectedBackground : palette.press2 }}
          >
            {opt.icon ? <Icon name={opt.icon} size={L.fs(18)} color={on ? selectedText : palette.mut} /> : null}
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONT,
                fontSize: L.fs(14),
                fontWeight: on ? '600' : '400',
                color: on ? selectedText : palette.mut,
                letterSpacing: -0.1,
                flexShrink: 1,
              }}
            >
              {opt.label}
            </Text>
            {opt.detail ? (
              <View
                style={{
                  minWidth: L.sp(22),
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: R.pill,
                  alignItems: 'center',
                  backgroundColor: badge ?? (on ? withAlpha('#000000', 0.22) : palette.line),
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: FONT,
                    fontSize: L.fs(12.5),
                    fontWeight: '800',
                    color: badge ? '#08120a' : on ? selectedText : palette.text,
                    ...TABULAR,
                  }}
                >
                  {opt.detail}
                </Text>
              </View>
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
  const { palette } = useTheme();
  const L = useLayout();
  const size = L.touch(compact ? TOUCH_MIN : 48);
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
        borderRadius: R.ctrl,
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
        activeStyle={{ backgroundColor: palette.press2 }}
      >
        <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(20), fontWeight: '700' }}>−</Text>
      </Press>
      <Text
        style={{
          fontFamily: FONT,
          color: palette.text,
          fontSize: L.fs(16),
          fontWeight: '800',
          minWidth: L.sp(26),
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
        activeStyle={{ backgroundColor: palette.press2 }}
      >
        <Text style={{ fontFamily: FONT, color: palette.text, fontSize: L.fs(20), fontWeight: '700' }}>+</Text>
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
  secureTextEntry,
  autoCapitalize,
  autoCorrect,
  autoComplete,
  onSubmitEditing,
  disabled,
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
  /** Jetons/scanners : le secret reste masqué pendant la saisie. */
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  autoComplete?: 'off' | 'name' | 'tel';
  onSubmitEditing?: () => void;
  disabled?: boolean;
}) {
  const { type, palette } = useTheme();
  const L = useLayout();
  const [focus, setFocus] = useState(false);
  return (
    <View style={style}>
      {label ? <Text style={[type.eyebrow, { marginBottom: 6 }]}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        maxLength={maxLength}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        autoComplete={autoComplete}
        onSubmitEditing={onSubmitEditing}
        editable={!disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        accessibilityLabel={label ?? placeholder}
        style={{
          minHeight: L.touch(),
          paddingHorizontal: L.sp(14),
          paddingVertical: L.sp(10),
          borderRadius: R.ctrl,
          backgroundColor: palette.field,
          borderWidth: 1,
          borderColor: invalid ? palette.red : focus ? (accent ?? palette.gold) : palette.line2,
          color: palette.text,
          fontFamily: FONT,
          fontSize: L.fs(15),
          fontWeight: '600',
          opacity: disabled ? 0.55 : 1,
          ...(multiline ? { textAlignVertical: 'top', minHeight: L.sp(64) } : null),
        }}
      />
    </View>
  );
}

// ─── Overlay modal ───

type ModalInitialFocus = 'first' | 'input';

interface WebModalLayer {
  root: HTMLElement;
  close: () => void;
  initialFocus: ModalInitialFocus;
  previousFocus: HTMLElement | null;
  fallbackFocus: HTMLElement | null;
  cancelScheduledFocus?: () => void;
  manager: WebModalManager;
}

interface WebModalManager {
  register: (
    root: HTMLElement,
    close: () => void,
    initialFocus: ModalInitialFocus,
  ) => WebModalLayer;
  unregister: (layer: WebModalLayer) => void;
  replaceRoot: (layer: WebModalLayer, root: HTMLElement) => void;
  refocus: (layer: WebModalLayer) => void;
  isTop: (layer: WebModalLayer) => boolean;
}

interface IsolationSnapshot {
  inert: boolean;
  ariaHidden: string | null;
}

const webModalManagers = new WeakMap<Document, WebModalManager>();

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function scheduleOnNextFrame(doc: Document, callback: () => void): () => void {
  let cancelled = false;
  const win = doc.defaultView;
  if (win?.requestAnimationFrame) {
    const frame = win.requestAnimationFrame(() => {
      if (!cancelled) callback();
    });
    return () => {
      cancelled = true;
      win.cancelAnimationFrame(frame);
    };
  }

  const timeout = globalThis.setTimeout(() => {
    if (!cancelled) callback();
  }, 0);
  return () => {
    cancelled = true;
    globalThis.clearTimeout(timeout);
  };
}

function getWebModalManager(doc: Document): WebModalManager {
  const known = webModalManagers.get(doc);
  if (known) return known;

  let layers: WebModalLayer[] = [];
  let isolation = new Map<HTMLElement, IsolationSnapshot>();
  let bodyOverflow: string | null = null;
  let cancelScheduledRestore: (() => void) | undefined;
  let redirectingFocus = false;

  const top = (): WebModalLayer | undefined => {
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (layer?.root.isConnected) return layer;
    }
    return undefined;
  };

  const restoreIsolation = () => {
    for (const [element, snapshot] of isolation) {
      element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
    isolation = new Map();
  };

  /**
   * Rend inertes toutes les branches DOM qui ne mènent pas à la couche active.
   * On remonte jusqu'au body : une modale rendue dans la zone centrale isole
   * donc aussi la TopBar, et pas uniquement ses voisins immédiats.
   */
  const applyIsolation = () => {
    restoreIsolation();
    const active = top();
    if (!active) return;

    let branch: HTMLElement = active.root;
    let parent = branch.parentElement;
    while (parent) {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement) || child === branch) continue;
        isolation.set(child, {
          inert: child.inert,
          ariaHidden: child.getAttribute('aria-hidden'),
        });
        child.inert = true;
        child.setAttribute('aria-hidden', 'true');
      }
      if (parent === doc.body) break;
      branch = parent;
      parent = parent.parentElement;
    }
  };

  const focusable = (layer: WebModalLayer): HTMLElement[] =>
    Array.from(layer.root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        element.getAttribute('aria-disabled') !== 'true' &&
        !element.closest('[inert], [aria-hidden="true"]'),
    );

  const focusLayerNow = (layer: WebModalLayer) => {
    if (top() !== layer || !layer.root.isConnected) return;
    const candidates = focusable(layer);
    const preferred =
      layer.initialFocus === 'input'
        ? candidates.find((element) =>
            element.matches('input:not([disabled]), textarea:not([disabled])'),
          )
        : undefined;
    (preferred ?? candidates[0] ?? layer.root).focus();
  };

  const scheduleLayerFocus = (layer: WebModalLayer) => {
    layer.cancelScheduledFocus?.();
    layer.cancelScheduledFocus = scheduleOnNextFrame(doc, () => focusLayerNow(layer));
  };

  const canRestore = (element: HTMLElement | null, active: WebModalLayer | undefined): element is HTMLElement =>
    !!element &&
    element.isConnected &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    (!active || active.root.contains(element));

  const onKeyDown = (event: KeyboardEvent) => {
    const active = top();
    if (!active) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      active.close();
      return;
    }
    if (event.key !== 'Tab') return;

    const candidates = focusable(active);
    if (candidates.length === 0) {
      event.preventDefault();
      active.root.focus();
      return;
    }

    const first = candidates[0]!;
    const last = candidates[candidates.length - 1]!;
    const current = doc.activeElement;
    if (!active.root.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (current === first || current === active.root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Le piège ne dépend pas uniquement de Tab : il ramène aussi un focus
  // programmatique ou issu d'une extension dans la couche active.
  const onFocusIn = (event: FocusEvent) => {
    const active = top();
    const target = event.target;
    if (
      !active ||
      redirectingFocus ||
      !(target instanceof Node) ||
      active.root.contains(target)
    ) {
      return;
    }
    redirectingFocus = true;
    focusLayerNow(active);
    redirectingFocus = false;
  };

  const manager: WebModalManager = {
    register(root, close, initialFocus) {
      cancelScheduledRestore?.();
      cancelScheduledRestore = undefined;

      const activeBefore = top();
      const activeElement = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      const layer: WebModalLayer = {
        root,
        close,
        initialFocus,
        previousFocus: activeElement,
        // Si plusieurs couches disparaissent dans le même rendu, cette cible
        // reste hors de la pile et permet une restitution au déclencheur réel.
        fallbackFocus: activeBefore?.fallbackFocus ?? activeElement,
        manager,
      };

      if (layers.length === 0) {
        bodyOverflow = doc.body.style.overflow;
        doc.body.style.overflow = 'hidden';
        doc.addEventListener('keydown', onKeyDown, true);
        doc.addEventListener('focusin', onFocusIn, true);
      }
      layers.push(layer);
      applyIsolation();
      scheduleLayerFocus(layer);
      return layer;
    },

    unregister(layer) {
      // Au moment où React exécute un cleanup passif, le nœud peut déjà être
      // détaché du document. L'ordre de pile reste alors la source de vérité
      // pour savoir quelle couche doit restituer le focus.
      const wasTop = layers[layers.length - 1] === layer;
      layer.cancelScheduledFocus?.();
      layers = layers.filter((candidate) => candidate !== layer);
      applyIsolation();

      if (layers.length === 0) {
        doc.removeEventListener('keydown', onKeyDown, true);
        doc.removeEventListener('focusin', onFocusIn, true);
        if (bodyOverflow !== null) doc.body.style.overflow = bodyOverflow;
        bodyOverflow = null;
      }

      if (!wasTop) return;
      const activeAfter = top();
      const restoreTarget = canRestore(layer.previousFocus, activeAfter)
        ? layer.previousFocus
        : canRestore(layer.fallbackFocus, activeAfter)
          ? layer.fallbackFocus
          : null;
      cancelScheduledRestore = scheduleOnNextFrame(doc, () => {
        const currentTop = top();
        if (canRestore(restoreTarget, currentTop)) restoreTarget.focus();
        else if (currentTop) focusLayerNow(currentTop);
      });
    },

    replaceRoot(layer, root) {
      // Une rotation peut déplacer le même dialogue dans/hors du portail.
      // Conserver sa place dans la pile et son déclencheur : le réinscrire
      // comme une nouvelle modale perdrait la cible de restitution du focus.
      layer.cancelScheduledFocus?.();
      layer.root = root;
      applyIsolation();
      if (top() === layer) scheduleLayerFocus(layer);
    },

    refocus(layer) {
      if (top() === layer) scheduleLayerFocus(layer);
    },

    isTop(layer) {
      return top() === layer;
    },
  };

  webModalManagers.set(doc, manager);
  return manager;
}

function useWebModalLayer(
  rootRef: { current: HTMLElement | null },
  onClose: () => void,
  initialFocus: ModalInitialFocus,
  focusKey?: string | number,
): { requestClose: () => void; attachRoot: (node: unknown) => void } {
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  const layerRef = useRef<WebModalLayer | null>(null);
  onCloseRef.current = onClose;
  initialFocusRef.current = initialFocus;

  const attachRoot = useCallback((node: unknown) => {
    const root = node as HTMLElement | null;
    rootRef.current = root;
    const layer = layerRef.current;
    if (Platform.OS === 'web' && root && layer && layer.root !== root) {
      layer.manager.replaceRoot(layer, root);
    }
  }, [rootRef]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    const root = rootRef.current;
    if (!doc || !root) return;

    const manager = getWebModalManager(doc);
    const layer = manager.register(root, () => onCloseRef.current(), initialFocusRef.current);
    layerRef.current = layer;
    return () => {
      layerRef.current = null;
      manager.unregister(layer);
    };
  }, [rootRef]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.initialFocus = initialFocus;
    layer.manager.refocus(layer);
  }, [focusKey, initialFocus]);

  const requestClose = useCallback(() => {
    const layer = layerRef.current;
    if (Platform.OS === 'web' && layer && !layer.manager.isTop(layer)) return;
    onCloseRef.current();
  }, []);
  return { requestClose, attachRoot };
}

/**
 * Surcouche modale — largeur FLUIDE bornée à l'écran.
 *
 * `width` n'est plus une largeur figée mais une largeur souhaitée : `L.modal()`
 * la fait suivre l'échelle et la borne à la fenêtre, marges comprises. Le
 * panneau peut rétrécir en hauteur (`flexShrink`) au lieu de se faire couper :
 * sur une 10" en portrait, la config express garde son pied et son bouton
 * d'ajout visibles, le contenu défile.
 */
const viewportLayer = { position: 'fixed' } as unknown as ViewStyle;

export function Overlay({
  onClose,
  children,
  accessibilityLabel,
  width = 520,
  align = 'center',
  dim,
  initialFocus = 'first',
  focusKey,
}: {
  onClose: () => void;
  children: ReactNode;
  accessibilityLabel: string;
  width?: number;
  align?: 'center' | 'top';
  dim?: number;
  /** Les flux scanner/formulaire peuvent donner la priorité au premier champ. */
  initialFocus?: 'first' | 'input';
  /** Repositionne le focus lorsqu'une étape remplace le contenu du dialogue. */
  focusKey?: string | number;
}) {
  const { sheet, palette } = useTheme();
  const L = useLayout();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const modalRoot = useRef<HTMLElement | null>(null);
  const { requestClose, attachRoot } = useWebModalLayer(modalRoot, onClose, initialFocus, focusKey);

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: reduced ? 0 : DUR.fast,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [reduced, v]);

  return (
    <ModalSurface compact={L.compact} onClose={requestClose}>
    <View
      ref={attachRoot}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityViewIsModal
      style={[
        StyleSheet.absoluteFill,
        L.compact && Platform.OS === 'web' ? viewportLayer : null,
        { alignItems: 'center', justifyContent: align === 'top' ? 'flex-start' : 'center', zIndex: 70 },
      ]}
    >
      {/* Fond cliquable : purement pointeur, les lecteurs d'écran passent par
          le bouton « Fermer » explicite et la touche Échap. */}
      <Pressable
        tabIndex={-1}
        focusable={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        onPress={requestClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: dim === undefined ? palette.scrim : `rgba(0,0,0,${dim})` }]}
      />
      <Animated.View
        style={{
          width: L.modal(width),
          maxWidth: '96%',
          maxHeight: align === 'top' ? '88%' : '94%',
          flexShrink: 1,
          marginTop: align === 'top' ? L.sp(24) : 0,
          opacity: v,
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        }}
      >
        <View style={[sheet.panel, { flexShrink: 1 }]}>
          <Sheen intensity={0.9} />
          {children}
        </View>
      </Animated.View>
    </View>
    </ModalSurface>
  );
}

/**
 * Tiroir latéral — support du ticket escamotable en mode compact.
 *
 * Il se glisse par la droite, là où le panneau ancré se trouve sur les grands
 * écrans : le caissier retrouve le ticket au même endroit, quelle que soit la
 * taille du poste. Son z-index reste SOUS celui des modales, pour qu'une
 * configuration produit ouverte depuis une ligne du ticket passe devant.
 */
export function Drawer({
  onClose,
  children,
  width,
  accessibilityLabel = 'Ticket en cours',
  side = 'right',
}: {
  onClose: () => void;
  children: ReactNode;
  width: number;
  accessibilityLabel?: string;
  side?: 'left' | 'right';
}) {
  const { shadow, palette } = useTheme();
  const L = useLayout();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const drawerRoot = useRef<HTMLElement | null>(null);
  const { requestClose, attachRoot } = useWebModalLayer(drawerRoot, onClose, 'first');

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: reduced ? 0 : DUR.fast,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [reduced, v]);

  return (
    <ModalSurface compact={L.compact} onClose={requestClose}>
    <View
      ref={attachRoot}
      tabIndex={-1}
      role="dialog"
      aria-modal
      aria-label={accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, L.compact && Platform.OS === 'web' ? viewportLayer : null, { flexDirection: 'row', justifyContent: side === 'left' ? 'flex-start' : 'flex-end', zIndex: 60 }]}
    >
      <Pressable
        tabIndex={-1}
        focusable={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        onPress={requestClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }]}
      />
      <Animated.View
        style={[
          {
            width,
            maxWidth: '100%',
            opacity: v,
            transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [side === 'left' ? -width : width, 0] }) }],
          },
          shadow(3),
        ]}
      >
        {children}
      </Animated.View>
    </View>
    </ModalSurface>
  );
}

/** Panneau non modal : le catalogue et le ticket restent utilisables. */
export function InlinePanel({ children, width, onClose, label }: {
  children: ReactNode;
  width: number;
  onClose: () => void;
  label: string;
}) {
  const { palette } = useTheme();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1, duration: reduced ? 0 : 300,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const close = (event: KeyboardEvent) => {
      // Une vraie modale (espèces, fidélité...) conserve la priorité Échap.
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  return <Animated.View accessibilityLabel={label} role="region" style={{
    width, minHeight: 0, backgroundColor: palette.surface,
    borderLeftWidth: 1, borderLeftColor: palette.line,
    opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  }}>{children}</Animated.View>;
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
  const { sheet, type } = useTheme();
  const L = useLayout();
  return (
    <View
      style={[
        sheet.between,
        { paddingHorizontal: L.sp(S.xl), paddingTop: L.sp(S.xl), paddingBottom: L.sp(S.md), gap: L.sp(S.md) },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={[type.h1, { fontSize: L.fs(20) }]}>{title}</Text>
        {sub ? <Text style={[type.mut, { marginTop: 3, fontSize: L.fs(13) }]}>{sub}</Text> : null}
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
  const { palette, shadow } = useTheme();
  const L = useLayout();
  if (items.length === 0) return null;
  return (
    <View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: 0,
        right: 0,
        // En compact, la barre d'accès au ticket occupe le pied d'écran : le
        // toast se pose au-dessus plutôt que de la recouvrir.
        bottom: L.compact ? 26 + L.touch(52) + 24 : 26,
        alignItems: 'center',
        gap: 8,
        zIndex: 9000,
      }}
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
              accessible
              accessibilityLiveRegion={t.tone === 'bad' ? 'assertive' : 'polite'}
              role={t.tone === 'bad' ? 'alert' : 'status'}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  borderRadius: R.pill,
                  backgroundColor: palette.surface2,
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
  const { palette, type } = useTheme();
  const L = useLayout();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        // Un état vide ne doit pas pousser le contenu utile hors de l'écran sur
        // une petite hauteur.
        paddingVertical: L.height < 700 ? 28 : L.sp(56),
        paddingHorizontal: L.sp(24),
      }}
    >
      <View
        style={{
          width: L.sp(64),
          height: L.sp(64),
          borderRadius: L.sp(20),
          borderWidth: 1,
          borderColor: palette.line,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <Text style={{ fontFamily: FONT, color: palette.dimText, fontSize: 24, fontWeight: '300' }}>{glyph}</Text>
      </View>
      <Text style={[type.strong, { color: palette.text, textAlign: 'center', fontSize: L.fs(16) }]}>{title}</Text>
      {sub ? (
        <Text style={[type.mut, { textAlign: 'center', marginTop: 5, color: palette.mut, fontSize: L.fs(13) }]}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** Barre d'attente indéterminée (chargement du menu). */
export function Loading({ label }: { label: string }) {
  const { palette, type } = useTheme();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
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

export { ScrollView, Text, View, S, R };
export { sheet, type, palette } from './theme';
