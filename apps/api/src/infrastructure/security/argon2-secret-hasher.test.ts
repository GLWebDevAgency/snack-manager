import { describe, expect, it } from 'vitest';

import { Argon2SecretHasher } from './argon2-secret-hasher';

/**
 * Le domaine sait qu'une remise exige un PIN vérifié ; c'est ici qu'on vérifie
 * que « vérifié » veut bien dire quelque chose. Un PIN d'équipe fait quatre
 * chiffres : la seule défense sérieuse est le coût du hachage.
 */
describe('Argon2SecretHasher', () => {
  const hasher = new Argon2SecretHasher();

  it('reconnaît le PIN du responsable et refuse celui d’à côté', async () => {
    const hash = await hasher.hash('4712');

    expect(await hasher.verify('4712', hash)).toBe(true);
    expect(await hasher.verify('4713', hash)).toBe(false);
  });

  it('produit deux empreintes différentes pour le même PIN', async () => {
    // Deux équipiers peuvent avoir le même code. Sans sel, la base révélerait
    // lesquels — et un seul code cassé les ouvrirait tous.
    const first = await hasher.hash('1234');
    const second = await hasher.hash('1234');

    expect(first).not.toBe(second);
    expect(await hasher.verify('1234', second)).toBe(true);
  });

  it('refuse l’accès sans lever quand l’empreinte est illisible', async () => {
    // Fiche importée d'un ancien système, colonne tronquée : en plein coup de
    // feu, une exception ferait tomber la connexion entière de la caisse.
    expect(await hasher.verify('4712', 'pas-une-empreinte-argon2')).toBe(false);
    expect(await hasher.verify('4712', '')).toBe(false);
  });

  it('inscrit ses paramètres dans l’empreinte pour survivre à une montée de version', async () => {
    const hash = await hasher.hash('4712');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
  });
});
