import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon } from '@sm/ui-native';
import { contrastOn, radius, TOUCH_MIN, type Ui } from '../ui';
import { useUi } from '../theme';
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

const SHEEN_STOPS = [1, 0.8, 0.6, 0.45, 0.32, 0.2, 0.12, 0.05];

/**
 * Dégradé CSS sur le web, voiles de même teinte sur les surfaces natives.
 * La force du reflet suit le thème ; aucune image distante n'est nécessaire.
 */
export function Sheen({ height = 110, radius: r = 0 }: { height?: number; radius?: number }) {
  const { theme, palette, reducedTransparency } = useUi();
  if (reducedTransparency) return null;
  if (Platform.OS === 'web') return <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', borderTopLeftRadius: r, borderTopRightRadius: r, backgroundImage: `linear-gradient(180deg, ${palette.sheen}, transparent 55%)` } as ViewStyle]} />;
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
            backgroundColor: `rgba(255,255,255,${opacity * (theme === 'light' ? 0.55 : 0.04)})`,
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
  nativeID?: string;
  /** Appui « discret » : pas d'enfoncement (grandes zones, cartes). */
  flat?: boolean;
  reducedMotion?: boolean;
  selected?: boolean;
  role?: 'button' | 'radio' | 'tab' | 'switch';
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
  nativeID,
  flat,
  reducedMotion,
  selected,
  role = 'button',
}: TapProps) {
  const { palette } = useUi();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      nativeID={nativeID}
      onPress={onPress}
      disabled={disabled}
      onFocus={(event) => {
        if (Platform.OS !== 'web') return;
        const target = event.target as unknown as { matches?: (selector: string) => boolean };
        setFocused(target.matches?.(':focus-visible') ?? false);
      }}
      onBlur={() => setFocused(false)}
      accessibilityRole={role}
      accessibilityLabel={label}
      aria-checked={role === 'radio' || role === 'switch' ? !!selected : undefined}
      aria-selected={role === 'tab' ? !!selected : undefined}
      aria-pressed={role === 'button' && selected !== undefined ? selected : undefined}
      accessibilityState={role === 'radio' || role === 'switch' ? { disabled: !!disabled, checked: !!selected } : { disabled: !!disabled, selected }}
      {...(Platform.OS === 'web' && role !== 'button' ? {
        tabIndex: role === 'radio' || role === 'tab' ? (selected ? 0 : -1) : undefined,
        // RN web réserve Espace aux boutons : les contrôles ARIA ont besoin
        // du même geste, sans intercepter Entrée déjà gérée par Pressable.
        onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
          if (disabled || event.target !== event.currentTarget) return;
          if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            if (!event.repeat) onPress?.();
            return;
          }
          if (role !== 'radio' && role !== 'tab') return;
          const group = event.currentTarget.closest(role === 'radio' ? '[role="radiogroup"]' : '[role="tablist"]');
          if (!group || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          const items = Array.from(group.querySelectorAll<HTMLElement>(`[role="${role}"]:not([aria-disabled="true"])`));
          const index = items.indexOf(event.currentTarget);
          if (index === -1 || items.length === 0) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
            : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next].focus();
          items[next].click();
        },
      } : {})}
      style={({ pressed }) => [
        style,
        Platform.OS === 'web' && focused ? { outlineWidth: 3, outlineStyle: 'solid', outlineColor: palette.text, outlineOffset: 2 } as ViewStyle : null,
        disabled && { opacity: 0.4 },
        pressed && !disabled && [
          !flat && !reducedMotion && { transform: [{ scale: 0.985 }] },
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
  const ui = useUi();
  const styles = primitiveStyles(ui);
  const size = layout ? layout.fs(11.5) : 11.5;
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: background ?? 'transparent',
          borderColor: border ?? 'transparent',
          borderWidth: border ? 1 : 0,
          minHeight: layout ? layout.fs(22) : 22,
          paddingHorizontal: layout ? layout.fs(8) : 8,
          paddingVertical: layout ? layout.fs(3) : 3,
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
  icon,
  iconOnly = false,
  disabled = false,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
  accent: string;
  reducedMotion?: boolean;
  /** Teinte d'état actif ; par défaut l'accent de marque. */
  tone?: { bg: string; fg: string };
  layout?: Layout;
  icon?: string;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const ui = useUi();
  const { surface, hair, ink } = ui;
  const styles = primitiveStyles(ui);
  const on = tone ?? { bg: accent, fg: contrastOn(accent) };
  // La cible tactile suit l'écran mais ne descend jamais sous TOUCH_MIN.
  const minHeight = layout ? layout.touch : TOUCH_MIN;
  return (
    <Tap
      onPress={onPress}
      label={text}
      disabled={disabled}
      selected={active}
      reducedMotion={reducedMotion}
      style={[
        styles.chip,
        { minHeight, minWidth: iconOnly ? minHeight : undefined, paddingHorizontal: iconOnly ? 0 : Math.round(minHeight * 0.36), flexDirection: 'row', alignItems: 'center', gap: layout ? layout.fs(7) : 7 },
        active
          ? { backgroundColor: on.bg, borderColor: on.bg }
          : { backgroundColor: surface.card, borderColor: hair },
      ]}
      pressedStyle={{ backgroundColor: active ? on.bg : surface.el2 }}
    >
      {icon ? <Icon name={icon} size={layout ? layout.fs(16) : 16} color={active ? on.fg : ink.dim} /> : null}
      {!iconOnly ? <Text
        style={[
          styles.chipText,
          { color: active ? on.fg : ink.dim, fontSize: layout ? layout.fs(13.5) : 13.5 },
        ]}
        numberOfLines={1}
      >
        {text}
      </Text> : null}
    </Tap>
  );
}

// ─────────────────────────────────────────────────────────────
// Signes du kit partagé, sans police d'icônes
// ─────────────────────────────────────────────────────────────

export function Check({ color, size = 18 }: { color: string; size?: number }) {
  return <Icon name="check" size={size} color={color} />;
}

export function Chevron({ color, size = 16 }: { color: string; size?: number }) {
  return <Icon name="chev" size={size} color={color} />;
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
  periodMs = 2400,
}: {
  color: string;
  radius: number;
  active: boolean;
  reducedMotion: boolean;
  periodMs?: number;
}) {
  const value = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    if (!active || reducedMotion) {
      value.setValue(active ? 0.55 : 0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.75,
          duration: periodMs / 2,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: NATIVE_DRIVER,
        }),
        Animated.timing(value, {
          toValue: 0.15,
          duration: periodMs / 2,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: NATIVE_DRIVER,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reducedMotion, value, periodMs]);

  if (!active) return null;
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          pointerEvents: 'none',
          borderRadius: r,
          borderWidth: 1.5,
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
  icon = 'bell',
}: {
  title: string;
  hint?: string;
  layout?: Layout;
  icon?: string;
}) {
  const ui = useUi();
  const styles = primitiveStyles(ui);
  const scale = layout?.scale ?? 1;
  return (
    <View style={[styles.empty, { paddingVertical: Math.round(34 * scale) }]}>
      <View style={[styles.emptyMark, { width: layout ? layout.fs(64) : 64, height: layout ? layout.fs(64) : 64 }]}><Icon name={icon} size={layout ? layout.fs(26) : 26} color={ui.ink.dim} /></View>
      <Text style={[styles.emptyTitle, { fontSize: layout ? layout.fs(16) : 16 }]}>{title}</Text>
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
  const ui = useUi();
  const styles = primitiveStyles(ui);
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

function buildPrimitiveStyles({ hair, hair2, surface, ink, type }: Ui) { return StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  // Taille effective calculée par Pill selon l'échelle de lecture du poste.
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
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  chipText: { fontFamily: type.micro.fontFamily, fontSize: 13.5, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 34, paddingHorizontal: 18, gap: 8 },
  emptyMark: {
    width: 34,
    height: 34,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: hair2,
    padding: 12,
    gap: 10,
  },
  skeletonHead: { height: 44, borderRadius: radius.xs, backgroundColor: surface.el },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: surface.el },
  skeletonAction: { height: 40, borderRadius: radius.xs, backgroundColor: surface.el, marginTop: 4 },
}); }

