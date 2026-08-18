import { describe, expect, it } from 'vitest';
import { StaffAuthorization } from './authorization';
import { Discount } from './discount';
import { Order } from './order';
import { OrderLine } from './order-line';
import { OrderNumber } from './order-number';
import { frites, pick, tacos, tiramisu } from '../menu/fixtures';
import type { MenuItem } from '../menu/menu-item';
import { validateSelection } from '../menu/rules';
import type { OptionSelection } from '../menu/selection';
import { FixedClock } from '../shared/clock';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';

const SERVICE_DU_SOIR = '2026-06-20T20:14:00.000Z';

const clock = (): FixedClock => new FixedClock(new Date(SERVICE_DU_SOIR));

const numero = unwrap(OrderNumber.create(42));

function ligne(
  item: MenuItem,
  variantKey: string | null,
  options: readonly OptionSelection[] = [],
  note: string | null = null,
): OrderLine {
  const config = unwrap(validateSelection(item, variantKey, options));
  return unwrap(OrderLine.fromConfiguration(config, { note }));
}

/** Tacos XXL gratiné à 16,50 € — la ligne de référence des tests. */
const tacosXXL = (note: string | null = null): OrderLine =>
  ligne(
    tacos,
    'XXL',
    [
      pick('viandes', 'kebab'),
      pick('viandes', 'kebab'),
      pick('viandes', 'steak'),
      pick('viandes', 'kefta'),
      pick('gratine', 'gratine'),
    ],
    note,
  );

const dessert = (): OrderLine => ligne(tiramisu, null);

function commande(lines: readonly OrderLine[] = [tacosXXL(), dessert()], c = clock()): Order {
  return unwrap(Order.open({ number: numero, lines, openedBy: 'caisse-1', clock: c }));
}

const gerant = (c = clock()): StaffAuthorization => unwrap(StaffAuthorization.grant('gerant-1', c));

describe('Order — ouverture et totaux', () => {
  it('une commande sans article ne peut pas être enregistrée', () => {
    const r = Order.open({ number: numero, lines: [], openedBy: 'caisse-1', clock: clock() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.empty');
  });

  it('le sous-total additionne les lignes au prix figé', () => {
    // 16,50 € (tacos XXL gratiné) + 3,50 € (tiramisu)
    expect(commande().subtotal.format()).toBe('20,00 €');
    expect(commande().total.format()).toBe('20,00 €');
  });

  it('la commande naît « nouvelle » et l’historique en garde la trace', () => {
    const c = commande();
    expect(c.status).toBe('new');
    expect(c.history).toHaveLength(1);
    expect(c.history[0]?.by).toBe('caisse-1');
    expect(c.placedAt.toISOString()).toBe(SERVICE_DU_SOIR);
  });

  it('compte les articles à préparer, quantités comprises', () => {
    const deuxTacos = unwrap(tacosXXL().withQuantity(2));
    expect(commande([deuxTacos, dessert()]).itemCount).toBe(3);
  });

  it('fusionne les lignes identiques quel que soit le chemin d’entrée', () => {
    const c = commande([tacosXXL(), dessert(), tacosXXL()]);
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0]?.quantity).toBe(2);
    // La fusion garde l’ordre de première apparition : le tacos reste en tête.
    expect(c.lines[0]?.label()).toBe('Compose ton Tacos XXL');
  });

  it('l’ajout d’une boisson en cours de préparation est accepté', () => {
    const enCours = unwrap(commande().advanceTo('preparing', 'cuisine-1', clock()));
    const avecFrites = unwrap(enCours.addLine(ligne(frites, 'L')));

    expect(avecFrites.subtotal.format()).toBe('24,50 €');
  });

  it('on n’ajoute plus rien à une commande servie', () => {
    const c = clock();
    let order = commande([tacosXXL()], c);
    order = unwrap(order.advanceTo('preparing', 'cuisine-1', c));
    order = unwrap(order.advanceTo('ready', 'cuisine-1', c));
    order = unwrap(order.advanceTo('delivered', 'caisse-1', c));

    const r = order.addLine(dessert());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.closed');
  });
});

describe('Order — lignes annulées', () => {
  it('le sous-total ignore les lignes annulées, le ticket les garde', () => {
    const c = clock();
    const order = unwrap(commande([tacosXXL(), dessert()], c).cancelLine(0, 'tombé au sol', gerant(c), c));

    expect(order.subtotal.format()).toBe('3,50 €');
    expect(order.lines).toHaveLength(2);
    expect(order.activeLines).toHaveLength(1);
    expect(order.kitchenTicket()[0]).toContain('ANNULÉE — tombé au sol');
  });

  it('annuler une ligne sans code PIN est refusé', () => {
    const c = clock();
    const r = commande([tacosXXL()], c).cancelLine(0, 'tombé au sol', null, c);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('authorization.required');
  });

  it('annuler la dernière ligne encore due annule la commande', () => {
    // Laisser une commande à 0 € en préparation enverrait la cuisine travailler
    // pour rien.
    const c = clock();
    const order = unwrap(commande([tacosXXL()], c).cancelLine(0, 'client parti', gerant(c), c));

    expect(order.status).toBe('cancelled');
    expect(order.subtotal.cents).toBe(0);
    expect(order.history.at(-1)?.by).toBe('gerant-1');
  });

  it('une ligne inexistante est signalée, pas ignorée', () => {
    const c = clock();
    const r = commande([tacosXXL()], c).cancelLine(7, 'erreur', gerant(c), c);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.line.unknown');
  });
});

