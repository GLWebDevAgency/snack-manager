/**
 * Les PORTS — tout ce que le domaine attend du monde extérieur.
 *
 * `export type *` et pas `export *`, pour une raison de compilation autant que
 * d'architecture : ce paquet est publié en SOURCES TypeScript (`main` pointe sur
 * `src/index.ts`) et n'est jamais transpilé pour Node. Un adaptateur qui
 * importerait ici une valeur — une constante, une classe — produirait un
 * `require('@sm/domain/…')` que l'API ne saurait pas charger à l'exécution.
 *
 * Le type-only le rend impossible : les ports sont des contrats, ils s'effacent
 * à la compilation, et l'infrastructure ne peut structurellement pas se mettre à
 * dépendre du cœur métier à l'exécution. C'est la flèche des dépendances
 * hexagonales rendue vérifiable par le compilateur.
 */
export type * from './domain-registrar';
export type * from './payment-gateway';
export type * from './ticket-printer';
export type * from './event-publisher';
export type * from './secret-hasher';
export type * from './notifier';
