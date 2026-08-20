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
 */
export { DEMO_PARAM, DEMO_VALUE, isDemoRequested } from './mode';
export { DEMO_TENANT, demoMenu, demoSeedOrders, indexProducts, demoTrackingToken } from './fixture';
export { createDemoState, DemoRefusal, priceLine, type DemoState } from './state';
export {
  DEFAULT_DEMO_LATENCY,
  demoTransport,
  transportFor,
  type DemoTransportOptions,
} from './transport';
export { demoStore } from './store';
