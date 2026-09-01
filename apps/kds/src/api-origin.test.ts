import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_API_OVERRIDE_KEY,
  LOCAL_API_ORIGIN,
  PRODUCTION_API_ORIGIN,
  STAGING_API_ORIGIN,
  purgeLegacyApiOverride,
  resolveApiOrigin,
} from './api-origin';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('frontiere de confiance de l API cuisine', () => {
  it('refuse un build sans origine explicite', () => {
    expect(() => resolveApiOrigin(undefined)).toThrow(/explicitement/);
    expect(() => resolveApiOrigin('   ')).toThrow(/explicitement/);
  });

  it('accepte exactement les origines distantes exploitees', () => {
    expect(resolveApiOrigin(PRODUCTION_API_ORIGIN)).toBe(PRODUCTION_API_ORIGIN);
    expect(resolveApiOrigin(`${STAGING_API_ORIGIN}/`)).toBe(STAGING_API_ORIGIN);
  });

  it('n ouvre localhost que sur decision explicite du build', () => {
    expect(() => resolveApiOrigin(LOCAL_API_ORIGIN)).toThrow(/non autorisee/);
    expect(resolveApiOrigin(LOCAL_API_ORIGIN, true)).toBe(LOCAL_API_ORIGIN);
  });

  it.each([
    'https://pirate.example',
    'https://api-production-8949.up.railway.app.pirate.example',
    'https://api-production-8949.up.railway.app@pirate.example',
    'http://api-production-8949.up.railway.app',
    'https://api-production-8949.up.railway.app:444',
    'https://api-production-8949.up.railway.app/v1',
    'https://api-production-8949.up.railway.app?redirect=pirate',
    'https://api-production-8949.up.railway.app#pirate',
    'http://127.0.0.1:3001',
    'javascript:alert(1)',
    '//pirate.example',
  ])('refuse une origine ou une forme non autorisee : %s', (candidate) => {
    expect(() => resolveApiOrigin(candidate, true)).toThrow();
  });

  it('supprime seulement l ancienne surcharge locale', () => {
    const values = new Map([
      [LEGACY_API_OVERRIDE_KEY, 'https://pirate.example'],
      ['sm.kds.session.v1', 'session-legitime'],
      ['sm.kds.board.v1', 'vue-legitime'],
    ]);

    purgeLegacyApiOverride({ removeItem: (key) => values.delete(key) });

    expect(values.has(LEGACY_API_OVERRIDE_KEY)).toBe(false);
    expect(values.get('sm.kds.session.v1')).toBe('session-legitime');
    expect(values.get('sm.kds.board.v1')).toBe('vue-legitime');
  });
});

describe('integration de la configuration KDS web', () => {
  it('ignore ?api, purge son ancienne valeur et conserve les donnees metier', async () => {
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    vi.stubEnv('EXPO_PUBLIC_API_URL', PRODUCTION_API_ORIGIN);
    vi.stubEnv('EXPO_PUBLIC_ALLOW_LOCAL_API', '0');
    vi.stubGlobal('location', {
      href: 'https://cuisine.snackmanager.fr/?api=https://pirate.example',
    });

    const values = new Map([
      [LEGACY_API_OVERRIDE_KEY, 'https://pirate.example'],
      ['sm.kds.session.v1', 'session-legitime'],
      ['sm.kds.board.v1', 'vue-legitime'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    const { API_URL } = await import('./config');

    expect(API_URL).toBe(PRODUCTION_API_ORIGIN);
    expect(values.has(LEGACY_API_OVERRIDE_KEY)).toBe(false);
    expect(values.get('sm.kds.session.v1')).toBe('session-legitime');
    expect(values.get('sm.kds.board.v1')).toBe('vue-legitime');
  });
});
