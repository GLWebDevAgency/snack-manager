import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import { PaymentsService } from './payments.service';

/** Le jeton de suivi, désormais exigé comme sur les autres routes publiques. */
const JETON = 'jeton-de-suivi-valable';
import type { EncaissementService } from '../encaissement/encaissement.service';

/**
 * CHARGES DIRECTES — le test qui garde l'éditeur hors du monopole bancaire.
 *
 * Une seule règle, et sa violation est PÉNALE, pas fiscale : le paiement d'une
 * commande est créé SUR LE COMPTE DU RESTAURANT, ou il n'a pas lieu. Encaisser
 * pour le compte d'autrui est un service de paiement réservé aux
 * établissements agréés.
 *
 * Il n'existe donc AUCUN repli : un restaurant sans compte actif ne prend pas
 * de paiement en ligne — il encaisse au comptoir, comme avant, et c'est un
 * parcours parfaitement valide.
 */

const ORDER_ID = '665f0d0a1c2b3d4e5f6a7b8c';
const TENANT_ID = '665f0d0a1c2b3d4e5f6a0001';

function build(over: { compteActif?: string | null } = {}) {
  const order = {
    _id: ORDER_ID,
    tenantId: TENANT_ID,
    number: 42,
    status: 'new',
    totals: { total: 1250 },
    payment: {
      method: 'online',
      tender: null,
      status: 'pending',
      stripePaymentIntentId: null,
      stripeAccountId: null,
    },
    save: vi.fn().mockResolvedValue(undefined),
  };

  // `findOne` avec le filtre `{ _id, trackingToken }` : la route exige le
  // jeton de suivi comme les trois autres routes publiques de commande.
  const orders = { findOne: vi.fn().mockResolvedValue(order) };

  // Le SDK Stripe, réduit à ce que le service appelle — et surtout à sa
  // SIGNATURE : c'est le second argument (les options par appel) qui porte le
  // compte connecté, et c'est lui que ce test surveille.
  const create = vi
    .fn()
    .mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method', amount: 1250 });
  const stripe = { paymentIntents: { create, retrieve: vi.fn(), update: vi.fn() } };

  const config = {
    get: vi.fn().mockImplementation((k: string) =>
      k === 'STRIPE_SECRET_KEY' ? 'sk_test_x' : k === 'STRIPE_PUBLISHABLE_KEY' ? 'pk_test_x' : undefined,
    ),
  };

  const encaissement = {
    compteActifDe: vi
      .fn()
      .mockResolvedValue(over.compteActif === undefined ? 'acct_resto1' : over.compteActif),
  };

  const service = new PaymentsService(
    orders as unknown as Model<Order>,
    config as unknown as ConfigService,
    { publish: vi.fn() } as unknown as Redis,
    encaissement as unknown as EncaissementService,
  );
  // On injecte le client déjà chargé : le paquet `stripe` n'est pas installé.
  (service as unknown as { client: unknown; loadAttempted: boolean }).client = stripe;
  (service as unknown as { loadAttempted: boolean }).loadAttempted = true;

  return { service, create, encaissement, order, orders };
}

describe('le paiement d’une commande en ligne', () => {
  it('est créé SUR LE COMPTE DU RESTAURANT, jamais sur celui de la plateforme', async () => {
    const { service, create, encaissement } = build();
    const reponse = await service.createIntent(ORDER_ID, JETON);

    expect(encaissement.compteActifDe).toHaveBeenCalledWith(TENANT_ID);
    // Deuxième argument = options par appel : c'est `stripeAccount` qui fait la
    // charge directe. Sans lui, l'argent tomberait chez l'éditeur.
    expect(create).toHaveBeenCalledWith(expect.any(Object), { stripeAccount: 'acct_resto1' });
    expect(reponse.unavailable).toBe(false);
    // Le compte remonte JUSQU'AU NAVIGATEUR : Stripe.js doit être initialisé
    // dessus, sinon le `client_secret` d'une charge directe est rejeté et le
    // client voit son paiement échouer au dernier clic.
    if (!reponse.unavailable) expect(reponse.stripeAccount).toBe('acct_resto1');
  });

  it('estampille le compte encaisseur SUR la commande — le remboursement en dépendra', async () => {
    const { service, order } = build();
    await service.createIntent(ORDER_ID, JETON);
    // Redériver le compte six mois plus tard serait faux le jour où le
    // restaurant en change : Stripe répondrait « intention introuvable ».
    expect(order.payment.stripeAccountId).toBe('acct_resto1');
    expect(order.save).toHaveBeenCalled();
  });

  it('ne pose AUCUNE commission de plateforme — « zéro commission » se vérifie ici', async () => {
    const { service, create } = build();
    await service.createIntent(ORDER_ID, JETON);
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('application_fee_amount');
    expect(params).not.toHaveProperty('transfer_data');
    expect(params).not.toHaveProperty('on_behalf_of');
  });

  it('sans compte actif : indisponible, et SURTOUT aucun appel à Stripe', async () => {
    const { service, create } = build({ compteActif: null });
    const reponse = await service.createIntent(ORDER_ID, JETON);

    // L'union est discriminée par `unavailable` : on la resserre avant de
    // lire le motif, sinon TypeScript refuse — et il a raison.
    expect(reponse.unavailable).toBe(true);
    if (reponse.unavailable) expect(reponse.reason).toMatch(/comptoir/i);
    // Le point qui compte : on ne se rabat pas sur la clé de la plateforme.
    expect(create).not.toHaveBeenCalled();
  });
});

