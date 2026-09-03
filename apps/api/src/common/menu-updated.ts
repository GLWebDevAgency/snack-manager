import type Redis from 'ioredis';
import { ordersChannel, WS_EVENTS } from '@sm/contracts';
import { publishRedisBestEffort } from './redis-best-effort';

/**
 * « LA CARTE A CHANGÉ » — l'annonce, écrite une seule fois.
 *
 * La caisse, la cuisine et l'écran de salle écoutent cet événement pour
 * recharger la carte sans qu'on ait à toucher une tablette en service. Deux
 * modules l'émettent désormais — le menu (prix, ruptures, produits) et la
 * médiathèque (une photo rattachée à un plat, un média retiré) — et le jour où
 * un troisième s'y met, il ne doit pas avoir à redécouvrir le canal ni le nom
 * de l'événement.
 *
 * `best effort` : Redis absent ou muet ne fait PAS échouer le geste métier. La
 * photo est posée, la caisse la verra à son prochain rechargement — refuser le
 * geste parce que l'annonce n'est pas partie serait punir le restaurateur pour
 * une panne d'infrastructure.
 */
export function publierMenuMisAJour(
  redis: Redis,
  tenantId: string,
  meta: Record<string, unknown>,
): void {
  void publishRedisBestEffort(
    redis,
    ordersChannel(tenantId),
    JSON.stringify({ event: WS_EVENTS.menuUpdated, payload: meta }),
  );
}
