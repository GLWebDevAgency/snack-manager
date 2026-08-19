import { describe, expect, it } from 'vitest';
import { PAIRING_CODE_LENGTH, isPairingCodeShape } from '@sm/contracts';
import { generateDeviceToken, generatePairingCode, normalizePairingCode } from './pairing-code';

/** Caractères bannis : lus de travers sur un téléviseur, à trois mètres. */
const AMBIGUOUS = ['I', 'O', '0', '1'];

describe("Code d'appairage", () => {
  it('ne contient jamais I, O, 0 ni 1', () => {
    // Tirage massif : un biais d'un caractère sur mille se verrait ici, et
    // coûterait un appel au support à chaque installation.
    for (let i = 0; i < 5_000; i++) {
      const code = generatePairingCode();
      for (const banned of AMBIGUOUS) {
        expect(code, `code ${code}`).not.toContain(banned);
      }
    }
  });

  it('fait toujours six caractères et passe le contrôle de forme', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      expect(isPairingCodeShape(code)).toBe(true);
    }
  });

  it("couvre tout l'alphabet sans en favoriser un caractère", () => {
    // 32 symboles pour 256 valeurs d'octet : le modulo tombe juste. Un alphabet
    // de taille quelconque produirait des caractères deux fois plus fréquents.
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      for (const char of generatePairingCode()) seen.add(char);
    }
    expect(seen.size).toBe(32);
  });

  it('accepte la recopie humaine : minuscules, espaces, tirets', () => {
    expect(normalizePairingCode(' 4kp-7rm ')).toBe('4KP7RM');
  });

  it('rejette une forme qui n’est pas un code (saisie approximative)', () => {
    expect(isPairingCodeShape('4KP7R')).toBe(false); // trop court
    expect(isPairingCodeShape('4KP7RMX')).toBe(false); // trop long
    expect(isPairingCodeShape('4KP7R0')).toBe(false); // zéro : hors alphabet
    expect(isPairingCodeShape('4KP7RI')).toBe(false); // I : hors alphabet
  });
});

describe("Jeton d'appareil", () => {
  it('est long, url-safe, et jamais deux fois le même', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      const token = generateDeviceToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(1_000);
  });
});