const primitiveCache = new Map<string, ReturnType<typeof buildPrimitiveStyles>>();
function primitiveStyles(ui: Ui) {
  const found = primitiveCache.get(ui.theme);
  if (found) return found;
  const styles = buildPrimitiveStyles(ui);
  primitiveCache.set(ui.theme, styles);
  return styles;
}

// Gestion du focus et isolation des couches web, identique au contrat du POS.
type ModalInitialFocus = 'first' | 'input';

interface WebModalLayer {
  root: HTMLElement;
  close: () => void;
  initialFocus: ModalInitialFocus;
  previousFocus: HTMLElement | null;
  fallbackFocus: HTMLElement | null;
  resolveReturnFocus?: () => HTMLElement | null;
  fallbackReturnFocus?: () => HTMLElement | null;
  cancelScheduledFocus?: () => void;
  manager: WebModalManager;
}

interface WebModalManager {
  register: (
    root: HTMLElement,
    close: () => void,
    initialFocus: ModalInitialFocus,
    resolveReturnFocus?: () => HTMLElement | null,
  ) => WebModalLayer;
  unregister: (layer: WebModalLayer) => void;
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
    register(root, close, initialFocus, resolveReturnFocus) {
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
        resolveReturnFocus,
        fallbackReturnFocus: activeBefore?.fallbackReturnFocus ?? resolveReturnFocus,
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
      cancelScheduledRestore?.();
      cancelScheduledRestore = scheduleOnNextFrame(doc, () => {
        const currentTop = top();
        // La rotation peut remplacer le déclencheur pendant l'ouverture.
        // Résoudre sa nouvelle instance après le rendu et la fin de l'isolation.
        const restoreTarget = [
          layer.previousFocus,
          layer.resolveReturnFocus?.() ?? null,
          layer.fallbackFocus,
          layer.fallbackReturnFocus?.() ?? null,
        ].find((candidate) => canRestore(candidate, currentTop));
        if (restoreTarget) restoreTarget.focus();
        else if (currentTop) focusLayerNow(currentTop);
      });
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
  returnFocusId?: string,
): () => void {
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  const layerRef = useRef<WebModalLayer | null>(null);
  const returnFocusIdRef = useRef(returnFocusId);
  onCloseRef.current = onClose;
  initialFocusRef.current = initialFocus;
  returnFocusIdRef.current = returnFocusId;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as { document?: Document }).document;
    const root = rootRef.current;
    if (!doc || !root) return;

