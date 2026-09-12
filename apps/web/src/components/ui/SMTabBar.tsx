'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clamp, SM_TAB_BAR, tabIndexAt } from './SMTabBar.model';
import { scrollSMTabToTop, useSMAnimatedValue, useSMMinimize, useSMReducedMotion, type SMTabScrollRef } from './SMTabBar.hooks';
import styles from './SMTabBar.module.css';

export { useSMTabTransition } from './SMTabBar.hooks';
export { SM_TAB_BAR } from './SMTabBar.model';
export type { SMTabScrollRef } from './SMTabBar.hooks';

export interface SMTabItem<Key extends string = string> {
  key: Key;
  label: string;
  icon: (color: string) => ReactNode;
  badge?: number | null;
  panelId?: string;
}
export interface SMTabBarProps<Key extends string = string> {
  items: readonly SMTabItem<Key>[];
  activeKey: Key;
  onSelect: (key: Key) => void;
  scrollRef?: SMTabScrollRef;
  theme?: 'dark' | 'light';
  minimizable?: boolean;
  reduceMotion?: boolean;
  reduceTransparency?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  onTick?: () => void;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}
type Vars = CSSProperties & Record<`--${string}`, string | number>;
type Gesture = { id: number; x: number; y: number; dragging: boolean };

/** Chrome partagé : aucune route, aucun panier et aucun état métier interne. */
export function SMTabBar<Key extends string>({ items, activeKey, onSelect, scrollRef, theme = 'dark', minimizable = true,
  hidden = false, disabled = false, reduceMotion = false, reduceTransparency = false, onTick, ariaLabel = 'Navigation principale', className, style }: SMTabBarProps<Key>) {
  const activeIndex = Math.max(0, items.findIndex(item => item.key === activeKey));
  const badgeId = useId();
  const systemReducedMotion = useSMReducedMotion();
  const reducedMotion = reduceMotion || systemReducedMotion;
  const { target, expand } = useSMMinimize(scrollRef, minimizable && !hidden, activeKey);
  const progress = useSMAnimatedValue(target, SM_TAB_BAR.collapseMs, reducedMotion);
  const [slideTarget, setSlideTarget] = useState(activeIndex);
  const [dragging, setDragging] = useState(false);
  const slide = useSMAnimatedValue(slideTarget, SM_TAB_BAR.highlightMs, dragging || reducedMotion, true);
  const pill = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const lastTick = useRef(activeIndex);
  const suppressClick = useRef(false);

  useEffect(() => { if (!gesture.current?.dragging) setSlideTarget(activeIndex); lastTick.current = activeIndex; }, [activeIndex]);
  useEffect(() => {
    if (!hidden && !disabled) return;
    const current = gesture.current;
    gesture.current = null;
    // Annule le geste natif lorsque l'application ouvre un tunnel inert.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDragging(false); setSlideTarget(activeIndex);
    if (current && pill.current?.hasPointerCapture(current.id)) pill.current.releasePointerCapture(current.id);
  }, [hidden, disabled, activeIndex]);

  const suppressPointerClick = () => {
    suppressClick.current = true;
  };
  const indexAt = (x: number) => {
    const bounds = pill.current?.getBoundingClientRect();
    return bounds ? tabIndexAt(x, bounds.left, bounds.width, items.length) : null;
  };
  const select = (index: number, focus = false) => {
    if (hidden || disabled || !items[index]) return;
    expand(); setSlideTarget(index); lastTick.current = index;
    if (focus) buttons.current[index]?.focus({ preventScroll: true });
    if (items[index].key === activeKey) scrollSMTabToTop(scrollRef, reducedMotion);
    onSelect(items[index].key);
  };
  const cancel = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.dragging) suppressPointerClick();
    setDragging(false); setSlideTarget(activeIndex);
    if (current && pill.current?.hasPointerCapture(current.id)) pill.current.releasePointerCapture(current.id);
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (hidden || disabled || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    lastTick.current = activeIndex;
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (hidden || disabled || !current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.abs(dy) > SM_TAB_BAR.cancelVertical) { suppressPointerClick(); cancel(); return; }
    if (!current.dragging) {
      if (Math.abs(dx) <= SM_TAB_BAR.scrubThreshold) return;
      current.dragging = true; setDragging(true); expand();
      pill.current?.setPointerCapture(event.pointerId);
    }
    const index = indexAt(event.clientX);
    if (index === null) return;
    setSlideTarget(index);
    const rounded = Math.round(index);
    if (rounded !== lastTick.current) {
      lastTick.current = rounded; onTick?.();
      try { navigator.vibrate?.(6); } catch { /* La vibration est facultative selon le navigateur. */ }
    }
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (current.dragging) {
      suppressPointerClick(); setDragging(false);
      select(Math.round(indexAt(event.clientX) ?? activeIndex), true);
    }
    if (pill.current?.hasPointerCapture(event.pointerId)) pill.current.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled || hidden) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
      return;
    }
    const movement = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!movement && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    select(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + movement + items.length) % items.length, true);
  };

  if (items.length < 2 || items.length > 5) return null;
  return <nav className={[styles.root, theme === 'light' ? styles.light : '', hidden ? styles.hidden : '', className ?? ''].join(' ')}
    aria-label={ariaLabel} aria-hidden={hidden || undefined} inert={hidden}
    data-sm-reduce-motion={reducedMotion || undefined} data-sm-reduce-transparency={reduceTransparency || undefined}
    data-sm-tabbar="" data-sm-tabbar-minimized={target === 1 ? 'true' : 'false'} data-sm-tabbar-dragging={dragging ? 'true' : 'false'}
    style={{ ...style, '--sm-p': progress, '--sm-n': items.length, '--sm-slide': slide } as Vars}>
    <div className={styles.falloff} aria-hidden="true">
      {SM_TAB_BAR.blurHeights.map((height, index) => <i key={height} style={{ height: `${height}%`, '--sm-blur': `${(index + 1) * 0.5}px` } as Vars} />)}
      <span className={styles.veil} />
    </div>
    <div className={styles.wrap}>
      <div ref={pill} className={styles.capsule} role="tablist" aria-label={ariaLabel} aria-disabled={disabled || undefined}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel}
        onLostPointerCapture={() => { if (gesture.current) cancel(); }}
        onPointerLeave={() => { if (gesture.current && !gesture.current.dragging) gesture.current = null; }}
        onFocusCapture={() => { if (!disabled) expand(); }} onClickCapture={event => {
          if (disabled) { event.preventDefault(); event.stopPropagation(); return; }
          if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
        }}>
        <div className={styles.travel} aria-hidden="true"><div className={styles.box} /></div>
        <div className={styles.row}>{items.map((item, index) => {
          const intensity = 1 - clamp(Math.abs(slide - index), 0, 1);
          const badge = typeof item.badge === 'number' && Number.isFinite(item.badge) && item.badge >= 1 ? Math.floor(item.badge) : null;
          return <button key={item.key} ref={node => { buttons.current[index] = node; }} type="button" role="tab"
            aria-selected={index === activeIndex} aria-label={item.label} aria-controls={item.panelId}
            aria-disabled={disabled || undefined}
            aria-describedby={badge !== null ? `${badgeId}-${index}` : undefined}
            tabIndex={index === activeIndex && !hidden ? 0 : -1}
            className={styles.tab} style={{ '--sm-intensity': intensity } as Vars}
            onClick={() => select(index)} onKeyDown={event => onKeyDown(event, index)}>
            <span className={styles.glyph} aria-hidden="true">
              <span className={styles.off}>{item.icon('currentColor')}</span>
              <span className={styles.on}>{item.icon('currentColor')}</span>
            </span>
            <span className={styles.label}>{item.label}</span>
            {badge !== null ? <span className={styles.badge} aria-hidden="true">{badge > 99 ? '99+' : badge}</span> : null}
            {badge !== null ? <span id={`${badgeId}-${index}`} className={styles.srOnly}>{badge} notification{badge > 1 ? 's' : ''}</span> : null}
          </button>;
        })}</div>
      </div>
    </div>
  </nav>;
}

export function SMTabBarSpacer({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`${styles.spacer} ${className}`} />;
}
