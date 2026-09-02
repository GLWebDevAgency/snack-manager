import { describe, expect, it, vi } from 'vitest';
import { CODE_RESTE_A_FAIRE, exigerZero, lireDrapeaux } from './backfill-flags';

/**
 * Le code de sortie est un CONTRAT avec `scripts/reprise-mongo.sh` : sa
 * relance de contrôle ne lit rien d'autre. Un 3 devenu 1 par mégarde rendrait
 * « il reste du travail » indiscernable d'un plantage, et le message que le
 * script affiche alors serait un mensonge.
 */
function codeRendu(reste: number, avecDrapeau: boolean): number | undefined {
  // `process.exitCode` est global au processus de test : on le rend tel qu'on
  // l'a trouvé, sinon exercer l'échec ferait sortir vitest en 3.
  const avant = process.exitCode;
  const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    process.exitCode = undefined;
    exigerZero({ appliquer: false, exigerZero: avecDrapeau }, reste, 'chose(s)');
    return process.exitCode;
  } finally {
    process.exitCode = avant;
    silence.mockRestore();
  }
}

describe('les drapeaux communs aux reprises', () => {
  it('lit --appliquer et --exiger-zero, indépendamment', () => {
    expect(lireDrapeaux([])).toEqual({ appliquer: false, exigerZero: false });
    expect(lireDrapeaux(['--appliquer'])).toEqual({ appliquer: true, exigerZero: false });
    expect(lireDrapeaux(['--exiger-zero', '--reparer'])).toEqual({
      appliquer: false,
      exigerZero: true,
    });
  });

  it('sort en 3 quand il reste du travail sous --exiger-zero', () => {
    expect(CODE_RESTE_A_FAIRE).toBe(3);
    expect(codeRendu(4, true)).toBe(CODE_RESTE_A_FAIRE);
  });

  it('ne dit rien quand il ne reste rien — la relance de contrôle passe', () => {
    expect(codeRendu(0, true)).toBeUndefined();
  });

  /** Sans le drapeau, une reprise AFFICHE son reste et sort en succès : c'est le mode de lecture. */
  it('reste muet sans le drapeau', () => {
    expect(codeRendu(4, false)).toBeUndefined();
  });
});