    const manager = getWebModalManager(doc);
    const layer = manager.register(root, () => onCloseRef.current(), initialFocusRef.current, () => {
      const id = returnFocusIdRef.current;
      return id ? doc.getElementById(id) : null;
    });
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

  return useCallback(() => {
    const layer = layerRef.current;
    if (Platform.OS === 'web' && layer && !layer.manager.isTop(layer)) return;
    onCloseRef.current();
  }, []);
}

/** Dialogue centré : même fermeture et même ordre clavier dans les deux thèmes. */
export function Overlay({ layout, reducedMotion, onClose, label, returnFocusId, children }: {
  layout: Layout;
  reducedMotion: boolean;
  onClose: () => void;
  label: string;
  /** Identité native du déclencheur, conservée lorsque sa disposition change. */
  returnFocusId?: string;
  children: ReactNode;
}) {
  const { surface, hair, shadow, scrim, reducedTransparency } = useUi();
  const root = useRef<HTMLElement | null>(null);
  const requestClose = useWebModalLayer(root, onClose, 'first', undefined, returnFocusId);
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: reducedMotion ? 0 : 260,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { requestClose(); return true; });
    return () => subscription.remove();
  }, [requestClose]);
  return <View ref={(node) => { root.current = node as unknown as HTMLElement | null; }}
    tabIndex={-1} role="dialog" aria-modal aria-label={label} accessibilityLabel={label} accessibilityViewIsModal
    style={[StyleSheet.absoluteFill, Platform.OS === 'web' ? { position: 'fixed' } as unknown as ViewStyle : null,
      { zIndex: 80, alignItems: 'center', justifyContent: 'center' }]}>
    <Pressable tabIndex={-1} focusable={false} importantForAccessibility="no" accessibilityElementsHidden
      onPress={requestClose} style={[StyleSheet.absoluteFill, { backgroundColor: reducedTransparency ? surface.bg : scrim }]} />
    <Animated.View style={{ width: layout.modalW, maxWidth: '96%', maxHeight: layout.height - layout.pad * 2,
      flexShrink: 1, opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      backgroundColor: surface.card, borderColor: hair, borderWidth: 1, borderRadius: radius.sheet, overflow: 'hidden', ...shadow.panel }}>
      {children}
    </Animated.View>
  </View>;
}

