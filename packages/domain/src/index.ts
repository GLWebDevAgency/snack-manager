/**
 * Façade du cœur métier.
 *
 * Deux régimes d'export, volontairement différents :
 *
 *  - Le **transverse** (Money, Result, Clock, erreurs, ports) est exporté à
 *    plat : ces briques n'appartiennent à aucun contexte, tout le monde s'en
 *    sert, et `Money` doit rester `Money` partout.
 *
 *  - Les **contextes bornés** (menu, ordering, supply, tenancy) sont exportés
 *    en espaces de noms. Ce n'est pas une précaution technique contre les
 *    collisions : c'est le langage du métier. `menu.OptionGroup` est ce que le
 *    client choisit sur la carte (avec son supplément), `supply.OptionGroup`
 *    est ce que ce choix consomme en ingrédients. Deux concepts, deux
 *    contextes, le même mot — et le préfixe lève l'ambiguïté à la lecture
 *    plutôt que de forcer un renommage bancal d'un côté ou de l'autre.
 *
 *      import { Money, menu, ordering } from '@sm/domain';
 *      const prix = menu.priceOf(item, 'XL', selections);
 *      const cmd  = ordering.buildOrder(lignes, contexte);
 */

// ─── Transverse ───
export * from './shared/errors';
export * from './shared/result';
export * from './shared/money';
export * from './shared/clock';
export * from './ports';

/**
 * Exception assumée : `PublicDomain` et `TenantSlug` restent accessibles à
 * plat. Ils sont consommés directement par le module « site » de l'API, et
 * leur nom est déjà sans ambiguïté.
 */
export { PublicDomain, TenantSlug } from './tenancy/public-domain';

// ─── Contextes bornés ───
export * as menu from './menu';
export * as ordering from './ordering';
export * as supply from './supply';
export * as tenancy from './tenancy';
