/**
 * Jetons d'injection des ports du domaine.
 *
 * Nest ne sait pas injecter une interface TypeScript : elle n'existe plus à
 * l'exécution. On passe donc par des jetons, et c'est une bonne nouvelle — un
 * service qui écrit `@Inject(DOMAIN_REGISTRAR) registrar: DomainRegistrar` ne
 * peut PAS nommer Railway par accident. Changer de fournisseur devient un
 * changement de fabrique, pas une chasse aux imports.
 *
 * Même convention que `REDIS_PUB` / `REDIS_SUB` (cf. `redis.module.ts`).
 */
export const DOMAIN_REGISTRAR = 'DOMAIN_REGISTRAR';
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';
export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';
export const SECRET_HASHER = 'SECRET_HASHER';
export const TEAM_ALERTER = 'TEAM_ALERTER';
export const IMAGE_STORE = 'IMAGE_STORE';
