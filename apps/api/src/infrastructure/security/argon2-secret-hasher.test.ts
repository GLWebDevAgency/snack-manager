import { describe, expect, it } from 'vitest';

import { Argon2SecretHasher } from './argon2-secret-hasher';

/**
 * Le CRM crée ici le mot de passe du futur gérant. Il doit employer la même
 * politique que le seed, les outils d'administration et le hash factice.
 */
describe('Argon2SecretHasher', () => {
  const hasher = new Argon2SecretHasher();

  it('reconnaît le mot de passe et refuse celui d’à côté', async () => {
    const hash = await hasher.hash('4712');

    expect(await hasher.verify('4712', hash)).toBe(true);
    expect(await hasher.verify('4713', hash)).toBe(false);
  });

  it('produit deux empreintes différentes pour le même mot de passe', async () => {
    // Sans sel, deux comptes utilisant le même secret se reconnaîtraient en base.
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
    expect(hash).toContain('m=65536,t=3,p=4');
  });
});