describe('Order — remise (exigences NF525)', () => {
  it('une remise sans code PIN vérifié est refusée', () => {
    const c = clock();
    const r = commande().applyDiscount({
      amount: Money.fromCents(200),
      reason: 'geste commercial',
      authorization: null,
      clock: c,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('authorization.required');
      expect(r.error.message).toBe("L'action « remise » exige une validation par code PIN");
    }
  });

  it('une remise sans motif est refusée', () => {
    const c = clock();
    const r = commande().applyDiscount({
      amount: Money.fromCents(200),
      reason: 'ok',
      authorization: gerant(c),
      clock: c,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.discount.invalid');
  });

  it('une remise nulle ou négative est refusée', () => {
    const c = clock();
    const r = commande().applyDiscount({
      amount: Money.ZERO,
      reason: 'geste commercial',
      authorization: gerant(c),
      clock: c,
    });

    expect(r.ok).toBe(false);
  });

  it('une remise supérieure au sous-total est refusée', () => {
    const c = clock();
    const r = commande().applyDiscount({
      amount: Money.fromCents(5000),
      reason: 'geste commercial',
      authorization: gerant(c),
      clock: c,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe('Remise de 50,00 € supérieure au total de 20,00 €');
    }
  });

  it('une remise valide retient son montant, son motif et son valideur', () => {
    const c = clock();
    const order = unwrap(
      commande().applyDiscount({
        amount: Money.fromCents(200),
        reason: 'erreur de préparation',
        authorization: gerant(c),
        clock: c,
      }),
    );

    expect(order.total.format()).toBe('18,00 €');
    expect(order.discount?.reason).toBe('erreur de préparation');
    expect(order.discount?.authorization.staffId).toBe('gerant-1');
  });

  it('un code PIN tapé il y a un quart d’heure ne couvre plus la remise', () => {
    // Le responsable est reparti en cuisine entre-temps : sa validation a expiré.
    const c = clock();
    const autorisation = gerant(c);
    c.advanceMinutes(15);

    const r = commande().applyDiscount({
      amount: Money.fromCents(200),
      reason: 'geste commercial',
      authorization: autorisation,
      clock: c,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('authorization.required');
  });

  it('la remise est plafonnée si une ligne est annulée après coup', () => {
    // 5 € de geste sur 20 €, puis le tacos à 16,50 € tombe : la caisse ne doit
    // pas finir par devoir de l’argent au client.
    const c = clock();
    let order = unwrap(
      commande().applyDiscount({
        amount: Money.fromCents(500),
        reason: 'geste commercial',
        authorization: gerant(c),
        clock: c,
      }),
    );
    order = unwrap(order.cancelLine(0, 'tombé au sol', gerant(c), c));

    expect(order.subtotal.format()).toBe('3,50 €');
    expect(order.discountAmount.format()).toBe('3,50 €');
    expect(order.total.cents).toBe(0);
  });

  it('une remise en pourcentage est arrondie au profit du client', () => {
    const c = clock();
    // 10 % de 9,95 € = 0,995 € → 0,99 € retenus.
    const remise = unwrap(
      Discount.percentOf(Money.fromCents(995), 10, {
        reason: 'remise étudiants',
        authorization: gerant(c),
      }),
    );

    expect(remise.amount.format()).toBe('0,99 €');
  });

  it('un taux de remise aberrant est refusé', () => {
    const c = clock();
    expect(
      Discount.percentOf(Money.fromCents(2000), 150, {
        reason: 'remise étudiants',
        authorization: gerant(c),
      }).ok,
    ).toBe(false);
  });
});

describe('Order — avancement du service', () => {
  it('l’historique conserve chaque étape avec son auteur', () => {
    const c = clock();
    let order = commande([tacosXXL()], c);
    order = unwrap(order.advanceTo('preparing', 'cuisine-1', c));
    c.advanceMinutes(6);
    order = unwrap(order.advanceTo('ready', 'cuisine-1', c));

    expect(order.history.map((h) => h.status)).toEqual(['new', 'preparing', 'ready']);
    expect(order.history.at(-1)?.at.toISOString()).toBe('2026-06-20T20:20:00.000Z');
  });

  it('le rejeu du statut courant ne double pas l’historique', () => {
    // La file hors ligne renvoie régulièrement deux fois le même événement.
    const c = clock();
    const enCours = unwrap(commande([tacosXXL()], c).advanceTo('preparing', 'cuisine-1', c));
    const rejeu = unwrap(enCours.advanceTo('preparing', 'cuisine-1', c));

    expect(rejeu.history).toHaveLength(2);
    expect(rejeu).toBe(enCours);
  });

  it('une transition illégale est refusée sans modifier la commande', () => {
    const c = clock();
    const order = commande([tacosXXL()], c);
    const r = order.advanceTo('delivered', 'caisse-1', c);

    expect(r.ok).toBe(false);
    expect(order.status).toBe('new');
  });

  it('au retour du réseau, le statut le plus avancé l’emporte', () => {
    // La tablette cuisine a réellement servi la commande pendant la coupure.
    const c = clock();
    const order = commande([tacosXXL()], c);
    const reconcilie = order.reconcile('ready', 'cuisine-1', c);

    expect(reconcilie.status).toBe('ready');
    expect(reconcilie.history.map((h) => h.status)).toEqual(['new', 'ready']);
  });

  it('la réconciliation ne fait jamais reculer une commande', () => {
    const c = clock();
    const prete = unwrap(
      unwrap(commande([tacosXXL()], c).advanceTo('preparing', 'cuisine-1', c)).advanceTo(
        'ready',
        'cuisine-1',
        c,
      ),
    );

    expect(prete.reconcile('preparing', 'caisse-1', c)).toBe(prete);
  });
});
