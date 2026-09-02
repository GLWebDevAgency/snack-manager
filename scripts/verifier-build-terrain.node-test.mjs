import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cibleBuildTerrain } from './verifier-build-terrain.mjs';

const LOCAL = {
  EXPO_PUBLIC_API_URL: 'http://localhost:3001',
  EXPO_PUBLIC_SITE_URL: 'http://localhost:3000',
  EXPO_PUBLIC_ALLOW_LOCAL_API: '1',
};
const STAGING = {
  EXPO_PUBLIC_API_URL: 'https://api-staging-a5e8.up.railway.app',
  EXPO_PUBLIC_SITE_URL: 'https://web-staging-6f5f.up.railway.app',
  EXPO_PUBLIC_ALLOW_LOCAL_API: '0',
};
const PRODUCTION = {
  EXPO_PUBLIC_API_URL: 'https://api-production-8949.up.railway.app',
  EXPO_PUBLIC_SITE_URL: 'https://web-production-99b58c.up.railway.app',
  EXPO_PUBLIC_ALLOW_LOCAL_API: '0',
};

describe('configuration des builds terrain', () => {
  it('accepte uniquement les trois paires completes', () => {
    assert.equal(cibleBuildTerrain(LOCAL), 'local');
    assert.equal(cibleBuildTerrain(STAGING), 'staging');
    assert.equal(cibleBuildTerrain(PRODUCTION), 'production');
  });

  it('refuse une configuration absente ou partielle', () => {
    assert.throws(() => cibleBuildTerrain({}), /invalide/);
    assert.throws(
      () => cibleBuildTerrain({ ...STAGING, EXPO_PUBLIC_SITE_URL: undefined }),
      /invalide/,
    );
  });

  it('refuse tout mélange staging et production', () => {
    assert.throws(
      () => cibleBuildTerrain({ ...STAGING, EXPO_PUBLIC_SITE_URL: PRODUCTION.EXPO_PUBLIC_SITE_URL }),
      /invalide/,
    );
    assert.throws(
      () => cibleBuildTerrain({ ...PRODUCTION, EXPO_PUBLIC_API_URL: STAGING.EXPO_PUBLIC_API_URL }),
      /invalide/,
    );
  });

  it('refuse localhost sans le drapeau local et le drapeau local à distance', () => {
    assert.throws(
      () => cibleBuildTerrain({ ...LOCAL, EXPO_PUBLIC_ALLOW_LOCAL_API: '0' }),
      /invalide/,
    );
    assert.throws(
      () => cibleBuildTerrain({ ...STAGING, EXPO_PUBLIC_ALLOW_LOCAL_API: '1' }),
      /invalide/,
    );
  });

  it('refuse les variantes et origines non prévues', () => {
    for (const candidate of [
      'https://pirate.example',
      'https://api-staging-a5e8.up.railway.app/',
      'https://api-staging-a5e8.up.railway.app/path',
      'http://127.0.0.1:3001',
    ]) {
      assert.throws(
        () => cibleBuildTerrain({ ...STAGING, EXPO_PUBLIC_API_URL: candidate }),
        /invalide/,
      );
    }
  });
});
