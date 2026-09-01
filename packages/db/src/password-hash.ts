import * as argon2 from 'argon2';
import { PASSWORD_ARGON2_COST } from '@sm/contracts';

/** Tous les scripts DB passent ici : aucun défaut de version implicite. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    ...PASSWORD_ARGON2_COST,
  });
}
