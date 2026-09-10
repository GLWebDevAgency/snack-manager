'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { minimizeFromScroll, SM_TAB_BAR, tabBarEase } from './SMTabBar.model';
import styles from './SMTabBar.module.css';

export type SMTabScrollRef = RefObject<HTMLElement | null>;
const reducedQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (change: () => void) => {
  const media = window.matchMedia(reducedQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
};
const motionSnapshot = () => window.matchMedia(reducedQuery).matches;
const serverMotionSnapshot = () => true;
export function useSMReducedMotion() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotionSnapshot);
}

export function scrollSMTabToTop(scrollRef: SMTabScrollRef | undefined, reducedMotion: boolean) {
  const element = scrollRef?.current;
  const options: ScrollToOptions = { top: 0, behavior: reducedMotion ? 'instant' : 'smooth' };
  if (element && element !== document.body && element !== document.documentElement) element.scrollTo(options);
  else window.scrollTo(options);
}

/** Les changements de ref sont détectés après commit, même sans changer d'onglet. */
export function useSMMinimize(scrollRef: SMTabScrollRef | undefined, enabled: boolean, rearmKey: string) {
  const [target, setTarget] = useState<0 | 1>(0);
  const current = useRef<0 | 1>(0);
  const binding = useRef<{ element: HTMLElement | Window; enabled: boolean; key: string; cleanup: () => void } | null>(null);
  const expand = useCallback(() => { current.current = 0; setTarget(0); }, []);
  useEffect(() => {
    const node = scrollRef?.current;
    const element = node && node !== document.body && node !== document.documentElement ? node : window;
    const previous = binding.current;
    if (previous?.element === element && previous.enabled === enabled && previous.key === rearmKey) return;
    previous?.cleanup();
    expand();
    const read = () => {
      const scroll = element === window ? (document.scrollingElement ?? document.documentElement) : element as HTMLElement;
      return { y: scroll.scrollTop, max: Math.max(0, scroll.scrollHeight - scroll.clientHeight) };
    };
    let previousY = read().y;
    const onScroll = () => {
      const { y, max } = read();
      const next = minimizeFromScroll(y, previousY, max, current.current);
      previousY = next.position;
      if (next.target !== current.current) { current.current = next.target; setTarget(next.target); }
    };
    if (enabled) element.addEventListener('scroll', onScroll, { passive: true });
    binding.current = { element, enabled, key: rearmKey, cleanup: () => element.removeEventListener('scroll', onScroll) };
  });
  useEffect(() => () => { binding.current?.cleanup(); binding.current = null; }, []);
  return { target, expand };
}

export function useSMAnimatedValue(target: number, duration: number, immediate: boolean, highlight = false) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useLayoutEffect(() => {
    const from = current.current;
    if (immediate || Math.abs(target - from) < 0.00001) { current.current = target; setValue(target); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const time = Math.min(1, (now - start) / duration);
      const next = time === 1 ? target : from + (target - from) * tabBarEase(time, highlight);
      current.current = next; setValue(next);
      if (time < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, highlight, immediate, target]);
  return value;
}

/** À étaler sur le contenu seul, jamais sur un parent de la barre positionnée. */
export function useSMTabTransition<Key extends string>({ activeKey, onSelect, scrollRef }: {
  activeKey: Key;
  onSelect: (key: Key) => void;
  scrollRef?: SMTabScrollRef;
}) {
  const reducedMotion = useSMReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const latest = useRef({ activeKey, onSelect, scrollRef, reducedMotion });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousActiveKey = useRef(activeKey);
  useLayoutEffect(() => {
    if (previousActiveKey.current === activeKey) return;
    previousActiveKey.current = activeKey;
    if (timer.current !== null) {
      clearTimeout(timer.current); timer.current = null;
      // An external navigation supersedes the pending visual transition.
      setLeaving(false);
    }
    // The newly committed view starts at its first content, including browser Back/Forward.
    // Keep the live controller mounted; never animate through another screen’s old scroll position.
    scrollSMTabToTop(scrollRef, true);
    // Browser history may restore the document after layout effects. Settle it
    // before the next paint, without changing global history restoration policy.
    const frame = requestAnimationFrame(() => {
      const element = scrollRef?.current;
      const position = element && element !== document.body && element !== document.documentElement ? element.scrollTop : window.scrollY;
      if (position !== 0) scrollSMTabToTop(scrollRef, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey, scrollRef]);
  useLayoutEffect(() => { latest.current = { activeKey, onSelect, scrollRef, reducedMotion }; });
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const selectTab = useCallback((key: Key) => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const current = latest.current;
    if (key === current.activeKey) { setLeaving(false); scrollSMTabToTop(current.scrollRef, current.reducedMotion); return; }
    if (current.reducedMotion) { setLeaving(false); current.onSelect(key); return; }
    setLeaving(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current.onSelect(key);
      setLeaving(false);
    }, SM_TAB_BAR.fadeOutMs);
  }, []);
  return { selectTab, contentProps: { className: styles.screen, 'data-sm-tab-leaving': leaving ? 'true' : 'false' } };
}
