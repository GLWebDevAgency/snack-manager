import * as argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH } from './auth.service';

describe('empreinte factice du login', () => {
  it('est une empreinte Argon2id valide avec la politique explicite du projet', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    await expect(argon2.verify(DUMMY_PASSWORD_HASH, 'mot-de-passe-test')).resolves.toBe(false);
  });
});
