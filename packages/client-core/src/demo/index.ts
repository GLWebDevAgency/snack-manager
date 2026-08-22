/**
 * Mode démonstration — la vraie application, sans base de données.
 *
 * Assemblage :
 *
 *   mode.ts       la bascule, et sa seule forme : `?demo=1`
 *   snapshot.ts   l'instantané figé d'une vraie carte (généré, anonymisé)
 *   fixture.ts    sa recomposition en Menu / Order / TenantPublic
 *   state.ts      l'état en mémoire du visiteur, et le chiffrage des lignes
 *   transport.ts  l'adaptateur du port de transport : mêmes routes, mêmes formes
 *   store.ts      le stockage local, volontairement volatil
 *   retour.ts     le chemin du retour vers la vitrine, et son vocabulaire
 */
export { DEMO_PARAM, DEMO_VALUE, isDemoRequested } from './mode';
export {
  DEMO_MARQUE,
  DEMO_MENTION,
  DEMO_MENTION_COURTE,
  LIBELLE_DECOUVERTE,
  LIBELLE_RETOUR,
  SITE_PAR_DEFAUT,
  destinationSure,
  estEncadre,
  origineCourante,
  referrerCourant,
  retourDemo,
  vientDuSite,
  type ContexteRetour,
  type RetourDemo,
} from './retour';
export { DEMO_TENANT, demoMenu, demoSeedOrders, indexProducts, demoTrackingToken } from './fixture';
export { createDemoState, DemoRefusal, priceLine, type DemoState } from './state';
export {
  DEFAULT_DEMO_LATENCY,
  demoTransport,
  transportFor,
  type DemoTransportOptions,
} from './transport';
export { demoStore } from './store';
