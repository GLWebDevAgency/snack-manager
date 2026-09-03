import { describe, expect, it } from 'vitest';
import { AuthMeUpdateSchema, LeadConvertSchema } from './index';

/**
 * LE CORPS DE `PATCH /auth/me` — le seul chemin par lequel un nom de personne
 * s'écrit après la signature.
 *
 * Ces cas ne vérifient pas zod, ils verrouillent des DÉCISIONS : ce que la
 * route accepte d'écrire, ce qu'elle refuse de laisser entrer, et le fait que
 * sa borne est celle de la signature — la seule autre écriture de la même
 * colonne.
 */
describe('poser son propre nom', () => {
  it('accepte un nom et le rend détouré', () => {
    expect(AuthMeUpdateSchema.parse({ nom: '  Camille Fournier  ' })).toEqual({
      nom: 'Camille Fournier',
    });
  });

  it('refuse le vide — c’est l’état qu’on répare, pas un choix', () => {
    expect(AuthMeUpdateSchema.safeParse({ nom: '' }).success).toBe(false);
    expect(AuthMeUpdateSchema.safeParse({ nom: '   ' }).success).toBe(false);
  });

  it('n’accepte AUCUNE autre clé — surtout pas un sujet', () => {
    // Le sujet vient du jeton. Un `id`, un `role` ou un `email` toléré ici
    // ferait de cette route un renommage d'autrui, ou une élévation, avant
    // que la règle qui les garde n'existe.
    for (const intrus of [{ id: 'u2' }, { role: 'owner' }, { email: 'a@b.fr' }, { name: 'X' }]) {
      expect(AuthMeUpdateSchema.safeParse({ nom: 'Camille', ...intrus }).success).toBe(false);
    }
  });

  it('porte la MÊME borne que la signature, sur la même colonne', () => {
    // `LeadConvertSchema.ownerName` écrit `users.name` à la conversion. Deux
    // bornes différentes laisseraient le CRM poser un nom que son porteur ne
    // pourrait plus réenregistrer.
    const signature = (nom: string) =>
      LeadConvertSchema.safeParse({
        slug: 'le-comptoir',
        ownerEmail: 'patron@le-comptoir.fr',
        ownerName: nom,
        plan: 'essentiel',
      }).success;

    const juste = 'x'.repeat(120);
    const trop = 'x'.repeat(121);
    expect(AuthMeUpdateSchema.safeParse({ nom: juste }).success).toBe(true);
    expect(signature(juste)).toBe(true);
    expect(AuthMeUpdateSchema.safeParse({ nom: trop }).success).toBe(false);
    expect(signature(trop)).toBe(false);
  });
});
