import { randomBytes } from 'node:crypto';
import {
  DEVICE_TOKEN_BYTES,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  isPairingCodeShape,
} from '@sm/contracts';

/**
 * Les deux secrets du Menu Board.
 *
 * Le CODE D'APPAIRAGE est lu à l'œil nu sur un téléviseur, à trois mètres, puis
 * recopié sur un téléphone : il est court et volontairement pauvre en symboles.
 * Le JETON D'APPAREIL, lui, n'est jamais lu par un humain — il vaut mot de
 * passe pour un écran qui n'a pas de compte, donc il est long et tiré au sort.
 *
 * Les deux passent par `node:crypto`. `Math.random()` est prévisible : un code
 * d'appairage devinable laisserait un tiers appairer son propre écran sur la
 * carte du restaurant.
 */

/** Source d'aléa injectable — les tests peuvent la figer sans toucher au global. */
export type RandomBytes = (size: number) => Buffer;

/**
 * Code à six caractères non ambigus.
 *
 * L'alphabet compte exactement 32 symboles, et 256 est un multiple de 32 : le
 * modulo ne favorise donc aucun caractère. Avec un alphabet de taille
 * quelconque il faudrait rejeter les octets en surplus, sous peine de biais.
 */
export function generatePairingCode(random: RandomBytes = randomBytes): string {
  const bytes = random(PAIRING_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[(bytes[i] ?? 0) % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

/** Jeton d'appareil : 32 octets → 43 caractères base64url, sans remplissage. */
export function generateDeviceToken(random: RandomBytes = randomBytes): string {
  return random(DEVICE_TOKEN_BYTES).toString('base64url');
}

/**
 * Nettoie une saisie humaine : espaces de recopie, minuscules du clavier
 * mobile, tirets ajoutés spontanément (« 4KP-7RM »).
 */
export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export { isPairingCodeShape };
