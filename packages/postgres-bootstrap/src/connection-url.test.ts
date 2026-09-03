import { describe, expect, it } from 'vitest';
import { authenticatedPostgresUrl } from './connection-url';

const base = ['postgresql://', 'migration_user', ':', 'password', '@db.example:5432/railway'].join('');
const options = {
  variableName: 'DATABASE_MIGRATION_URL',
  expectedDatabase: 'railway',
  expectedRole: 'migration_user',
};

describe('URL PostgreSQL privilégiée', () => {
  it('accepte les deux profils TLS stricts utilisés par le dépôt', () => {
    expect(authenticatedPostgresUrl(`${base}?sslmode=verify-full`, options)).toContain(
      'verify-full',
    );
    expect(
      authenticatedPostgresUrl(
        `${base}?sslmode=verify-ca&uselibpqcompat=true&sslrootcert=%2Ftmp%2Frailway-ca.pem`,
        options,
      ),
    ).toContain('verify-ca');
  });

  it.each([
    base,
    `${base}?sslmode=require`,
    `${base}?sslmode=verify-ca&uselibpqcompat=true`,
    `${base}?sslmode=verify-ca&uselibpqcompat=true&sslrootcert=relative.pem`,
    `${base}?sslmode=verify-full&application_name=bootstrap`,
    `${base}?sslmode=verify-full&sslmode=verify-full`,
  ])('refuse une connexion non authentifiée ou ambiguë : %s', (url) => {
    expect(() => authenticatedPostgresUrl(url, options)).toThrow(/TLS|authentifier/);
  });

  it('refuse la mauvaise base, le mauvais rôle et les espaces invisibles', () => {
    expect(() =>
      authenticatedPostgresUrl(
        `${base.replace('/railway', '/autre')}?sslmode=verify-full`,
        options,
      ),
    ).toThrow(/base PostgreSQL attendue/);
    expect(() =>
      authenticatedPostgresUrl(
        `${base.replace('migration_user', 'runtime_user')}?sslmode=verify-full`,
        options,
      ),
    ).toThrow(/rôle PostgreSQL attendu/);
    expect(() => authenticatedPostgresUrl(` ${base}?sslmode=verify-full`, options)).toThrow(
      /espaces/,
    );
  });

  it('interdit à la réparation de réutiliser le migrateur ou le runtime', () => {
    expect(() =>
      authenticatedPostgresUrl(`${base}?sslmode=verify-full`, {
        variableName: 'DATABASE_BOOTSTRAP_ADMIN_URL',
        expectedDatabase: 'railway',
        forbiddenRoles: ['migration_user', 'runtime_user'],
      }),
    ).toThrow(/identité applicative interdite/);
  });
});
