import { describe, expect, it } from 'vitest';
import { PASSWORD_ARGON2_COST } from './security';

describe('politique de hachage des mots de passe', () => {
  it('reste explicite et assez coûteuse pour toutes les surfaces de création', () => {
    expect(PASSWORD_ARGON2_COST).toEqual({
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
    });
  });
});