describe('le webhook des comptes connectés — cloisonnement entre restaurants', () => {
  /**
   * LA FAILLE QUE CE BLOC FERME, ET ELLE A ÉTÉ REPRODUITE.
   *
   * Le point d'entrée « comptes connectés » reçoit par construction les
   * événements de TOUS les restaurants raccordés, et leur contenu —
   * métadonnées comprises — est sous le contrôle du marchand émetteur : il est
   * titulaire d'un compte Stripe Standard, donc de ses propres clés.
   *
   * Sans confrontation du compte émetteur, un restaurateur pouvait commander
   * chez un concurrent, relever l'identifiant de la commande, puis payer
   * 0,50 € sur SON compte avec `metadata.orderId` pointant la commande de
   * l'autre : la commande du concurrent basculait « payée en ligne », sa
   * cuisine l'imprimait, et il servait 45 € de marchandise.
   *
   * La parade tient en une clé de filtre : la commande n'est encaissée que si
   * elle a été créée SUR LE COMPTE qui émet l'événement.
   */
  const eventPaiement = (over: { account?: string; orderId?: string; amount?: number } = {}) =>
    ({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      ...(over.account !== undefined ? { account: over.account } : {}),
      data: {
        object: {
          id: 'pi_attaque',
          amount: over.amount ?? 50,
          metadata: { orderId: over.orderId ?? ORDER_ID },
        },
      },
    }) as never;

  function bancWebhook(orderStripeAccountId: string | null) {
    const trouve = { _id: ORDER_ID, tenantId: TENANT_ID, number: 7, totals: { total: 4500 }, payment: { status: 'pending' }, toObject: () => ({}) };
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const orders = {
      findOneAndUpdate,
      findById: vi.fn().mockReturnValue({ lean: () => Promise.resolve({ ...trouve, payment: { status: 'pending', stripeAccountId: orderStripeAccountId } }) }),
    };
    const service = new PaymentsService(
      orders as unknown as Model<Order>,
      { get: vi.fn() } as never,
      { publish: vi.fn() } as never,
      { compteActifDe: vi.fn() } as never,
    );
    return { service, findOneAndUpdate };
  }

  it('le filtre atomique EXIGE le compte émetteur — un autre restaurant ne peut rien payer', async () => {
    const { service, findOneAndUpdate } = bancWebhook('acct_victime');
    await service.handleWebhookEvent(eventPaiement({ account: 'acct_attaquant' }));

    const filtre = findOneAndUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Sans cette clé, la commande de la victime basculait « payée ».
    expect(filtre['payment.stripeAccountId']).toBe('acct_attaquant');
    expect(filtre['payment.status']).toBe('pending');
  });

  it('webhook de plateforme (sans compte) : ne vise QUE l’historique d’avant Connect', async () => {
    const { service, findOneAndUpdate } = bancWebhook(null);
    // Pas de champ `account` : c'est le point d'entrée plateforme.
    await service.handleWebhookEvent(eventPaiement({}));
    const filtre = findOneAndUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    // `null` et non « absent » : une commande encaissée sur un compte connecté
    // ne doit jamais être confirmée par un événement de plateforme.
    expect(filtre['payment.stripeAccountId']).toBeNull();
  });
});

/**
 * LE PAIEMENT EXIGE LE JETON DE SUIVI, comme les trois autres routes publiques.
 *
 * `POST /public/orders/:id/payment-intent` était la seule à ouvrir une commande
 * sur son seul ObjectId. Or `tracking.ts` explique pourquoi cela ne suffit pas :
 * les quatre premiers octets sont l'horodatage, les trois derniers un compteur —
 * à partir d'une commande connue, les voisines se devinent.
 *
 * Elle confirmait donc l'existence d'une commande, en révélait le montant, et
 * laissait ouvrir des intentions de paiement sur les commandes d'autrui.
 */
describe('l’accès au paiement d’une commande', () => {
  it('refuse sans jeton, et sans interroger la base', async () => {
    const { service, orders } = build();
    await expect(service.createIntent(ORDER_ID, undefined)).rejects.toThrow(/introuvable/);
    expect(orders.findOne).not.toHaveBeenCalled();
  });

  it('refuse un jeton qui est un objet — pas d’opérateur Mongo par la fenêtre', async () => {
    // Express parse `?t[$ne]=x` en objet : injecté dans un filtre, il rendrait
    // la première commande venue.
    const { service, orders } = build();
    await expect(service.createIntent(ORDER_ID, { $ne: '' })).rejects.toThrow(/introuvable/);
    expect(orders.findOne).not.toHaveBeenCalled();
  });

  it('cherche la commande PAR son jeton, pas seulement par son identifiant', async () => {
    const { service, orders } = build();
    await service.createIntent(ORDER_ID, JETON);
    expect(orders.findOne).toHaveBeenCalledWith({ _id: ORDER_ID, trackingToken: JETON });
  });
});
