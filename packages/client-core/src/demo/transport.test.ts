import { describe, expect, it } from 'vitest';
import { photoHeritee } from '@sm/contracts';
import { SmClient, type Transport } from '../api';
import { setStore } from '../storage';
import { SUPPLEMENT_GROUP, type Menu, type Order, type Product } from '../types';
import { demoStore } from './store';
import { demoTransport } from './transport';
import { DEMO_TENANT } from './fixture';

/**
 * La démonstration doit se comporter comme l'API, pas comme une maquette. Ces
 * cas sont ceux qu'un restaurateur va réellement produire en trois minutes sur
 * la page d'accueil : il ajoute, il configure, il encaisse, il fait avancer.
 */

const T0 = Date.parse('2026-08-19T12:30:00.000Z');
const nowFn = () => T0;

/** Transport sans latence : un test qui dort n'apporte rien. */
const transport = (): Transport => demoTransport({ latency: false, now: nowFn });

function clientOn(t: Transport): SmClient {
  setStore(demoStore());
  return new SmClient({ baseUrl: 'https://ignoré', transport: t });
}

/**
 * Attend que la file se vide d'elle-même.
 *
 * `enqueue` déclenche déjà un envoi en tâche de fond : rappeler `flush()` ne
 * fait rien tant que le premier passage n'est pas terminé. C'est exactement ce
 * que vit la caisse — elle rend la main tout de suite et le réseau rattrape.
 */
