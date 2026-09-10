import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 1280, height: 800 }) }));
import { computeLayout, scaledStyles } from './useLayout';

describe('géométrie KDS conservée et surfaces compactes', () => {
  it('conserve les ancrages de la tablette 10 pouces', () => {
    const layout = computeLayout(1280, 800, true);
    expect({ scale: layout.scale, allDayW: layout.allDayW, colW: layout.colW }).toEqual({ scale: 1, allDayW: 224, colW: 331 });
    expect(layout.actionH).toBe(56);
  });
  it('conserve la lecture distante sur le mural 24 pouces', () => {
    const layout = computeLayout(1920, 1080, true);
    expect(layout.scale).toBe(1.28);
    expect(layout.allDayW).toBe(336);
    expect(layout.far(32)).toBe(44);
    expect(layout.far(22)).toBe(30.5);
  });
  it.each([[320, 568], [390, 844], [820, 1180], [900, 800], [1024, 768], [1280, 800], [1920, 1080], [2000, 1200], [2560, 1440]])('garde les cibles et le clavier dans %ix%i', (width, height) => {
    const layout = computeLayout(width, height, true);
    expect(layout.compact).toBe(width < 900);
    expect(layout.touch).toBeGreaterThanOrEqual(44);
    expect(layout.actionH).toBeGreaterThanOrEqual(56);
    expect(layout.pinKeyH).toBeGreaterThanOrEqual(44);
    expect(layout.pinKeyW * 3 + layout.fs(10) * 2).toBeLessThanOrEqual(width - 32);
    expect(layout.modalW).toBeLessThanOrEqual(width - 32);
    expect(layout.pairingWidth).toBeLessThanOrEqual(width - 32);
    expect(layout.pairingCols * layout.pairingKey + (layout.pairingCols - 1) * layout.fs(10) + 42).toBeLessThanOrEqual(layout.pairingWidth);
  });
  it('ne réutilise pas un clavier trop large à échelle identique', () => {
    const styles = scaledStyles((layout, theme, density) => ({ key: layout.pinKeyW, theme, density }));
    const wide = computeLayout(390, 844);
    const narrow = computeLayout(320, 568);
    expect(wide.scale).toBe(narrow.scale);
    expect(styles(wide).key).not.toBe(styles(narrow).key);
    expect(styles(narrow, 'light', 'dense')).toEqual({ key: narrow.pinKeyW, theme: 'light', density: 'dense' });
    expect(styles(narrow, 'dark').theme).toBe('dark');
  });
});
