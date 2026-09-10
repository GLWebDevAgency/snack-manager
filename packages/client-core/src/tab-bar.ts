/** Géométrie et mouvement partagés web / React Native, sans DOM ni runtime React. */
export const SM_TAB_BAR = {
  expandedVisual: 50, collapsedVisual: 35, touch: 44, rhythm: 4, border: 1,
  margin: 12, collapseInset: 34, bottom: 12, safeAreaCrop: 16, topGuard: 24,
  deadZone: 3, scrubThreshold: 6, cancelVertical: 14, icon: 24,
  collapseMs: 380, highlightMs: 420, fadeOutMs: 90, fadeInMs: 180,
  blurHeights: [100, 88, 76, 64, 54, 44, 36, 28, 22, 16],
} as const;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function minimizeFromScroll(y: number, previousY: number, maxY: number, current: 0 | 1) {
  const position = clamp(y, 0, Math.max(0, maxY));
  const delta = position - clamp(previousY, 0, Math.max(0, maxY));
  const target: 0 | 1 = position < SM_TAB_BAR.topGuard ? 0
    : delta > SM_TAB_BAR.deadZone ? 1 : delta < -SM_TAB_BAR.deadZone ? 0 : current;
  return { position, target };
}

export function tabIndexAt(clientX: number, left: number, width: number, count: number) {
  const inset = SM_TAB_BAR.border + SM_TAB_BAR.rhythm;
  const itemWidth = (width - inset * 2) / count;
  if (!(itemWidth > 0) || count < 1) return null;
  return clamp((clientX - left - inset) / itemWidth - 0.5, 0, count - 1);
}

/** Inversion de l'abscisse du Bézier : temps CSS identique, progression unique. */
export function tabBarEase(time: number, highlight = false) {
  const x1 = highlight ? 0.34 : 0.2, y1 = highlight ? 1.3 : 0.8;
  const x2 = highlight ? 0.5 : 0.2;
  const curve = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  if (time <= 0 || time >= 1) return clamp(time, 0, 1);
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 18; iteration++) {
    const middle = (low + high) / 2;
    if (curve(middle, x1, x2) < time) low = middle; else high = middle;
  }
  return curve((low + high) / 2, y1, 1);
}
