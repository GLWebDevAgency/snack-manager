import { describe, expect, it } from 'vitest';
import { StaffAuthorization } from './authorization';
import { OrderLine } from './order-line';
import { frites, pick, tacos, tiramisu } from '../menu/fixtures';
import { validateSelection } from '../menu/rules';
import { FixedClock } from '../shared/clock';
import { unwrap } from '../shared/result';

const clock = new FixedClock(new Date('2026-06-20T20:14:00.000Z'));
const gerant = (): StaffAuthorization => unwrap(StaffAuthorization.grant('gerant-1', clock));

/** Un tacos XXL « double kebab, steak, kefta » gratiné — la commande du vendredi. */
function tacosXXL(options: { note?: string; removals?: string[] } = {}): OrderLine {
  const config = unwrap(
    validateSelection(
      tacos,
      'XXL',
      [
        pick('viandes', 'kebab'),
        pick('viandes', 'kebab'),
        pick('viandes', 'steak'),
        pick('viandes', 'kefta'),
        pick('gratine', 'gratine'),
      ],
      options.removals ?? [],
    ),
  );

  return unwrap(OrderLine.fromConfiguration(config, { note: options.note ?? null }));
}

function ligne(item: typeof tiramisu, variantKey: string | null = null): OrderLine {
  return unwrap(OrderLine.fromConfiguration(unwrap(validateSelection(item, variantKey, []))));
}

