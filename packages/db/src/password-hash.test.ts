import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { hashPassword } from './password-hash';

describe('hashPassword', () => {
  it('inscrit la politique partagée dans chaque empreinte utilisateur', async () => {
    const hash = await hashPassword('mot-de-passe-de-test');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    await expect(argon2.verify(hash, 'mot-de-passe-de-test')).resolves.toBe(true);
  });
});
