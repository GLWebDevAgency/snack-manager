import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, LAITON, contraste } from '@sm/contracts';
import { classerMasque, filtreReparation, filtreReprise } from './backfill-brand';
import { MODELS } from './schemas';

const Tenant =
  mongoose.models[MODELS.Tenant.name] ??
  mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

describe('la classification du masque stocké', () => {
  it('un tenant sans brand est À REPRENDRE, avec son accent et son logo', () => {
    const c = classerMasque({ brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png' });
    expect(c.etat).toBe('a-reprendre');
    if (c.etat !== 'a-reprendre') return;
    expect(c.brand.preset).toBe('nuit');
    expect(c.brand.palette.accent).toBe('#2e9e4f');
    expect(c.brand.logo.mark.dark).toBe('https://r2/l.png');
    expect(contraste(c.brand).ok).toBe(true);
  });

  /** L'IDEMPOTENCE : un masque déjà posé et VALIDE n'est jamais recalculé. */
  it('un masque conforme au contrat est valide — donc hors du lot', () => {
    expect(classerMasque({ brand: DIRECTIONS.soleil, brandColor: '#000000' })).toEqual({
      etat: 'valide',
    });
  });

  it('un accent absent ou invalide retombe sur le laiton', () => {
    const accent = (t: Parameters<typeof classerMasque>[0]) => {
      const c = classerMasque(t);
      return c.etat === 'a-reprendre' ? c.brand.palette.accent : null;
    };
    expect(accent({})).toBe(LAITON);
    expect(accent({ brandColor: 'bleu' })).toBe(LAITON);
  });

  /**
   * LE DÉFAUT QUE CE MODULE EXISTE POUR MONTRER.
   *
   * Un `brand` non nul était tenu pour « déjà repris » : ces trois tenants-là
   * n'étaient ni listés ni réparés, et tombaient en repli Nuit à chaque
   * lecture pendant que le compte rendu annonçait un parc à jour.
   */
  describe('un masque stocké qui ne satisfait plus le contrat est INVALIDE, pas « déjà repris »', () => {
    const chemins = (brand: unknown): string[] => {
      const c = classerMasque({ brand });
      return c.etat === 'invalide' ? c.chemins : [];
    };

    it('une valeur hors enum est nommée par son chemin', () => {
      expect(chemins({ ...DIRECTIONS.nuit, shape: 'carre' })).toEqual(['shape']);
    });

    it('un masque partiel nomme la clé manquante', () => {
      const { palette: _absente, ...partiel } = DIRECTIONS.nuit;
      expect(chemins(partiel)).toEqual(['palette']);
    });

    it('une clé inconnue ne rend PAS le masque invalide — la lecture l’ignore', () => {
      // Le schéma de lecture est un objet nu : un champ additif (version
      // suivante, script d'exploitation) ne fait plus basculer le restaurant
      // sur Nuit, donc il n'a rien à faire dans le lot des masques à réparer —
      // `--reparer` aurait remplacé une identité valide par le repli.
      expect(chemins({ ...DIRECTIONS.nuit, couleur: '#fff' })).toEqual([]);
    });

    it('un rôle de couleur illisible est nommé jusqu’à la feuille', () => {
      expect(
        chemins({ ...DIRECTIONS.nuit, palette: { ...DIRECTIONS.nuit.palette, accent: 'bleu' } }),
      ).toEqual(['palette.accent']);
    });
  });

  /**
   * On classe ce que l'API LIT : un sous-document hydraté porte des clés de
   * prototype que le schéma strict refuse, d'où la même normalisation que
   * `marqueEffective` — sans elle, tout tenant repris ressortait « invalide ».
   */
  it('juge un sous-document HYDRATÉ comme son équivalent nu', () => {
    const doc = Tenant.hydrate({ slug: 'x', name: 'X', brand: DIRECTIONS.marche });
    expect(classerMasque(doc as unknown as { brand?: unknown })).toEqual({ etat: 'valide' });
  });
});

describe('le filtre porté par chaque écriture', () => {
  /**
   * L'écriture ne s'applique que si le tenant n'a pas bougé depuis la lecture :
   * sans cet invariant, un accent changé entre les deux était écrasé par un
   * repli déjà périmé.
   */
  it('une reprise exige le masque encore absent ET les deux sources inchangées', () => {
    expect(filtreReprise({ _id: 'a', brandColor: '#2e9e4f', logoUrl: 'https://r2/l.png' })).toEqual({
      _id: 'a',
      brand: null,
      brandColor: '#2e9e4f',
      logoUrl: 'https://r2/l.png',
    });
  });

  /** `null` apparie aussi la clé absente ; `undefined` n'est pas une valeur BSON. */
  it('une clé absente à la lecture se filtre par null', () => {
    expect(filtreReprise({ _id: 'a' })).toEqual({
      _id: 'a',
      brand: null,
      brandColor: null,
      logoUrl: null,
    });
  });

  it('une réparation exige l’horodatage inchangé — rien n’a bougé depuis la lecture', () => {
    const le = new Date('2026-09-01T10:00:00.000Z');
    expect(filtreReparation({ _id: 'a', updatedAt: le })).toEqual({ _id: 'a', updatedAt: le });
    expect(filtreReparation({ _id: 'a' })).toEqual({ _id: 'a', updatedAt: null });
  });
});
