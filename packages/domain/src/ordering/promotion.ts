import { PromotionRefused } from './errors';
import type { DomainError } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * LES PROMOTIONS, ENFIN APPLIQUÉES.
 *
 * Le back-office savait créer une promotion, la modifier, l'activer d'un clic
 * et la supprimer. Rien, nulle part, ne l'appliquait : `totals.discount` était
 * écrit `null` en dur à la création de chaque commande, et `usageCount` restait
 * à zéro pour toujours.
 *
 * Le défaut est du genre le plus coûteux : le logiciel avait l'air complet. Un
 * restaurateur créait « BIENVENUE10 », l'activait, l'imprimait sur ses flyers —
 * et le code n'était accepté ni en ligne ni au comptoir. Il ne l'apprenait pas
 * d'une erreur : il l'apprenait d'un client au téléphone.
 *
 * ── Pourquoi ce n'est PAS un `Discount` ───────────────────────────────────
 *
 * `Discount` exige une `StaffAuthorization` — un équipier nommé, son PIN
 * vérifié. C'est ce que NF525 veut pouvoir retrouver derrière un geste
 * commercial décidé au comptoir.
 *
 * Une promotion n'est pas ce geste : c'est une règle PUBLIÉE par le
 * restaurateur, que personne au comptoir ne décide. Exiger un équipier serait
 * faux, et en fabriquer un serait pire — l'archive nommerait quelqu'un qui n'a
 * rien décidé. Les deux objets restent donc distincts, et c'est cette
 * distinction que le ticket doit porter.
 *
 * ── Une seule promotion par commande ──────────────────────────────────────
 *
 * Le cumul n'est pas dans ce modèle, et c'est délibéré. Deux promotions qui se
 * composent posent immédiatement trois questions sans réponse évidente : dans
 * quel ordre, sur quelle assiette, et jusqu'à quel plancher. Une règle simple
 * qu'on tient vaut mieux qu'une règle riche qu'on découvre fausse un samedi
 * soir. Le jour où le cumul sera demandé, il se décidera avec ses plafonds.
 */

/** La promotion telle qu'elle est publiée — la forme que le domaine sait lire. */
export interface PromotionRule {
  readonly id: string;
  readonly name: string;
  readonly kind: 'percent' | 'amount' | 'offered_item';
  /** Pourcentage pour `percent`, centimes pour `amount`, ignoré sinon. */
  readonly value: number;
  /** Code à saisir, ou `null` pour une promotion appliquée d'office. */
  readonly code: string | null;
  readonly channels: readonly string[];
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly active: boolean;
  /** Panier minimum, en centimes. `0` = aucune condition. */
  readonly minSubtotalCents: number;
  /** Plafond de la remise, en centimes. `0` = non plafonnée. */
  readonly maxDiscountCents: number;
  /** Nombre d'utilisations autorisées. `0` = illimité. */
  readonly maxUsage: number;
  readonly usageCount: number;
  /** Le produit offert — `offered_item` seulement. */
  readonly offeredProductId: string | null;
}

/** Ce que la commande présente à la règle. */
export interface PromotionContext {
  readonly subtotal: Money;
  readonly channel: string;
  /** Le code saisi par le client, ou `null`. */
  readonly code: string | null;
  readonly now: Date;
  /** Prix unitaire des produits au panier, par identifiant — pour `offered_item`. */
  readonly prixAuPanier: ReadonlyMap<string, Money>;
}

/**
 * Une promotion retenue : le montant, et de quoi l'expliquer sur le ticket.
 *
 * Le libellé n'est pas décoratif. C'est ce qui s'imprime sous le total, ce que
 * le client lit, et ce qu'un contrôle relit six mois plus tard. « Remise » ne
 * dit rien ; « BIENVENUE10 — Offre de bienvenue » se vérifie.
 */
export class PromotionApplication {
  private constructor(
    readonly promotionId: string,
    readonly amount: Money,
    readonly reason: string,
  ) {}

  static of(regle: PromotionRule, amount: Money): PromotionApplication {
    const prefixe = regle.code ? `${regle.code} — ` : '';
    return new PromotionApplication(regle.id, amount, `${prefixe}${regle.name}`);
  }

  toJSON(): { amount: number; reason: string; promotionId: string } {
    return { amount: this.amount.cents, reason: this.reason, promotionId: this.promotionId };
  }
}

