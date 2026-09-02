import { describe, expect, it } from 'vitest';
import {
  loyaltyCardDeepLink,
  loyaltyTokenFromQrPayload,
} from './loyalty-public';

const TOKEN = 'A'.repeat(43);

describe('payload QR fidélité', () => {
  it('lit un jeton brut ou une deep-link dont le secret reste dans le fragment', () => {
    expect(loyaltyTokenFromQrPayload(TOKEN, 'classfood')).toBe(TOKEN);
    const link = loyaltyCardDeepLink('https://snackmanager.fr/', 'classfood', TOKEN);
    expect(link).toBe(
      `https://snackmanager.fr/r/classfood/fidelite#card=${TOKEN}`,
    );
    expect(new URL(link).search).toBe('');
    expect(loyaltyTokenFromQrPayload(link, 'classfood')).toBe(TOKEN);
  });

  it('refuse un autre restaurant, une query string et les protocoles actifs', () => {
    expect(
      loyaltyTokenFromQrPayload(
        `https://snackmanager.fr/r/autre/fidelite#card=${TOKEN}`,
        'classfood',
      ),
    ).toBeNull();
    expect(
      loyaltyTokenFromQrPayload(
        `https://snackmanager.fr/r/classfood/fidelite?card=${TOKEN}`,
        'classfood',
      ),
    ).toBeNull();
    expect(loyaltyTokenFromQrPayload(`javascript:#card=${TOKEN}`)).toBeNull();
  });

  it('refuse de construire un lien depuis une entrée invalide', () => {
    expect(() => loyaltyCardDeepLink('https://snackmanager.fr', '../admin', TOKEN))
      .toThrow();
    expect(() => loyaltyCardDeepLink('javascript:', 'classfood', TOKEN)).toThrow();
    expect(() => loyaltyCardDeepLink('https://snackmanager.fr', 'classfood', 'court'))
      .toThrow();
  });
});
