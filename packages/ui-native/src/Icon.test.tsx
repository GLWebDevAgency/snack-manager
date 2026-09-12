import { describe, expect, it, vi } from 'vitest';
import { iconNames, renderIcon, legacyIconAliases } from '@sm/design-icons';
import { Icon } from './Icon';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('react-native-svg', () => ({ default: 'svg', Path: 'path', SvgXml: 'svg-xml' }));

describe('adaptateur natif des icônes du kit', () => {
  it('transmet les 78 vecteurs et chaque alias fourni au parseur SVG natif', () => {
    for (const name of iconNames) expect(Icon({ name })?.props.xml).toBe(renderIcon(name));
    for (const [name, target] of Object.entries(legacyIconAliases)) {
      expect(Icon({ name })?.props.xml).toBe(renderIcon(target));
    }
  });

  it.each(['web', 'ios', 'android'])('préserve couleur, taille, trait, style et décoration sur %s', os => {
    platform.OS = os;
    const style = { marginRight: 8 };
    const rendered = Icon({ name: 'gear', size: 28, strokeWidth: 2.4, color: '#123456', style });
    expect(rendered?.props).toMatchObject({ width: 28, height: 28, strokeWidth: 2.4, color: '#123456', style });
    if (os === 'web') expect(rendered?.props['aria-hidden']).toBe(true);
    else expect(rendered?.props.accessible).toBe(false);
  });

  it('garde une corbeille absente du kit mais ne transforme pas une clé inconnue en étoile', () => {
    expect(Icon({ name: 'trash' })?.props.children.props.d).toContain('M5 7h14');
    expect(Icon({ name: 'clé-inconnue' })).toBeNull();
    expect(Icon({ name: 'toString' })).toBeNull();
  });
});
