import { describe, expect, it } from 'vitest';
import { isDeployedRuntime } from './deployed-runtime';

describe('détection d un runtime déployé', () => {
  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: 'staging' },
    { RAILWAY_ENVIRONMENT_ID: 'env_123' },
  ])('active les gates sur %j', (config) => {
    expect(isDeployedRuntime(config)).toBe(true);
  });

  it.each([
    {},
    { NODE_ENV: 'test' },
    { NODE_ENV: 'development', RAILWAY_ENVIRONMENT_NAME: '   ' },
  ])('reste hors déploiement sur %j', (config) => {
    expect(isDeployedRuntime(config)).toBe(false);
  });
});
