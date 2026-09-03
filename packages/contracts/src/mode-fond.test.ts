import { describe, expect, it } from 'vitest';
import {
  BrandSchema,
  BrandStrictSchema,
  DIRECTIONS,
  lireMarque,
  marqueDeRepli,
  modePourFond,
  type Brand,
} from './marque';

/** Le masque du pilote au 3 septembre 2026 : mode sombre, fond crème. */
const INCOHERENT = (): Brand => ({
  ...marqueDeRepli(null, null),
  mode: 'dark',
  palette: {
    ground: '#ede5d3',
    surface: '#fffdf8',
    ink: '#1f1a17',
    accent: '#c8281e',
    onAccent: '#fff8f0',
  },
});

describe('le mode qu’un fond exige', () => {
  it('suit la règle qui décide déjà de l’encre posable, sans seuil nouveau', () => {
    expect(modePourFond('#ffffff')).toBe('light');
    expect(modePourFond('#000000')).toBe('dark');
    expect(modePourFond('#ede5d3')).toBe('light'); // le crème du pilote
    expect(modePourFond('#14151a')).toBe('dark'); // le fond de Nuit
  });

  it('les six directions livrées sont toutes cohérentes', () => {
    /*
     * Si l'une ne l'était pas, la garde d'écriture rendrait cette direction
     * impossible à enregistrer — on aurait livré un préréglage inapplicable.
     */
    for (const cle of Object.keys(DIRECTIONS) as Array<keyof typeof DIRECTIONS>) {
      const d = DIRECTIONS[cle] as Brand;
      expect(modePourFond(d.palette.ground), cle).toBe(d.mode);
    }
  });
});

describe('la garde ne vaut QUE pour l’écriture', () => {
  it('l’écriture refuse un mode qui contredit le fond, et dit quoi faire', () => {
    const r = BrandStrictSchema.safeParse(INCOHERENT());
    expect(r.success).toBe(false);
    if (r.success) return;
    const souci = r.error.issues.find((i) => i.path.join('.') === 'mode');
    expect(souci, 'le refus doit porter sur le champ mode').toBeDefined();
    expect(souci!.message).toContain('light');
  });

  it('l’écriture accepte le même masque une fois le mode corrigé', () => {
    expect(BrandStrictSchema.safeParse({ ...INCOHERENT(), mode: 'light' }).success).toBe(true);
  });

  it('LA LECTURE, ELLE, ACCEPTE L’EXISTANT — sinon une identité disparaîtrait', () => {
    /*
     * C'est le cœur de la garde, et le test qui compte le plus.
     *
     * `lireMarque` valide le masque STOCKÉ avec `BrandSchema` et retombe sur la
     * direction Nuit quand il échoue. Si la règle du mode remontait sur ce
     * schéma, tout restaurant portant déjà la combinaison verrait son identité
     * entière disparaître au premier déploiement — silencieusement, sur toutes
     * ses surfaces. Le pilote la portait.
     */
    expect(BrandSchema.safeParse(INCOHERENT()).success).toBe(true);
    const lu = lireMarque({ brand: INCOHERENT() });
    expect(lu.repli, 'un masque incohérent ne doit PAS être traité en repli').toBeNull();
    expect(lu.brand.palette.ground).toBe('#ede5d3');
    expect(lu.brand.mode).toBe('dark');
  });
});
