import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { BrandSchema, DIRECTIONS, PRESET_KEYS, marqueEffective } from '@sm/contracts';
import { classerMasque } from './backfill-brand';
import { BrandSub, MODELS } from './schemas';

/**
 * L'ACCORD ENTRE LE SOUS-SCHÉMA MONGOOSE ET LE CONTRAT.
 *
 * `BrandSub` et `BrandSchema` décrivent le MÊME objet dans deux langages : ce
 * que Mongoose accepte d'écrire, ce que zod accepte de relire. Rien dans le
 * compilateur ne les tient ensemble — un enum élargi d'un seul côté, une clé
 * ajoutée d'un seul côté, et la base stocke sereinement un masque que toute
 * lecture ramène au repli Nuit, sans une erreur nulle part.
 *
 * Ces tests sont ce lien. Ils travaillent sur un document HYDRATÉ, parce que
 * c'est ce que l'API lit vraiment : le sous-document porte alors des clés de
 * prototype que le schéma strict du contrat refusait — et tous les tenants
 * repris retombaient sur Nuit.
 */
const Tenant =
  mongoose.models[MODELS.Tenant.name] ??
  mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

/** Un tenant minimal : `slug` et `name` sont requis, tout le reste vient du masque. */
const avecMasque = (brand: unknown) => new Tenant({ slug: 'x', name: 'X', brand });

describe('le masque lu depuis un document Mongoose', () => {
  it('un tenant repris rend SON masque, pas le repli', () => {
    const doc = Tenant.hydrate({ slug: 'x', name: 'X', brandColor: '#2E9E4F', logoUrl: null, brand: DIRECTIONS.soleil });
    const b = marqueEffective(doc);
    expect(b.preset).toBe('soleil');
    // En minuscules : `HexSchema` normalise la casse au contrat, une seule fois.
    expect(b.palette.accent).toBe('#e07a1f');
  });

  it('un tenant sans masque rend le repli avec son accent', () => {
    const doc = Tenant.hydrate({ slug: 'y', name: 'Y', brandColor: '#2E9E4F', logoUrl: null, brand: null });
    const b = marqueEffective(doc);
    expect(b.preset).toBe('nuit');
    expect(b.palette.accent).toBe('#2e9e4f');
  });

  /**
   * Le SEUL adaptateur de lecture doit rendre la même chose des deux sources.
   * L'API lit tantôt un document hydraté, tantôt un `.lean()` ; si les deux
   * divergeaient, une surface porterait la marque et sa voisine le repli.
   */
  it('hydraté et `.lean()` rendent le même masque', () => {
    const stocke = { ...DIRECTIONS.marche, hero: 'https://r2/hero.jpg' };
    const hydrate = Tenant.hydrate({ slug: 'z', name: 'Z', brandColor: '#c9a15a', brand: stocke });
    expect(marqueEffective(hydrate)).toEqual(
      marqueEffective({ brand: stocke, brandColor: '#c9a15a', logoUrl: null }),
    );
  });

  /**
   * LA LIMITE EST LEVÉE — un masque stocké SANS `hero` se lit pareil des deux
   * côtés. Mongoose pose son défaut `hero: null` en hydratant, jamais sur un
   * `.lean()` qui rend le document brut : le même tenant rendait Soleil par
   * `findById()` et Nuit par `.lean()` (fiche CRM contre vitrine, deux
   * identités pour un seul restaurant). Le contrat tolère désormais l'absence
   * (`.default(null)`), et les deux lectures convergent.
   */
  it('un masque stocké sans `hero` se lit pareil hydraté et en lean', () => {
    const sansHero: Record<string, unknown> = { ...DIRECTIONS.soleil };
    delete sansHero.hero;
    const hydrate = Tenant.hydrate({ slug: 'h', name: 'H', brandColor: '#2E9E4F', brand: sansHero });
    expect(marqueEffective(hydrate).preset).toBe('soleil');
    expect(marqueEffective({ brand: sansHero, brandColor: '#2E9E4F' })).toEqual(
      marqueEffective(hydrate),
    );
  });
});

describe('ce que le sous-schéma `brand` accepte d’écrire', () => {
  /** Les six directions sont livrées comme des masques COMPLETS : elles doivent l'être. */
  it.each(PRESET_KEYS)('la direction %s passe la validation Mongoose', (cle) => {
    expect(avecMasque(DIRECTIONS[cle]).validateSync()).toBeUndefined();
  });

  /** Ce que la reprise ÉCRIT doit être stockable — sinon elle échoue en production. */
  it('le masque de repli calculé par la reprise passe la validation', () => {
    const verdict = classerMasque({ brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png' });
    expect(verdict.etat).toBe('a-reprendre');
    if (verdict.etat !== 'a-reprendre') return;
    expect(avecMasque(verdict.brand).validateSync()).toBeUndefined();
  });

  it('`preset: null` est accepté — un masque sur mesure ne descend d’aucune direction', () => {
    expect(avecMasque({ ...DIRECTIONS.nuit, preset: null }).validateSync()).toBeUndefined();
  });

  it('une valeur hors enum est refusée, au bon chemin', () => {
    const erreur = avecMasque({ ...DIRECTIONS.nuit, shape: 'carre' }).validateSync();
    expect(Object.keys(erreur?.errors ?? {})).toEqual(['brand.shape']);
  });

  /**
   * DÉFENSE EN PROFONDEUR : le contrat refuse déjà `bleu` et `javascript:` sur
   * les routes, mais `admin-cli` et un shell écrivent sans zod. Une couleur
   * illisible ou un `src` dangereux ne doit pas pouvoir entrer par là.
   */
  it('refuse une couleur illisible et une URL de logo non http(s)', () => {
    const erreur = avecMasque({
      ...DIRECTIONS.nuit,
      palette: { ...DIRECTIONS.nuit.palette, accent: 'bleu' },
      logo: { mark: { light: 'javascript:alert(1)', dark: null }, lockup: { light: null, dark: null } },
    }).validateSync();
    expect(Object.keys(erreur?.errors ?? {}).sort()).toEqual([
      'brand.logo.mark.light',
      'brand.palette.accent',
    ]);
  });

  /**
   * Le jeu de clés, tenu des deux côtés. C'est ce qui justifie l'export de
   * `BrandSub` : une clé ajoutée au contrat et oubliée ici serait ÉCARTÉE
   * silencieusement à l'écriture (Mongoose ignore l'inconnu), puis manquerait
   * à la relecture — donc repli Nuit, sans une erreur nulle part.
   */
  it('porte exactement les clés du contrat', () => {
    expect(Object.keys(BrandSub.paths).sort()).toEqual(Object.keys(BrandSchema.shape).sort());
  });
});
