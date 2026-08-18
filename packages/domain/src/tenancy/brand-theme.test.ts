import { describe, expect, it } from 'vitest';
import { unwrap } from '../shared/result';
import {
  BrandTheme,
  FUNCTIONAL_COLORS,
  HexColor,
  type CustomizableToken,
} from './brand-theme';

const accent = (hex: string): HexColor => unwrap(HexColor.create(hex));

describe('BrandTheme', () => {
  const classFood = unwrap(BrandTheme.create({ name: "Class'Food", accent: accent('#C8281E') }));

  it('applique la couleur d’accent du restaurant', () => {
    const rebranded = unwrap(classFood.customize({ accent: accent('#2F9E62') }));
    expect(rebranded.accent.value).toBe('#2f9e62');
    expect(rebranded.name).toBe("Class'Food");
  });

  it('refuse de repeindre le vert « prêt » aux couleurs du restaurant', () => {
    // Règle produit : une équipe formée chez un client doit savoir lire l'écran
    // cuisine du client suivant. Le typage l'interdit déjà côté back-office ;
    // ce contrôle couvre l'autre porte d'entrée, un JSON d'API non typé.
    const payload = { ready: accent('#C8281E') } as unknown as Partial<
      Record<CustomizableToken, HexColor>
    >;
    const refused = classFood.customize(payload);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('brand.locked');
      expect(refused.error.message).toContain('Prêt');
    }
  });

  it('livre les couleurs fonctionnelles standard quel que soit le tenant', () => {
    const greenHouse = unwrap(
      BrandTheme.create({ name: 'Green House', accent: accent('#2F9E62') }),
    );
    for (const theme of [classFood, greenHouse]) {
      expect(theme.tokens().ready.value).toBe(FUNCTIONAL_COLORS.ready.value);
      expect(theme.tokens().alert.value).toBe(FUNCTIONAL_COLORS.alert.value);
      expect(theme.tokens().preparing.value).toBe(FUNCTIONAL_COLORS.preparing.value);
    }
    expect(classFood.tokens().accent.value).toBe('#c8281e');
    expect(greenHouse.tokens().accent.value).toBe('#2f9e62');
  });

  it('bascule le texte en noir sur un accent trop clair', () => {
    // Le jaune d'une sandwicherie rendrait illisible un « Commander » blanc.
    const pale = unwrap(BrandTheme.create({ name: 'Le Jaune', accent: accent('#f5e050') }));
    expect(pale.onAccent().value).toBe('#000000');
    expect(classFood.onAccent().value).toBe('#ffffff');
  });

  it('affiche l’initiale du restaurant tant qu’aucun logo n’est chargé', () => {
    expect(classFood.logoUrl).toBe(null);
    expect(classFood.initial()).toBe('C');
    expect(classFood.withLogo('https://cdn.example/classfood.svg').logoUrl).toBe(
      'https://cdn.example/classfood.svg',
    );
  });

  it('refuse un restaurant sans nom', () => {
    const nameless = BrandTheme.create({ name: '   ', accent: accent('#C8281E') });
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.error.code).toBe('restaurant.invalid');
  });
});

describe('HexColor', () => {
  it('accepte l’écriture courte des chartes graphiques', () => {
    expect(unwrap(HexColor.create('#abc')).value).toBe('#aabbcc');
    expect(unwrap(HexColor.create('C8281E')).value).toBe('#c8281e');
  });

  it('refuse ce qui n’est pas une couleur', () => {
    const refused = HexColor.create('rouge vif');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('brand.color');
      expect(refused.error.message).toContain('#C8281E');
    }
  });
});