async function settle(client: SmClient): Promise<void> {
  for (let i = 0; i < 100 && client.queue.getState().pending > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const send = (t: Transport, method: string, path: string, body?: unknown) =>
  t.send({ method, baseUrl: '', path, headers: {}, ...(body === undefined ? null : { body }) });

async function menuOf(t: Transport): Promise<Menu> {
  const res = await send(t, 'GET', `/public/tenants/${DEMO_TENANT.slug}/menu`);
  return res.body as Menu;
}

/** Un produit qui exerce vraiment la configuration : options ET suppléments. */
function richProduct(menu: Menu): Product {
  for (const category of menu.categories) {
    for (const product of category.products) {
      const required = (product.optionGroups ?? []).find((g) => (g.min ?? 0) > 0);
      if (required && product.supplements?.length && !product.variants?.length) return product;
    }
  }
  throw new Error('Fixture sans produit configurable — le générateur a dérivé');
}

describe('carte de démonstration', () => {
  it("sert la carte complète d'un vrai snack", async () => {
    const menu = await menuOf(transport());
    const products = menu.categories.flatMap((c) => c.products);
    // Le volume EST l'argument : une carte de six produits ne ressemble à
    // aucun établissement, et le visiteur ne s'y reconnaît pas.
    expect(menu.categories.length).toBeGreaterThan(15);
    expect(products.length).toBeGreaterThan(80);
    expect(products.some((p) => (p.optionGroups?.length ?? 0) > 0)).toBe(true);
    expect(products.some((p) => (p.supplements?.length ?? 0) > 0)).toBe(true);
    expect(products.some((p) => (p.removables?.length ?? 0) > 0)).toBe(true);
    expect(products.some((p) => (p.variants?.length ?? 0) > 0)).toBe(true);
  });

  it('porte des photos, sous la forme exacte du repli hérité', async () => {
    const menu = await menuOf(transport());
    const products = menu.categories.flatMap((c) => c.products);
    const avecPhoto = products.filter((p) => p.photoUrl);

    // Une carte sans aucune photo ne montrerait pas la vignette de la caisse
    // au prospect, et une carte tout en photos ne ressemblerait à aucun snack :
    // c'est la MIXITÉ qui doit tenir — des tuiles illustrées à côté de tuiles
    // purement typographiques, comme dans un vrai établissement.
    expect(avecPhoto.length).toBeGreaterThan(20);
    expect(avecPhoto.length).toBeLessThan(products.length);

    for (const p of avecPhoto) {
      // `photoHeritee` rend la chaîne INCHANGÉE quand elle est servable, et
      // `null` sinon : l'égalité vérifie donc d'un coup la forme admise et
      // l'absence de contournement (`//hôte-tiers`, `javascript:`…).
      expect(photoHeritee(p.photoUrl)).toBe(p.photoUrl);
      expect(p.photoUrl?.startsWith('/photos/')).toBe(true);
    }
    // Aucune médiathèque simulée : le point d'intérêt et le texte alternatif
    // n'existent pas ici, et les surfaces doivent rester lisibles sans eux.
    expect(products.every((p) => (p.medias?.length ?? 0) === 0)).toBe(true);
    expect(menu.medias ?? []).toEqual([]);
  });

  it("n'expose aucune identité réelle", async () => {
    const t = transport();
    const menu = await menuOf(t);
    const tenant = (await send(t, 'GET', `/public/tenants/${DEMO_TENANT.slug}`)).body as {
      name: string;
    };
    const texte = JSON.stringify(menu) + JSON.stringify(tenant);
    expect(tenant.name).toBe('Le Comptoir');
    expect(texte).not.toMatch(/class'?\s*food/i);
  });

  it('sert un service déjà commencé, à des statuts différents', async () => {
    const t = transport();
    const rows = ((await send(t, 'GET', '/orders')).body as { rows: Order[] }).rows;
    expect(rows.length).toBeGreaterThan(2);
    expect(new Set(rows.map((o) => o.status))).toEqual(new Set(['new', 'preparing', 'ready']));
    // Les horodatages sont RELATIFS au démarrage : sans cela, le minuteur de la
    // cuisine afficherait l'âge du fichier de fixture.
    for (const order of rows) {
      const age = T0 - Date.parse(order.createdAt);
      expect(age).toBeGreaterThan(0);
      expect(age).toBeLessThan(60 * 60_000);
    }
  });

  it('sert le compteur léger avec les mêmes filtres que la liste', async () => {
    const t = transport();
    const since = new Date(T0 - 60 * 60_000).toISOString();
    const path = `?status=new&since=${encodeURIComponent(since)}`;
    const list = (await send(t, 'GET', `/orders${path}`)).body as { total: number };
    const count = await send(t, 'GET', `/orders/count${path}`);

    expect(count.status).toBe(200);
    expect(count.body).toEqual({ total: list.total });
  });
});

describe('prise de commande', () => {
  it('chiffre la commande depuis la carte, pas depuis ce que la caisse envoie', async () => {
    const t = transport();
    const menu = await menuOf(t);
    const product = richProduct(menu);
    const group = (product.optionGroups ?? []).find((g) => (g.min ?? 0) > 0)!;
    const choice = group.choices.find((c) => c.priceDelta > 0) ?? group.choices[0]!;
    const supplement = product.supplements![0]!;

    const res = await send(t, 'POST', '/orders', {
      clientId: 'c-1',
      channel: 'pos',
      type: 'surplace',
      lines: [
        {
          productId: product._id,
          options: [
            { groupKey: group.key, choiceKey: choice.key },
            { groupKey: SUPPLEMENT_GROUP, choiceKey: supplement.key },
          ],
          removed: [],
          qty: 2,
        },
      ],
      payment: { method: 'counter', tender: 'card' },
    });

    expect(res.status).toBe(200);
    const order = res.body as Order;
    const attendu = (product.price ?? 0) + choice.priceDelta + supplement.priceCents;
    expect(order.lines[0]?.unitPrice).toBe(attendu);
    expect(order.lines[0]?.lineTotal).toBe(attendu * 2);
    expect(order.totals.total).toBe(attendu * 2);
    // Les libellés viennent de la carte : la cuisine lit « Cheddar », pas une clé.
    expect(order.lines[0]?.options.map((o) => o.name)).toContain(supplement.label);
    // Payé par carte au comptoir : encaissé sur-le-champ, pas à la remise.
    expect(order.payment.status).toBe('paid');
    expect(order.status).toBe('new');
  });

  it('donne un numéro de retrait qui suit le service en cours', async () => {
    const t = transport();
    const avant = ((await send(t, 'GET', '/orders')).body as { rows: Order[] }).rows;
    const max = avant.reduce((m, o) => Math.max(m, o.number), 0);
    const menu = await menuOf(t);
    const product = richProduct(menu);
    const group = (product.optionGroups ?? []).find((g) => (g.min ?? 0) > 0)!;

    const order = (
      await send(t, 'POST', '/orders', {
        clientId: 'c-2',
        lines: [
          {
            productId: product._id,
            options: [{ groupKey: group.key, choiceKey: group.choices[0]!.key }],
            removed: [],
            qty: 1,
          },
        ],
        payment: { method: 'counter', tender: 'cash', cashReceived: 5000 },
      })
    ).body as Order;

    expect(order.number).toBe(max + 1);
    // Le rendu monnaie est déduit du total que le transport vient de chiffrer.
    const paiement = order.payment as { cashReceived?: number; changeGiven?: number };
    expect(paiement.changeGiven).toBe(5000 - order.totals.total);
  });

  it('est idempotente sur clientId — un rejeu ne crée pas de doublon', async () => {
    const t = transport();
    const menu = await menuOf(t);
    const product = richProduct(menu);
    const group = (product.optionGroups ?? []).find((g) => (g.min ?? 0) > 0)!;
    const body = {
      clientId: 'rejeu',
      lines: [
        {
          productId: product._id,
          options: [{ groupKey: group.key, choiceKey: group.choices[0]!.key }],
          removed: [],
          qty: 1,
        },
      ],
      payment: { method: 'counter', tender: 'card' },
    };

    const un = (await send(t, 'POST', '/orders', body)).body as Order;
    const deux = (await send(t, 'POST', '/orders', body)).body as Order;
    expect(deux._id).toBe(un._id);
    expect(deux.number).toBe(un.number);

    const rows = ((await send(t, 'GET', '/orders')).body as { rows: Order[] }).rows;
    expect(rows.filter((o) => o.clientId === 'rejeu')).toHaveLength(1);
  });

  it('refuse une configuration incomplète, avec le message de l’API', async () => {
    const t = transport();
    const menu = await menuOf(t);
    const product = richProduct(menu);
    const res = await send(t, 'POST', '/orders', {
      clientId: 'c-3',
      lines: [{ productId: product._id, options: [], removed: [], qty: 1 }],
      payment: { method: 'counter', tender: 'card' },
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/choix attendu/);
  });

  it('refuse un produit inconnu par un 404, pas par un plantage', async () => {
    const res = await send(transport(), 'POST', '/orders', {
      clientId: 'c-4',
      lines: [{ productId: 'inexistant', options: [], removed: [], qty: 1 }],
      payment: { method: 'counter', tender: 'card' },
    });
    expect(res.status).toBe(404);
  });
});

describe('vie du ticket en cuisine', () => {
  it('fait avancer un ticket, sans jamais le faire reculer', async () => {
    const t = transport();
    const rows = ((await send(t, 'GET', '/orders?status=new')).body as { rows: Order[] }).rows;
    const cible = rows[0]!;

    const enCours = (await send(t, 'PATCH', `/orders/${cible._id}/status`, { status: 'preparing' }))
      .body as Order;
    expect(enCours.status).toBe('preparing');

    // Rejeu d'une tablette restée hors ligne : on rend l'état courant, sans
    // erreur et sans recul (ADR 0003).
    const rejeu = (await send(t, 'PATCH', `/orders/${cible._id}/status`, { status: 'new' }))
      .body as Order;
    expect(rejeu.status).toBe('preparing');
  });

  it('encaisse à la remise une commande partie sans règlement', async () => {
    const t = transport();
    const rows = ((await send(t, 'GET', '/orders')).body as { rows: Order[] }).rows;
    const due = rows.find((o) => o.payment.status === 'pending')!;
    const remise = (await send(t, 'PATCH', `/orders/${due._id}/status`, { status: 'delivered' }))
      .body as Order;
    expect(remise.status).toBe('delivered');
    expect(remise.payment.status).toBe('paid');
  });

  it('sort la commande remise du tableau de la cuisine', async () => {
    const t = transport();
    const rows = ((await send(t, 'GET', '/orders?status=ready')).body as { rows: Order[] }).rows;
    const cible = rows[0]!;
    await send(t, 'PATCH', `/orders/${cible._id}/status`, { status: 'delivered' });
    const apres = ((await send(t, 'GET', '/orders?status=ready')).body as { rows: Order[] }).rows;
    expect(apres.map((o) => o._id)).not.toContain(cible._id);
  });
});

describe('ticket client', () => {
  it('exige le jeton de suivi, et répond 404 sans lui', async () => {
    const t = transport();
    const rows = ((await send(t, 'GET', '/orders')).body as (Order & { trackingToken: string })[] &
      { rows: (Order & { trackingToken: string })[] }).rows;
    const order = rows[0]!;

    const sans = await send(t, 'GET', `/public/orders/${order._id}/ticket`);
    expect(sans.status).toBe(404);

    const avec = await send(
      t,
      'GET',
      `/public/orders/${order._id}/ticket?t=${order.trackingToken}`,
    );
    expect(avec.status).toBe(200);
    const ticket = avec.body as { header: { tenantName: string }; pickupNumber: number };
    expect(ticket.header.tenantName).toBe('Le Comptoir');
    expect(ticket.pickupNumber).toBe(order.number);
  });
});

describe('latence', () => {
  it('répond en 60 à 180 ms — une application instantanée ne fait pas vrai', async () => {
    const lent = demoTransport({ random: () => 1 });
    const rapide = demoTransport({ random: () => 0 });
    const mesure = async (t: Transport) => {
      const debut = Date.now();
      await send(t, 'GET', '/orders');
      return Date.now() - debut;
    };
    // Bornes larges : on épingle l'ordre de grandeur, pas l'ordonnanceur.
    expect(await mesure(rapide)).toBeGreaterThanOrEqual(50);
    expect(await mesure(lent)).toBeGreaterThanOrEqual(170);
    expect(await mesure(lent)).toBeLessThan(400);
  });
});

describe('la chaîne complète, telle que la caisse la vit', () => {
  it('passe par la file offline et retrouve sa commande côté serveur', async () => {
    const t = transport();
    const client = clientOn(t);

    const menu = await client.get<Menu>(`/public/tenants/${DEMO_TENANT.slug}/menu`, {
      cacheKey: 'menu.demo',
    });
    const product = richProduct(menu);
    const group = (product.optionGroups ?? []).find((g) => (g.min ?? 0) > 0)!;

    await client.post(
      '/orders',
      {
        clientId: 'chaine-1',
        channel: 'pos',
        type: 'surplace',
        lines: [
          {
            productId: product._id,
            options: [{ groupKey: group.key, choiceKey: group.choices[0]!.key }],
            removed: [],
            qty: 1,
          },
        ],
        payment: { method: 'counter', tender: 'card' },
      },
      'order:chaine-1',
    );
    await settle(client);

    // La file est vidée : la commande existe côté « serveur », et le poste la
    // retrouve par la réconciliation exactement comme en vrai.
    expect(client.queue.getState().pending).toBe(0);
    const { rows } = await client.get<{ rows: Order[] }>('/orders');
    expect(rows.some((o) => o.clientId === 'chaine-1')).toBe(true);
  });

  it('retire de la file un refus métier définitif, sans bloquer le service', async () => {
    const client = clientOn(transport());
    await client.post('/orders', { clientId: 'refus', lines: [], payment: {} }, 'order:refus');
    await settle(client);
    // 400 : rejouer ne changera rien. L'entrée sort de la file plutôt que de
    // bloquer toutes les commandes suivantes.
    expect(await client.queue.pending()).toHaveLength(0);
  });
});
