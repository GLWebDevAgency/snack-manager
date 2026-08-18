import { describe, expect, it } from 'vitest';
import { buildOrder, type OrderLineRequest } from './build-order';
import { OrderNumber } from './order-number';
import {
  carte,
  CROUSTY_ID,
  FRITES_ID,
  pick,
  TACOS_ID,
  TIRAMISU_ID,
} from '../menu/fixtures';
import { FixedClock } from '../shared/clock';
import { unwrap } from '../shared/result';

const context = () => ({
  number: unwrap(OrderNumber.create(42)),
  openedBy: 'caisse-1',
  clock: new FixedClock(new Date('2026-06-20T20:14:00.000Z')),
});

/** Tacos XXL « double kebab, steak, kefta » gratiné — 16,50 €. */
const tacosXXL: OrderLineRequest = {
  productId: TACOS_ID,
  variantKey: 'XXL',
  options: [
    pick('viandes', 'kebab'),
    pick('viandes', 'kebab'),
    pick('viandes', 'steak'),
    pick('viandes', 'kefta'),
    pick('gratine', 'gratine'),
  ],
};

describe('buildOrder — le service du soir', () => {
  it('construit la commande complète et son total', () => {
    // 2 tacos XXL gratinés (16,50 € pièce) + une barquette L (4,50 €)
    // + un tiramisu (3,50 €) = 41,00 €.
    const order = unwrap(
      buildOrder(
        carte,
        [
          { ...tacosXXL, quantity: 2 },
          { productId: FRITES_ID, variantKey: 'L' },
          { productId: TIRAMISU_ID },
        ],
        context(),
      ),
    );

    expect(order.subtotal.format()).toBe('41,00 €');
    expect(order.itemCount).toBe(4);
    expect(order.status).toBe('new');
    expect(order.number.format()).toBe('042');
  });

  it('fusionne deux tacos identiques ajoutés séparément au panier', () => {
    // Sans fusion, la cuisine prépare deux tickets à deux moments différents.
    const order = unwrap(
      buildOrder(carte, [tacosXXL, { productId: TIRAMISU_ID }, tacosXXL], context()),
    );

    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]?.quantity).toBe(2);
    expect(order.subtotal.format()).toBe('36,50 €');
  });

  it('ne fusionne pas deux tacos dont la note diffère', () => {
    const order = unwrap(
      buildOrder(
        carte,
        [
          { ...tacosXXL, note: 'bien épicé' },
          { ...tacosXXL, note: 'sans sel' },
        ],
        context(),
      ),
    );

    expect(order.lines).toHaveLength(2);
  });

  it('recalcule les prix depuis la carte, jamais depuis le panier', () => {
    // Le panier n’envoie que des clés : aucun montant n’y transite.
    const order = unwrap(buildOrder(carte, [{ productId: TACOS_ID, variantKey: 'M', options: [pick('viandes', 'kebab')] }], context()));
    expect(order.lines[0]?.unitPrice.format()).toBe('8,90 €');
  });

  it('refuse un produit en rupture', () => {
    const r = buildOrder(carte, [{ productId: CROUSTY_ID }], context());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('product.unavailable');
      expect(r.error.message).toBe('« Crousty One — Riz » est en rupture');
    }
  });

  it('refuse un produit qui n’est plus à la carte', () => {
    // Le gérant a retiré le plat pendant que le client remplissait son panier.
    const r = buildOrder(carte, [{ productId: 'plat-supprime' }], context());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('menu.product.unknown');
      expect(r.error.message).toBe("Un article de votre panier n'est plus à la carte");
    }
  });

  it('remonte la première configuration invalide et s’arrête là', () => {
    // Le tacos M à deux viandes : inutile de valider la suite, la personne au
    // comptoir a une seule chose à corriger.
    const r = buildOrder(
      carte,
      [
        { productId: TIRAMISU_ID },
        {
          productId: TACOS_ID,
          variantKey: 'M',
          options: [pick('viandes', 'kebab'), pick('viandes', 'steak')],
        },
        { productId: 'plat-supprime' },
      ],
      context(),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('option.rule');
  });

  it('refuse un retrait que la fiche produit ne prévoit pas', () => {
    const r = buildOrder(carte, [{ ...tacosXXL, removals: ['gluten'] }], context());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('menu.removal.refused');
  });

  it('fait suivre les retraits jusqu’au bon de préparation', () => {
    const order = unwrap(
      buildOrder(carte, [{ ...tacosXXL, removals: ['Sans Oignons'] }], context()),
    );

    expect(order.kitchenTicket()[0]).toContain('sans oignons');
  });

  it('refuse un panier vide', () => {
    const r = buildOrder(carte, [], context());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.empty');
  });

  it('refuse une quantité aberrante sans perdre le reste du panier', () => {
    const r = buildOrder(carte, [{ ...tacosXXL, quantity: 0 }], context());

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.line.invalid');
  });
});