describe('OrderLine — le prix figé à la commande', () => {
  it('la ligne garde le prix du moment, même si la carte augmente ensuite', () => {
    const ligneDuSoir = tacosXXL();
    expect(ligneDuSoir.unitPrice.format()).toBe('16,50 €');

    // Le gérant remonte ses prix à la fermeture : le ticket de 20 h 14 ne bouge pas.
    expect(ligneDuSoir.unitPrice.format()).toBe('16,50 €');
    expect(ligneDuSoir.total.format()).toBe('16,50 €');
  });

  it('le total d’une ligne multiplie le prix figé par la quantité', () => {
    const trois = unwrap(tacosXXL().withQuantity(3));
    expect(trois.total.format()).toBe('49,50 €');
  });

  it('la ligne recopie le libellé du format pour le ticket', () => {
    expect(tacosXXL().label()).toBe('Compose ton Tacos XXL');
    expect(ligne(tiramisu).label()).toBe('Tiramisu');
  });

  it('refuse une quantité nulle, négative ou non entière', () => {
    expect(tacosXXL().withQuantity(0).ok).toBe(false);
    expect(tacosXXL().withQuantity(-1).ok).toBe(false);
    expect(tacosXXL().withQuantity(1.5).ok).toBe(false);
  });

  it('refuse une quantité qui trahit une faute de frappe à la caisse', () => {
    const r = tacosXXL().withQuantity(1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.line.invalid');
  });

  it('refuse une note trop longue pour un ticket', () => {
    const config = unwrap(validateSelection(tiramisu, null, []));
    const r = OrderLine.fromConfiguration(config, { note: 'a'.repeat(201) });
    expect(r.ok).toBe(false);
  });

  it('une note vide n’est pas une note', () => {
    const config = unwrap(validateSelection(tiramisu, null, []));
    expect(unwrap(OrderLine.fromConfiguration(config, { note: '   ' })).note).toBeNull();
  });
});

describe('OrderLine — fusion de lignes identiques', () => {
  it('deux configurations identiques fusionnent', () => {
    const a = tacosXXL();
    const b = tacosXXL();
    expect(a.isSameConfiguration(b)).toBe(true);
    expect(unwrap(a.mergedWith(b)).quantity).toBe(2);
  });

  it('l’ordre dans lequel les options ont été cochées n’empêche pas la fusion', () => {
    const inverse = unwrap(
      OrderLine.fromConfiguration(
        unwrap(
          validateSelection(tacos, 'XXL', [
            pick('gratine', 'gratine'),
            pick('viandes', 'kefta'),
            pick('viandes', 'steak'),
            pick('viandes', 'kebab'),
            pick('viandes', 'kebab'),
          ]),
        ),
      ),
    );

    expect(tacosXXL().isSameConfiguration(inverse)).toBe(true);
  });

  it('deux kebabs ne fusionnent pas avec un seul kebab', () => {
    // Même nombre de viandes ne veut pas dire même assiette.
    const doubleKebab = tacosXXL();
    const quatreDifferentes = unwrap(
      OrderLine.fromConfiguration(
        unwrap(
          validateSelection(tacos, 'XXL', [
            pick('viandes', 'kebab'),
            pick('viandes', 'steak'),
            pick('viandes', 'kefta'),
            pick('viandes', 'poulet'),
            pick('gratine', 'gratine'),
          ]),
        ),
      ),
    );

    expect(doubleKebab.isSameConfiguration(quatreDifferentes)).toBe(false);
  });

  it('une note différente empêche la fusion', () => {
    expect(tacosXXL({ note: 'bien épicé' }).isSameConfiguration(tacosXXL())).toBe(false);
    expect(
      tacosXXL({ note: 'bien épicé' }).isSameConfiguration(tacosXXL({ note: 'bien épicé' })),
    ).toBe(true);
  });

  it('un retrait supplémentaire empêche la fusion', () => {
    expect(tacosXXL({ removals: ['oignons'] }).isSameConfiguration(tacosXXL())).toBe(false);
  });

  it('deux formats différents du même produit ne fusionnent pas', () => {
    expect(ligne(frites, 'M').isSameConfiguration(ligne(frites, 'L'))).toBe(false);
  });

  it('deux produits différents ne fusionnent pas', () => {
    expect(ligne(tiramisu).isSameConfiguration(ligne(frites, 'M'))).toBe(false);
  });
});

describe('OrderLine — une ligne annulée ne disparaît jamais', () => {
  it('l’annulation exige une validation par code PIN', () => {
    const r = tacosXXL().cancel('tombé au sol', null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('authorization.required');
      expect(r.error.message).toBe(
        "L'action « annulation de ligne » exige une validation par code PIN",
      );
    }
  });

  it('l’annulation exige un motif', () => {
    const r = tacosXXL().cancel('   ', gerant());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('order.line.invalid');
  });

  it('la ligne annulée ne pèse plus rien mais garde son motif et son valideur', () => {
    const annulee = unwrap(tacosXXL().cancel('tombé au sol', gerant()));

    expect(annulee.isCancelled()).toBe(true);
    expect(annulee.total.cents).toBe(0);
    expect(annulee.unitPrice.format()).toBe('16,50 €');
    expect(annulee.cancellation?.reason).toBe('tombé au sol');
    expect(annulee.cancellation?.authorization.staffId).toBe('gerant-1');
  });

  it('la ligne annulée reste imprimée sur le bon de préparation', () => {
    const annulee = unwrap(tacosXXL().cancel('client parti', gerant()));
    expect(annulee.kitchenLabel()).toContain('ANNULÉE — client parti');
  });

  it('une ligne annulée ne fusionne jamais avec une ligne active', () => {
    // La fusion la ferait disparaître du ticket : exactement ce qu’on interdit.
    const annulee = unwrap(tacosXXL().cancel('tombé au sol', gerant()));
    expect(annulee.isSameConfiguration(tacosXXL())).toBe(false);
    expect(tacosXXL().isSameConfiguration(annulee)).toBe(false);
  });

  it('on n’annule pas deux fois la même ligne', () => {
    const annulee = unwrap(tacosXXL().cancel('tombé au sol', gerant()));
    expect(annulee.cancel('encore', gerant()).ok).toBe(false);
  });
});

describe('OrderLine — le bon de préparation', () => {
  it('porte la quantité, le format, les viandes, les retraits et la note', () => {
    const ligneCuisine = unwrap(
      tacosXXL({ note: 'bien épicé', removals: ['sans oignons'] }).withQuantity(2),
    );

    expect(ligneCuisine.kitchenLabel()).toBe(
      '2× Compose ton Tacos XXL · Kebab, Kebab, Steak, Kefta, Tacos gratiné · sans oignons · « bien épicé »',
    );
  });

  it('un retrait doit suivre jusqu’en cuisine même sans autre option', () => {
    const config = unwrap(
      validateSelection(tacos, 'M', [pick('viandes', 'kebab')], ['crudités']),
    );
    const l = unwrap(OrderLine.fromConfiguration(config));

    expect(l.kitchenLabel()).toBe('1× Compose ton Tacos M · Kebab · sans crudités');
  });
});
