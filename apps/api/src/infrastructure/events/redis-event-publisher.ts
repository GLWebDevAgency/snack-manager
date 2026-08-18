import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { WS_EVENTS, ordersChannel } from '@sm/contracts';
import type { DomainEvent, EventPublisher } from '@sm/domain/src/ports';

import { errorMessage } from '../http';
import { REDIS_PUB } from '../../redis.module';
import { TENANT_ID_LOOKUP, type TenantIdLookup } from './tenant-id-lookup';

/**
 * ADAPTATEUR — `EventPublisher` sur le pub/sub Redis déjà en place.
 *
 * Le chemin complet d'un fait : domaine → ici → canal `tenant:<id>:orders` →
 * `OrdersGateway` (qui écoute `tenant:*:orders`) → rooms socket.io → écrans.
 * On réutilise la connexion `REDIS_PUB` : une connexion ioredis passée en mode
 * subscriber ne peut plus émettre, d'où les deux connexions distinctes du
 * `RedisModule`.
 *
 * Deux détails qui viennent du terrain, pas de la théorie :
 *
 *  - le payload porte `_id` quand l'événement concerne une commande. La
 *    passerelle s'en sert pour arroser la room `order:<id>`, celle que rejoint
 *    le client anonyme qui suit sa commande sur son téléphone. Sans ce champ, le
 *    client voit sa page figée sur « en préparation » jusqu'au rafraîchissement ;
 *  - un changement de statut sort sous le nom `order.updated` et non
 *    `order.status_changed` : c'est le nom que les tablettes POS et KDS écoutent
 *    déjà. Le domaine nomme les faits pour lui, l'adaptateur parle la langue du
 *    transport.
 */
@Injectable()
export class RedisEventPublisher implements EventPublisher {
  private readonly logger = new Logger(RedisEventPublisher.name);

  constructor(
    @Inject(REDIS_PUB) private readonly redis: Redis,
    @Inject(TENANT_ID_LOOKUP) private readonly tenants: TenantIdLookup,
  ) {}

  /**
   * Ne lève jamais.
   *
   * La commande est déjà prise et encaissée quand on arrive ici. Faire échouer
   * la requête HTTP parce que Redis a hoqueté transformerait une gêne — un écran
   * en retard de quelques secondes — en commande perdue au comptoir.
   */
  async publish(event: DomainEvent): Promise<void> {
    try {
      const tenantId = await this.tenants.idOf(event.tenant.toString());
      if (!tenantId) {
        this.logger.warn(
          `Événement « ${event.name} » ignoré : le restaurant « ${event.tenant.toString()} » est introuvable.`,
        );
        return;
      }

      const { name, payload } = RedisEventPublisher.serialize(event);
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: name, payload }));
    } catch (error) {
      this.logger.error(`Diffusion de « ${event.name} » impossible : ${errorMessage(error)}`);
    }
  }

  /**
   * Aplatit les value objects en JSON.
   *
   * Les montants restent en CENTIMES entiers de bout en bout : un `Money`
   * sérialisé en euros décimaux réintroduirait sur le fil précisément le
   * flottant que le domaine passe son temps à éviter.
   */
  private static serialize(event: DomainEvent): { name: string; payload: Record<string, unknown> } {
    const occurredAt = event.occurredAt.toISOString();

    switch (event.name) {
      case 'order.created':
        return {
          name: WS_EVENTS.orderCreated,
          payload: {
            _id: event.orderId,
            number: event.orderNumber.value,
            total: event.total.cents,
            itemCount: event.itemCount,
            occurredAt,
          },
        };

      case 'order.status_changed':
        return {
          name: WS_EVENTS.orderUpdated,
          payload: {
            _id: event.orderId,
            number: event.orderNumber.value,
            status: event.to,
            previousStatus: event.from,
            by: event.by,
            occurredAt,
          },
        };

      case 'menu.updated':
        return {
          name: WS_EVENTS.menuUpdated,
          payload: { productIds: event.productIds, occurredAt },
        };

      case 'stock.ingredient_out':
        return {
          name: event.name,
          payload: {
            ingredient: event.ingredientName,
            productIds: event.impactedProductIds,
            occurredAt,
          },
        };
    }
  }
}
