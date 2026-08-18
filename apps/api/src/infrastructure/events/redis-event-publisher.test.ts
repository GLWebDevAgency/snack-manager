import { Money, TenantSlug, unwrap } from '@sm/domain';
// `OrderNumber` vit dans le sous-domaine COMMANDE, non réexporté par la racine.
import { OrderNumber } from '@sm/domain/src/ordering';
import type { DomainEvent } from '@sm/domain/src/ports';
import type Redis from 'ioredis';
import { describe, expect, it } from 'vitest';

import { RedisEventPublisher } from './redis-event-publisher';
import type { TenantIdLookup } from './tenant-id-lookup';

/**
 * Ce que ces tests protègent : la traduction entre le vocabulaire du domaine et
 * celui du transport. Le jour où le nom d'un événement change ici sans changer
 * dans les tablettes, le KDS reste muet en plein coup de feu — et personne ne
 * s'en aperçoit avant le service.
 */

const CLASSFOOD = unwrap(TenantSlug.create('classfood'));
const AT = new Date('2026-08-18T19:14:00.000Z');

interface Published {
  readonly channel: string;
  readonly event: string;
  readonly payload: Record<string, unknown>;
}

function publisherOn(
  sent: Published[],
  options: { knownSlug?: string | null; failing?: boolean } = {},
): RedisEventPublisher {
  const redis = {
    publish: async (channel: string, message: string) => {
      if (options.failing) throw new Error('ECONNREFUSED');
      const parsed = JSON.parse(message) as { event: string; payload: Record<string, unknown> };
      sent.push({ channel, event: parsed.event, payload: parsed.payload });
      return 1;
    },
  } as unknown as Redis;

  const tenants: TenantIdLookup = {
    idOf: async (slug) =>
      options.knownSlug === null ? null : slug === (options.knownSlug ?? 'classfood') ? 'tenant_1' : null,
  };

  return new RedisEventPublisher(redis, tenants);
}

const ORDER_CREATED: DomainEvent = {
  name: 'order.created',
  tenant: CLASSFOOD,
  occurredAt: AT,
  orderId: 'order_9',
  orderNumber: unwrap(OrderNumber.create(42)),
  total: Money.fromCents(2340),
  itemCount: 3,
};

describe('RedisEventPublisher', () => {
  it('diffuse une commande créée sur le canal du restaurant', async () => {
    const sent: Published[] = [];

    await publisherOn(sent).publish(ORDER_CREATED);

    expect(sent[0]?.channel).toBe('tenant:tenant_1:orders');
    expect(sent[0]?.event).toBe('order.created');
  });

  it('porte l’identifiant de commande pour que le client suive sa page de statut', async () => {
    // La passerelle arrose la room `order:<id>` à partir de ce champ. Sans lui,
    // le client anonyme reste sur « en préparation » jusqu'au rafraîchissement.
    const sent: Published[] = [];

    await publisherOn(sent).publish(ORDER_CREATED);

    expect(sent[0]?.payload._id).toBe('order_9');
  });

  it('garde les montants en centimes entiers sur le fil', async () => {
    // 23,40 € sérialisé en euros décimaux réintroduirait exactement le flottant
    // que le domaine passe son temps à éviter.
    const sent: Published[] = [];

    await publisherOn(sent).publish(ORDER_CREATED);

    expect(sent[0]?.payload.total).toBe(2340);
  });

  it('traduit un changement de statut sous le nom écouté par les tablettes', async () => {
    // Le domaine nomme le fait « order.status_changed » ; POS et KDS écoutent
    // « order.updated » depuis le premier jour.
    const sent: Published[] = [];

    await publisherOn(sent).publish({
      name: 'order.status_changed',
      tenant: CLASSFOOD,
      occurredAt: AT,
      orderId: 'order_9',
      orderNumber: unwrap(OrderNumber.create(42)),
      from: 'preparing',
      to: 'ready',
      by: 'staff_3',
    });

    expect(sent[0]?.event).toBe('order.updated');
    expect(sent[0]?.payload.status).toBe('ready');
    expect(sent[0]?.payload.previousStatus).toBe('preparing');
    expect(sent[0]?.payload.by).toBe('staff_3');
  });

  it('diffuse une rupture d’ingrédient avec les produits à griser', async () => {
    // « Plus de kefta » se déclare une fois en réserve et doit couper la vente
    // partout — c'est la commande en ligne qu'on oublie toujours de prévenir.
    const sent: Published[] = [];

    await publisherOn(sent).publish({
      name: 'stock.ingredient_out',
      tenant: CLASSFOOD,
      occurredAt: AT,
      ingredientName: 'Kefta',
      impactedProductIds: ['p1', 'p2'],
    });

    expect(sent[0]?.event).toBe('stock.ingredient_out');
    expect(sent[0]?.payload.ingredient).toBe('Kefta');
    expect(sent[0]?.payload.productIds).toEqual(['p1', 'p2']);
  });

  it('ne fait jamais échouer la commande quand Redis est tombé', async () => {
    // La commande est déjà encaissée quand on arrive ici : perdre le ticket
    // parce que le bus a hoqueté serait un échange bien pire qu'un écran en
    // retard de quelques secondes.
    const sent: Published[] = [];

    await expect(publisherOn(sent, { failing: true }).publish(ORDER_CREATED)).resolves.toBeUndefined();
  });

  it('ignore sans lever un restaurant introuvable', async () => {
    const sent: Published[] = [];

    await publisherOn(sent, { knownSlug: null }).publish(ORDER_CREATED);

    expect(sent).toHaveLength(0);
  });
});
