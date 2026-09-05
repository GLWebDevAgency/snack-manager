import { createHmac } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaymentsService, type StripeWebhookEvent } from './payments.service';
import type { EncaissementService } from '../encaissement/encaissement.service';

/**
 * Ce qui est vérifié ici tient en trois phrases, et chacune correspond à une
 * commande perdue si elle tombe :
 *
 *  · une signature qui ne colle pas ne confirme RIEN — sinon n'importe qui
 *    marque ses commandes payées avec un `curl` ;
 *  · Stripe rejoue le même événement jusqu'à trois jours : le deuxième passage
 *    ne doit ni réécrire, ni surtout refaire biper le KDS ;
 *  · un paiement sans commande en face ne doit pas faire tomber la route, sinon
 *    Stripe rejoue en boucle un événement qu'aucun rejeu ne réparera.
 */

const SECRET = 'whsec_test_1234567890';
const ORDER_ID = '665f0d0a1c2b3d4e5f6a7b8c';
const TENANT_ID = '665f0d0a1c2b3d4e5f6a0001';

// ─── Doubles ───

interface FakeOrder {
  _id: string;
  tenantId: string;
  number: number;
  totals: { total: number };
  payment: {
    method: string;
    /** `null` tant que rien n'a été perçu — cf. PAYMENT_TENDERS. */
    tender: string | null;
    status: string;
    stripePaymentIntentId: string | null;
  };
}

function orderFixture(overrides: Partial<FakeOrder> = {}): FakeOrder {
  return {
    _id: ORDER_ID,
    tenantId: TENANT_ID,
    number: 42,
    totals: { total: 1250 },
    payment: {
      method: 'online',
      tender: null,
      status: 'pending',
      stripePaymentIntentId: 'pi_123',
    },
    ...overrides,
  };
}

/**
 * Modèle Mongoose minimal : `findOneAndUpdate` applique le filtre AVANT
 * l'écriture, ce qui reproduit exactement la propriété sur laquelle repose
 * l'idempotence en base.
 */
function fakeOrders(rows: FakeOrder[]) {
  return {
    async findOneAndUpdate(
      filter: Record<string, unknown>,
      update: { $set: Record<string, unknown> },
    ) {
      const row = rows.find(
        (r) => r._id === String(filter._id) && r.payment.status === filter['payment.status']
          && r.payment.stripePaymentIntentId === filter['payment.stripePaymentIntentId']
          && r.totals.total === filter['totals.total'],
      );
      if (!row) return null;
      for (const [path, value] of Object.entries(update.$set)) {
        const [head, tail] = path.split('.') as ['payment', keyof FakeOrder['payment']];
        if (head === 'payment' && tail) row.payment[tail] = value as never;
      }
      return { ...row, toObject: () => JSON.parse(JSON.stringify(row)) as unknown };
    },
    findById(id: string) {
      return { lean: async () => rows.find((r) => r._id === id) ?? null };
    },
  } as unknown as Model<Order>;
}

function fakeRedis(sink: { channel: string; message: string }[]) {
  return {
    async publish(channel: string, message: string) {
      sink.push({ channel, message });
      return 1;
    },
  } as unknown as Redis;
}

function fakeConfig(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

// ─── Construction d'un webhook signé, comme Stripe le fait ───

function sign(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function succeededBody(orderId: string | null = ORDER_ID, amount = 1250): string {
  const event: StripeWebhookEvent = {
    id: 'evt_test_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_123',
        amount,
        metadata: orderId ? { orderId } : {},
      },
    },
  };
  return JSON.stringify(event);
}

// ─── Banc d'essai ───

let rows: FakeOrder[];
let published: { channel: string; message: string }[];

function service(env: Record<string, string | undefined> = { STRIPE_WEBHOOK_SECRET: SECRET }) {
  // Le webhook ne consulte jamais le sous-domaine « encaissement » : il traite
  // un paiement déjà encaissé, sur un compte déjà résolu à la création de
  // l'intention. La doublure le prouve — toute lecture ici serait un appel de
  // trop sur un chemin qui doit rester le plus court possible.
  const encaissement = {
    compteActifDe: () => Promise.reject(new Error('le webhook ne résout aucun compte')),
  } as unknown as EncaissementService;
  return new PaymentsService(fakeOrders(rows), fakeConfig(env), fakeRedis(published), encaissement);
}