export function PanelHead({ title, sub, onClose, right, layout, reducedMotion }: {
  title: string;
  sub?: string;
  onClose?: () => void;
  right?: ReactNode;
  layout: Layout;
  reducedMotion: boolean;
}) {
  const { type, ink, surface, hair2 } = useUi();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.fs(12),
    paddingHorizontal: layout.fs(20), paddingTop: layout.fs(20), paddingBottom: layout.fs(12) }}>
    <View style={{ flex: 1 }}>
      <Text accessibilityRole="header" style={[type.title, { fontSize: layout.fs(20) }]}>{title}</Text>
      {sub ? <Text style={[type.body, { fontSize: layout.fs(13), marginTop: layout.fs(3) }]}>{sub}</Text> : null}
    </View>
    {right}
    {onClose ? <Tap onPress={onClose} label="Fermer" reducedMotion={reducedMotion}
      style={{ width: layout.touch, height: layout.touch, borderRadius: radius.sm, backgroundColor: surface.el,
        borderWidth: 1, borderColor: hair2, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="close" size={layout.fs(18)} color={ink.dim} />
    </Tap> : null}
  </View>;
}

/** Sélecteur contrôlé : l'indicateur glisse sans déplacer le contenu ni son focus. */
export function Segmented<T extends string>({ value, options, onChange, accent, layout, reducedMotion, label }: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
  accent: string;
  layout: Layout;
  reducedMotion: boolean;
  label?: string;
}) {
  const { surface, hair2, ink, type, shadow } = useUi();
  const [width, setWidth] = useState(0);
  const inset = layout.fs(4);
  const itemWidth = Math.max(0, (width - 2 - inset * 2) / Math.max(1, options.length));
  const target = Math.max(0, options.findIndex((option) => option.key === value)) * itemWidth;
  const position = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    const animation = Animated.timing(position, { toValue: target, duration: reducedMotion ? 0 : 260,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [position, target, reducedMotion]);
  return <View role="radiogroup" accessibilityLabel={label} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    style={{ flexDirection: 'row', padding: inset, borderRadius: radius.sm, backgroundColor: surface.el, borderWidth: 1, borderColor: hair2 }}>
    {itemWidth > 0 ? <Animated.View style={{ position: 'absolute', top: inset, bottom: inset, left: inset,
      width: itemWidth, borderRadius: radius.xs, backgroundColor: accent, transform: [{ translateX: position }], ...shadow.card }} /> : null}
    {options.map((option) => <Tap key={option.key} role="radio" selected={value === option.key} label={option.label}
      onPress={() => onChange(option.key)} reducedMotion={reducedMotion}
      style={{ flex: 1, minHeight: layout.touch, justifyContent: 'center', alignItems: 'center', borderRadius: radius.xs }}>
      <Text style={[type.body, { fontSize: layout.fs(14), fontWeight: '600', color: value === option.key ? contrastOn(accent) : ink.dim }]}>{option.label}</Text>
    </Tap>)}
  </View>;
}
