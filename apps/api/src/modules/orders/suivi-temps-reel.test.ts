import { describe, expect, it, vi } from 'vitest';
import { OrdersGateway, versSuivi } from './orders.gateway';

/**
 * LE SUIVI TEMPS RÉEL EXIGE LE MÊME SECRET QUE LE SUIVI HTTP.
 *
 * `track` ne demandait qu'un identifiant de commande, et la room recevait
 * ensuite le document ENTIER : nom du client, téléphone, et le jeton de suivi
 * lui-même. Or `tracking.ts` documente pourquoi ce jeton existe — un ObjectId
 * Mongo n'est pas un secret, ses quatre premiers octets sont l'horodatage et
 * ses trois derniers un compteur : à partir d'une commande connue, les voisines
 * se devinent.
 *
 * La protection était écrite et testée côté HTTP. Cette passerelle la
 * contournait, en diffusant en prime le secret qui ouvre l'accès HTTP.
 */

const ID = '507f1f77bcf86cd799439011';
const JETON = 'jeton-de-suivi-parfaitement-valable';

function build(existe: boolean) {
  const joined: string[] = [];
  const socket = { join: async (r: string) => void joined.push(r) } as never;
  const orders = { exists: vi.fn().mockResolvedValue(existe ? { _id: ID } : null) };
  const gw = new OrdersGateway({} as never, {} as never, orders as never, {} as never, {} as never);
  return { gw, socket, joined, orders };
}

describe('rejoindre le suivi d’une commande', () => {
  it('refuse un identifiant SANS jeton — c’était la porte ouverte', async () => {
    const { gw, socket, joined } = build(true);
    expect(await gw.track(socket, { orderId: ID })).toEqual({ ok: false });
    expect(joined).toHaveLength(0);
  });

  it('refuse un jeton qui ne correspond pas', async () => {
    const { gw, socket, joined } = build(false);
    expect(await gw.track(socket, { orderId: ID, token: 'au-hasard' })).toEqual({ ok: false });
    expect(joined).toHaveLength(0);
  });

  it('admet le porteur du bon jeton', async () => {
    const { gw, socket, joined, orders } = build(true);
    expect(await gw.track(socket, { orderId: ID, token: JETON })).toEqual({ ok: true });
    expect(joined).toEqual([`order:${ID}`]);
    // Le jeton est vérifié EN BASE, pas comparé à quelque chose de deviné.
    expect(orders.exists).toHaveBeenCalledWith({ _id: ID, trackingToken: JETON });
  });

  /**
   * Express parse `?t[$ne]=x` en objet. Injecté tel quel dans un filtre Mongo,
   * il deviendrait un opérateur et rendrait la première commande venue —
   * `trackingFilter` refuse donc tout ce qui n'est pas une chaîne.
   */
  it('refuse un jeton qui est un objet — pas d’opérateur Mongo par la fenêtre', async () => {
    const { gw, socket, orders } = build(true);
    expect(await gw.track(socket, { orderId: ID, token: { $ne: '' } })).toEqual({ ok: false });
    expect(orders.exists).not.toHaveBeenCalled();
  });

  it('refuse un identifiant malformé sans interroger la base', async () => {
    const { gw, socket, orders } = build(true);
    expect(await gw.track(socket, { orderId: 'pas-un-id', token: JETON })).toEqual({ ok: false });
    expect(orders.exists).not.toHaveBeenCalled();
  });

  it('le refus ne dit JAMAIS si la commande existe', async () => {
    // Deux refus indiscernables : un « introuvable » distinct d'un « mauvais
    // jeton » confirmerait l'existence, ce que le jeton doit empêcher.
    const inconnue = await build(false).gw.track(build(false).socket, { orderId: ID, token: JETON });
    const malformee = await build(true).gw.track(build(true).socket, { orderId: 'x', token: JETON });
    expect(inconnue).toEqual(malformee);
  });
});

/**
 * CE QUE LA ROOM D'UNE COMMANDE A LE DROIT DE RECEVOIR.
 *
 * Elle recevait `order.toObject()` — le document entier. Même authentifiée par
 * jeton, une page de suivi n'a aucune raison de connaître le téléphone du
 * client, les lignes, les montants, ni le secret qui ouvre l'accès HTTP.
 *
 * Écrit en liste BLANCHE et non en retrait de champs : un champ ajouté demain
 * au document ne doit pas partir sur la page publique parce que personne n'a
 * pensé à l'exclure.
 */
describe('ce qui est diffusé sur la room d’une commande', () => {
  const complet = {
    _id: ID,
    number: 42,
    status: 'preparing',
    trackingToken: JETON,
    pickup: { slot: '2026-08-28T18:30:00.000Z', customerName: 'Nicolas', customerPhone: '0612345678' },
    lines: [{ name: 'Burger', unitPrice: 1_000 }],
    totals: { subtotal: 1_000, total: 900 },
    payment: { cashReceived: 1_000, changeGiven: 100 },
  };

  it('ne laisse passer QUE le suivi', () => {
    expect(versSuivi(complet)).toEqual({
      _id: ID,
      number: 42,
      status: 'preparing',
      pickupSlot: '2026-08-28T18:30:00.000Z',
    });
  });

  it('ne diffuse jamais le jeton — il ouvre l’accès HTTP complet', () => {
    expect(JSON.stringify(versSuivi(complet))).not.toContain(JETON);
  });

  it('ne diffuse ni identité ni téléphone du client', () => {
    const rendu = JSON.stringify(versSuivi(complet));
    expect(rendu).not.toContain('Nicolas');
    expect(rendu).not.toContain('0612345678');
  });

  it('ne diffuse ni lignes ni montants', () => {
    const rendu = JSON.stringify(versSuivi(complet));
    expect(rendu).not.toContain('Burger');
    expect(rendu).not.toContain('900');
  });

  it('un champ AJOUTÉ au document ne sort pas tout seul', () => {
    // La garantie de la liste blanche : c'est ce qui rend la protection
    // durable, plutôt que dépendante de la vigilance du prochain qui touche
    // au schéma.
    const rendu = versSuivi({ ...complet, secretDeDemain: 'ne doit pas sortir' });
    expect(JSON.stringify(rendu)).not.toContain('secretDeDemain');
  });

  it('tient debout devant un message tronqué ou vide', () => {
    for (const brut of [null, undefined, {}, { _id: ID }]) {
      expect(() => versSuivi(brut)).not.toThrow();
    }
    expect(versSuivi({}).pickupSlot).toBeNull();
  });
});
