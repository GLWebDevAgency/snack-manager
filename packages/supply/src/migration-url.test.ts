import { describe, expect, it } from 'vitest';
import { migrationDatabaseUrl } from './migration-url';

describe('URL PostgreSQL des migrations supply', () => {
  it('préfère toujours l identité DDL dédiée', () => {
    const migrationUrl =
      'postgres://migration?sslmode=verify-ca&uselibpqcompat=true&sslrootcert=%2Ftmp%2Froot.crt';
    expect(
      migrationDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_MIGRATION_URL: ` ${migrationUrl} `,
        DATABASE_URL: 'postgres://runtime',
      }),
    ).toBe(migrationUrl);
  });

  it.each([
    'postgres://migration',
    'postgres://migration?sslmode=disable',
    'postgres://migration?sslmode=no-verify',
    'postgres://migration?sslmode=require',
    'postgres://migration?sslmode=verify-ca',
    'postgres://migration?sslmode=verify-ca&uselibpqcompat=true&sslrootcert=%2Ftmp%2Froot.crt&sslmode=disable',
    'postgres://migration?sslmode=verify-ca&uselibpqcompat=true&sslrootcert=%2Ftmp%2Froot.crt&application_name=unsafe',
  ])('refuse une identité DDL déployée sans authentification TLS : %s', (url) => {
    expect(() =>
      migrationDatabaseUrl({ NODE_ENV: 'production', DATABASE_MIGRATION_URL: url }),
    ).toThrow(/authentifier PostgreSQL|paramètres TLS ambigus/);
  });

  it('accepte verify-full avec une autorité publique', () => {
    const url = 'postgres://migration?sslmode=verify-full';
    expect(migrationDatabaseUrl({ NODE_ENV: 'production', DATABASE_MIGRATION_URL: url })).toBe(url);
  });

  it('interdit le repli runtime en production', () => {
    expect(() =>
      migrationDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: 'postgres://runtime' }),
    ).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('interdit aussi le repli runtime sur Railway staging', () => {
    expect(() =>
      migrationDatabaseUrl({
        RAILWAY_ENVIRONMENT_ID: 'env_staging',
        DATABASE_URL: 'postgres://runtime',
      }),
    ).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('conserve le repli local hors production', () => {
    expect(migrationDatabaseUrl({ DATABASE_URL: ' postgres://local ' })).toBe('postgres://local');
  });

  it('échoue fermé quand aucune URL n existe', () => {
    expect(() => migrationDatabaseUrl({ NODE_ENV: 'test' })).toThrow(/manquant/);
  });
});