/** Comparaison de codes : ni la casse ni les espaces ne doivent faire échouer. */
const memeCode = (a: string | null, b: string | null): boolean =>
  (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/**
 * La promotion s'applique-t-elle, et pour combien ?
 *
 * Chaque refus porte SA raison. Un « code invalide » unique pour six causes
 * différentes fait rappeler le restaurant : le client ne sait pas s'il s'est
 * trompé de code, s'il est trop tôt, ou si son panier est trop petit — et la
 * personne au téléphone ne le sait pas davantage.
 *
 * L'ORDRE DES CONTRÔLES EST CELUI DE L'UTILITÉ, pas celui du champ le moins
 * cher à lire : on vérifie d'abord ce que le client peut corriger (le code, le
 * montant du panier) avant ce qu'il ne peut pas (une promotion expirée).
 */
export function appliquerPromotion(
  regle: PromotionRule,
  contexte: PromotionContext,
): Result<PromotionApplication, DomainError> {
  if (!regle.active) {
    return err(new PromotionRefused('Cette promotion n’est pas active'));
  }

  // Un code publié se saisit ; une promotion sans code s'applique d'office et
  // ne doit surtout pas être « débloquée » par une chaîne vide envoyée au
  // hasard — d'où les deux branches et non une comparaison unique.
  if (regle.code) {
    if (!contexte.code) {
      return err(new PromotionRefused('Cette promotion demande un code'));
    }
    if (!memeCode(regle.code, contexte.code)) {
      return err(new PromotionRefused(`Le code « ${contexte.code.trim()} » ne correspond à aucune offre`));
    }
  }

  if (!regle.channels.includes(contexte.channel)) {
    return err(
      new PromotionRefused(
        contexte.channel === 'online'
          ? 'Cette offre n’est pas valable pour les commandes en ligne'
          : 'Cette offre n’est valable qu’en ligne',
      ),
    );
  }

  const t = contexte.now.getTime();
  if (regle.startsAt && t < regle.startsAt.getTime()) {
    return err(new PromotionRefused('Cette offre n’a pas encore commencé'));
  }
  // Comparaison stricte sur la BORNE HAUTE : une offre « jusqu'au 31 » se
  // termine à la fin du 31, et c'est la date stockée qui porte cette heure.
  if (regle.endsAt && t >= regle.endsAt.getTime()) {
    return err(new PromotionRefused('Cette offre est terminée'));
  }

  if (regle.maxUsage > 0 && regle.usageCount >= regle.maxUsage) {
    return err(new PromotionRefused('Cette offre a atteint son nombre d’utilisations'));
  }

  if (regle.minSubtotalCents > 0 && contexte.subtotal.cents < regle.minSubtotalCents) {
    const manque = Money.fromCents(regle.minSubtotalCents);
    return err(new PromotionRefused(`Cette offre demande une commande d’au moins ${manque.format()}`));
  }

  const brut = montantBrut(regle, contexte);
  if (!brut.ok) return brut;

  // Trois bornes, dans cet ordre : le plafond de l'offre, puis le sous-total.
  //
  // La seconde n'est pas une précaution de style. Une remise supérieure au
  // panier produirait un total négatif — que l'encaissement lirait comme une
  // somme à RENDRE au client. Un « −20 € » sur une commande à 12 € est une
  // erreur de saisie du restaurateur, jamais huit euros à sortir du tiroir.
  let montant = brut.value;
  if (regle.maxDiscountCents > 0 && montant.cents > regle.maxDiscountCents) {
    montant = Money.fromCents(regle.maxDiscountCents);
  }
  if (montant.cents > contexte.subtotal.cents) {
    montant = contexte.subtotal;
  }

  if (montant.isZero()) {
    return err(new PromotionRefused('Cette offre ne change rien à cette commande'));
  }

  return ok(PromotionApplication.of(regle, montant));
}

/** Le montant avant plafonnement — la part qui dépend de la nature de l'offre. */
function montantBrut(
  regle: PromotionRule,
  contexte: PromotionContext,
): Result<Money, DomainError> {
  switch (regle.kind) {
    case 'percent': {
      if (!Number.isFinite(regle.value) || regle.value <= 0 || regle.value > 100) {
        return err(new PromotionRefused(`Taux de remise invalide : ${regle.value} %`));
      }
      // `Money.percent` arrondit en faveur du client — même sens que la remise
      // fondateur du CRM. Deux arrondis contraires dans le même produit
      // finissent par produire deux totaux pour la même commande.
      return ok(contexte.subtotal.percent(regle.value));
    }

    case 'amount': {
      if (!Number.isInteger(regle.value) || regle.value <= 0) {
        return err(new PromotionRefused(`Montant de remise invalide : ${regle.value}`));
      }
      return ok(Money.fromCents(regle.value));
    }

    case 'offered_item': {
      // Le produit offert doit être DÉSIGNÉ et PRÉSENT au panier. Sans le
      // premier, la nature était inapplicable par construction — le modèle ne
      // disait pas quoi offrir. Sans le second, on offrirait un article que le
      // client n'a pas pris, ce qui n'est pas un cadeau mais une erreur de
      // caisse.
      if (!regle.offeredProductId) {
        return err(new PromotionRefused('Cette offre n’indique pas quel produit est offert'));
      }
      const prix = contexte.prixAuPanier.get(regle.offeredProductId);
      if (!prix) {
        return err(new PromotionRefused('Le produit offert par cette offre n’est pas dans la commande'));
      }
      return ok(prix);
    }
  }
}
