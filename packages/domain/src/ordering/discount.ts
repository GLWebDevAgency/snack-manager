import type { StaffAuthorization } from './authorization';
import { InvalidDiscount } from './errors';
import { AuthorizationRequired, type DomainError } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Remise accordée sur une commande.
 *
 * Trois choses indissociables, et c'est tout l'intérêt du value object :
 * un MONTANT, un MOTIF et une IDENTITÉ. Une remise anonyme, c'est un écart de
 * caisse qu'aucun inventaire ne rattrape ; une remise sans motif, c'est un
 * contrôle NF525 qui tourne mal. On refuse de construire l'objet plutôt que de
 * laisser passer une remise incomplète que personne ne saura expliquer.
 *
 * Le plafond (« pas plus que le sous-total ») n'est PAS ici : il dépend de la
 * commande, qui seule connaît ses lignes actives.
 */
export class Discount {
  private constructor(
    readonly amount: Money,
    readonly reason: string,
    readonly authorization: StaffAuthorization,
  ) {}

  /** Un motif tapé à la va-vite (« ok », « x ») ne trace rien. */
  private static readonly MIN_REASON_LENGTH = 3;

  static create(input: {
    amount: Money;
    reason: string;
    authorization: StaffAuthorization | null;
    /**
     * Ce que le valideur a le DROIT d'accorder, en centimes. `null` = pas de
     * plafond (le gérant), `0` = aucune remise autorisée (la cuisine).
     *
     * Absent, il vaut « pas de plafond » — pour les appelants d'avant cette
     * règle, qui n'en avaient aucun. Le contrôle est ici, dans le value object,
     * et non dans le service : c'est le seul endroit par lequel une remise peut
     * naître, et une règle d'argent posée ailleurs finit contournée par le
     * prochain appelant.
     *
     * Re-saisir un PIN prouve QUI agit, jamais que cette personne en a le
     * droit. Les deux contrôles sont distincts, et il manquait le second : tout
     * PIN actif du restaurant, cuisine comprise, pouvait offrir la commande
     * entière.
     */
    plafondCents?: number | null;
  }): Result<Discount, DomainError> {
    if (!input.authorization) {
      return err(new AuthorizationRequired('remise'));
    }

    const plafond = input.plafondCents;
    if (plafond === 0) {
      return err(new AuthorizationRequired('remise'));
    }
    if (typeof plafond === 'number' && input.amount.cents > plafond) {
      return err(
        new InvalidDiscount(
          `Remise de ${input.amount.format()} au-delà de ce que ce code autorise (${Money.fromCents(plafond).format()}) — demandez au gérant`,
        ),
      );
    }

    const reason = input.reason.trim();
    if (reason.length < Discount.MIN_REASON_LENGTH) {
      return err(
        new InvalidDiscount('Motif de remise obligatoire (geste commercial, erreur de préparation…)'),
      );
    }

    if (input.amount.isZero() || input.amount.isNegative()) {
      return err(new InvalidDiscount(`Montant de remise invalide : ${input.amount.format()}`));
    }

    return ok(new Discount(input.amount, reason, input.authorization));
  }

  /** Remise en pourcentage (« -10 % étudiants ») — arrondie au profit du client. */
  static percentOf(
    subtotal: Money,
    rate: number,
    input: {
      reason: string;
      authorization: StaffAuthorization | null;
      plafondCents?: number | null;
    },
  ): Result<Discount, DomainError> {
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      return err(new InvalidDiscount(`Taux de remise invalide : ${rate} %`));
    }

    return Discount.create({ amount: subtotal.percent(rate), ...input });
  }

  toJSON(): { amount: number; reason: string; staffId: string; pinVerifiedAt: string } {
    return {
      amount: this.amount.cents,
      reason: this.reason,
      ...this.authorization.toJSON(),
    };
  }
}