beforeEach(() => {
  rows = [orderFixture()];
  published = [];
});

describe('constructWebhookEvent — signature', () => {
  it('rejette une signature calculée avec un autre secret', () => {
    const body = succeededBody();

    expect(() => service().constructWebhookEvent(body, sign(body, 'whsec_pirate'))).toThrow(
      BadRequestException,
    );
  });

  it('rejette un corps modifié après signature', () => {
    // Le scénario réel : un intermédiaire réécrit `amount` ou `orderId`.
    const header = sign(succeededBody(ORDER_ID, 1250));

    expect(() => service().constructWebhookEvent(succeededBody(ORDER_ID, 1), header)).toThrow(
      BadRequestException,
    );
  });

  it('rejette un en-tête « stripe-signature » absent ou illisible', () => {
    const body = succeededBody();

    expect(() => service().constructWebhookEvent(body, undefined)).toThrow(BadRequestException);
    expect(() => service().constructWebhookEvent(body, 'n’importe quoi')).toThrow(
      BadRequestException,
    );
    expect(() => service().constructWebhookEvent(body, 't=123')).toThrow(BadRequestException);
  });

  it('rejette un horodatage hors tolérance (rejeu d’une requête interceptée)', () => {
    const body = succeededBody();
    const vieux = Math.floor(Date.now() / 1000) - 3600;

    expect(() => service().constructWebhookEvent(body, sign(body, SECRET, vieux))).toThrow(
      BadRequestException,
    );
  });

  it('accepte une signature valide et rend l’événement décodé', () => {
    const body = succeededBody();

    const event = service().constructWebhookEvent(Buffer.from(body, 'utf8'), sign(body));

    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.data.object.metadata?.orderId).toBe(ORDER_ID);
  });

  it('échoue si le corps a été re-sérialisé — la raison d’être de rawBody', () => {
    // Même objet, autre ordre de clés : le HMAC change. Ce test protège
    // `rawBody: true` dans main.ts d'une suppression « de nettoyage ».
    const body = succeededBody();
    const header = sign(body);
    const reserialise = JSON.stringify(JSON.parse(body), ['type', 'id', 'data']);

    expect(reserialise).not.toBe(body);
    expect(() => service().constructWebhookEvent(reserialise, header)).toThrow(BadRequestException);
  });

  it('accepte plusieurs v1 — le cas d’une rotation de secret en cours', () => {
    const body = succeededBody();
    const timestamp = Math.floor(Date.now() / 1000);
    const ancien = createHmac('sha256', 'whsec_ancien').update(`${timestamp}.${body}`).digest('hex');
    const header = `${sign(body, SECRET, timestamp)},v1=${ancien}`;

    expect(() => service().constructWebhookEvent(body, header)).not.toThrow();
  });

  it('répond 503 — et non 500 — sans STRIPE_WEBHOOK_SECRET', () => {
    const sansSecret = service({ STRIPE_WEBHOOK_SECRET: undefined });
    const body = succeededBody();

    expect(sansSecret.webhookConfigured()).toBe(false);
    expect(() => sansSecret.constructWebhookEvent(body, sign(body))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('signale un corps brut absent (main.ts sans rawBody) plutôt que de planter', () => {
    expect(() => service().constructWebhookEvent(undefined, sign(''))).toThrow(BadRequestException);
  });
});

describe('handleWebhookEvent — payment_intent.succeeded', () => {
  it('marque la commande payée en ligne et publie la confirmation temps réel', async () => {
    const body = succeededBody();
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result.outcome).toBe('payee');
    expect(rows[0]?.payment.status).toBe('paid');
    // `method` = OÙ (en ligne) · `tender` = AVEC QUOI (en ligne) : sans les
    // deux, la clôture de caisse ne sait pas classer l'encaissement.
    expect(rows[0]?.payment.method).toBe('online');
    expect(rows[0]?.payment.tender).toBe('online');
    expect(published).toHaveLength(1);
    expect(published[0]?.channel).toBe(`tenant:${TENANT_ID}:orders`);
    const diffuse = JSON.parse(published[0]!.message) as { event: string; payload: FakeOrder };
    expect(diffuse.event).toBe('order.updated');
    expect(diffuse.payload.payment.status).toBe('paid');
  });

  it('est idempotent : un rejeu ne réécrit rien et ne republie pas', async () => {
    // Stripe rejoue jusqu'à 3 jours. Un second « order.updated » referait biper
    // le KDS pour une commande déjà confirmée.
    const body = succeededBody();
    const sut = service();
    const event = sut.constructWebhookEvent(body, sign(body));

    const premier = await sut.handleWebhookEvent(event);
    const second = await sut.handleWebhookEvent(event);
    const troisieme = await sut.handleWebhookEvent(event);

    expect(premier.outcome).toBe('payee');
    expect(second.outcome).toBe('deja_payee');
    expect(troisieme.outcome).toBe('deja_payee');
    expect(published).toHaveLength(1);
  });

  it('ne ramène pas une commande remboursée à « payée »', async () => {
    rows = [
      orderFixture({
        payment: {
          method: 'online',
          tender: 'online',
          status: 'refunded',
          stripePaymentIntentId: 'pi_123',
        },
      }),
    ];
    const body = succeededBody();
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result.outcome).toBe('deja_payee');
    expect(rows[0]?.payment.status).toBe('refunded');
    expect(published).toHaveLength(0);
  });

  it('gère une commande introuvable sans lever ni publier', async () => {
    // Sinon Stripe rejouerait trois jours durant un événement qu'aucun rejeu ne
    // réparera. On accuse réception, la trace part dans les logs.
    const body = succeededBody('665f0d0a1c2b3d4e5f6affff');
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result).toMatchObject({ received: true, outcome: 'ignoree' });
    expect(published).toHaveLength(0);
  });

  it('gère un metadata.orderId absent ou non-ObjectId', async () => {
    const sut = service();
    const sansId = succeededBody(null);
    const idBidon = succeededBody('pas-un-objectid');

    const a = await sut.handleWebhookEvent(sut.constructWebhookEvent(sansId, sign(sansId)));
    const b = await sut.handleWebhookEvent(sut.constructWebhookEvent(idBidon, sign(idBidon)));

    expect(a.outcome).toBe('ignoree');
    expect(b.outcome).toBe('ignoree');
    expect(rows[0]?.payment.status).toBe('pending');
    expect(published).toHaveLength(0);
  });

  it('ne confirme pas une commande avec un montant encaissé inférieur au total serveur', async () => {
    const body = succeededBody(ORDER_ID, 900); // commande à 1250 c
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result.outcome).toBe('ignoree');
    expect(rows[0]?.payment.status).toBe('pending');
    expect(published).toHaveLength(0);
  });

  it('ne confirme pas avec une autre intention de paiement ni une autre devise', async () => {
    const sut = service();
    const event = JSON.parse(succeededBody()) as StripeWebhookEvent;
    event.data.object.id = 'pi_other';
    expect((await sut.handleWebhookEvent(event)).outcome).toBe('ignoree');
    event.data.object.id = 'pi_123';
    Object.assign(event.data.object, { currency: 'usd' });
    expect((await sut.handleWebhookEvent(event)).outcome).toBe('ignoree');
    expect(rows[0]?.payment.status).toBe('pending');
  });
});

describe('handleWebhookEvent — autres événements', () => {
  it('laisse la commande en attente sur payment_intent.payment_failed', async () => {
    const body = JSON.stringify({
      id: 'evt_test_2',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_123',
          metadata: { orderId: ORDER_ID },
          last_payment_error: { message: 'Carte refusée' },
        },
      },
    });
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result.outcome).toBe('echec_paiement');
    expect(rows[0]?.payment.status).toBe('pending');
    expect(rows[0]?.payment.tender).toBeNull(); // rien n'a été perçu
    expect(published).toHaveLength(0);
  });

  it('accuse réception d’un type non traité sans faire rejouer Stripe', async () => {
    const body = JSON.stringify({
      id: 'evt_test_3',
      type: 'charge.dispute.created',
      data: { object: { id: 'ch_1' } },
    });
    const sut = service();

    const result = await sut.handleWebhookEvent(sut.constructWebhookEvent(body, sign(body)));

    expect(result).toMatchObject({ received: true, outcome: 'ignoree' });
    expect(published).toHaveLength(0);
  });
});
