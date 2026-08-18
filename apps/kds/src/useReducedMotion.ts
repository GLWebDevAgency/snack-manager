import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * `prefers-reduced-motion` du système (media query en web, réglage
 * d'accessibilité en natif). Les animations d'ambiance — pulsation d'une
 * carte neuve, halo d'une carte en retard — s'arrêtent quand il est actif ;
 * l'information reste portée par la couleur et la bordure, jamais par le
 * mouvement seul.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    }) as { remove?: () => void } | undefined;
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
