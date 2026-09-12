import type { Pool, PoolClient } from 'pg';

/** The 0006→0007 test intentionally runs against schema 0006. Its enrollment
 * use cases still execute every real PostgreSQL transaction. Restrict only the
 * new projection/INSERT column lists to their historical shape; no identity,
 * funding, browser, account or session result is mocked. Not a runtime fallback. */
export function legacy0006TestPool(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'connect') {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, key) {
            if (key !== 'query') {
              const value: unknown = Reflect.get(connection, key, connection);
              return typeof value === 'function' ? value.bind(connection) : value;
            }
            return (text: string, values: unknown[] = []) => {
              if (text.includes('SELECT 1 FROM customer.production_budget_activation')) {
                return connection.query('SELECT 1 WHERE false');
              }
              if (text.includes('INSERT INTO customer.browser_preparations')) {
                text = text.replace(',production_admission_policy_ref,admission_source_hash)', ')');
                text = text.replace(",$4,$5 FROM instant", ' FROM instant'); values = values.slice(0,3);
              } else if (text.includes('INSERT INTO customer.verification_intents')) {
                text = text.replace(',production_admission_policy_ref,admission_source_hash)', ')')
                  .replace('END,$8,$9', 'END'); values = values.slice(0,7);
              } else if (text.includes('INSERT INTO customer.reservations')) {
                text = text.replace(',production_authorization_ref)', ')').replace(',$14)', ')'); values = values.slice(0,13);
              } else if (text.includes('SELECT c.*,r.funding_kind')) {
                text = text.replace(',r.production_authorization_ref,\n    a.expires_at AS production_expiry,a.revoked_at AS production_revoked,a.service_sid AS production_service,', ',')
                  .replace('    LEFT JOIN customer.production_budget_authorizations a ON (a.parent_ref,a.tenant_ref,a.authorization_ref)\n      =(r.parent_ref,r.tenant_ref,r.production_authorization_ref)\n', '');
              }
              if (text.includes('production_')) throw new Error('An unreviewed new storage operation reached the historical 0006 fixture');
              return connection.query(text, values);
            };
          },
        }) as PoolClient;
      };
    },
  });
}
