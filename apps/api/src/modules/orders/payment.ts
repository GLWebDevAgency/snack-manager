import { BadRequestException } from '@nestjs/common';
import type {
  CreateOrderPayment,
  OrderChannel,
  PaymentMethod,
  PaymentStatus,
  PaymentTender,
} from '@sm/contracts';

/**
 * Modèle de paiement d'une commande à sa création.
 *
 * Le défaut corrigé ici : le POS encaissait par carte, l'écran affichait
 * « Payé (carte bancaire) » et la base enregistrait `method=counter` +
 * `status=pending`. La clôture de caisse et la comptabilité étaient donc
 * fausses dès la première commande du service.
 *
 * Deux notions distinctes, longtemps confondues :
 *  - `method` : OÙ l'argent est encaissé (`online` | `counter`) ;
 *  - `tender` : AVEC QUOI le client a payé (`cash` | `card` | `meal_voucher` | `online`).
 *
 * Règle métier : au comptoir (canal `pos` ou `phone`), l'argent est perçu au
 * moment de l'encaissement, pas à la remise du plat — un tender espèces,
 * carte ou titre-restaurant rend donc la commande `paid` immédiatement. Le paiement en ligne, lui,
 * reste `pending` jusqu'à confirmation Stripe : tant que la banque n'a pas
 * répondu, rien n'est encaissé.
 */

/** Canaux où l'argent est perçu au comptoir, à la commande. */
const COUNTER_CHANNELS: readonly OrderChannel[] = ['pos', 'phone'];

/** Tenders réglés sur-le-champ face au client. */
const IMMEDIATE_TENDERS: readonly PaymentTender[] = ['cash', 'card', 'meal_voucher'];

export interface ResolvedPayment {
  method: PaymentMethod;
  tender: PaymentTender | null;
  status: PaymentStatus;
  /** Centimes — `null` hors paiement espèces. */
  cashReceived: number | null;
  changeGiven: number | null;
}

/**
 * Résout le paiement à enregistrer pour une commande qui vient d'être chiffrée.
 *
 * @param channel canal de la commande (le POS ne peut pas mentir : il vient de la route)
 * @param payment bloc `payment` du DTO validé
 * @param total   total résolu par le serveur depuis le menu, en centimes
 */
export function resolvePayment(
  channel: OrderChannel,
  payment: CreateOrderPayment,
  total: number,
): ResolvedPayment {
  const tender = normalizeTender(payment);
  const paidAtCounter =
    COUNTER_CHANNELS.includes(channel) && tender !== null && IMMEDIATE_TENDERS.includes(tender);

  const cash = resolveCash(tender, payment.cashReceived, total);

  return {
    method: payment.method,
    tender,
    status: paidAtCounter ? 'paid' : 'pending',
    ...cash,
  };
}

/**
 * Un paiement `method: 'online'` est un tender « en ligne » par construction :
 * le POS n'a pas à le dire, et un client ne peut pas s'auto-déclarer payé en
 * espèces sur la route publique — le statut reste `pending` de toute façon.
 */
function normalizeTender(payment: CreateOrderPayment): PaymentTender | null {
  if (payment.method === 'online') return 'online';
  return payment.tender ?? null;
}

/**
 * Rendu monnaie. Le montant reçu est la seule donnée que le caissier constate ;
 * le rendu s'en déduit et n'est JAMAIS repris du client (la file offline rejoue
 * un corps calculé avec un total qui a pu changer entre-temps).
 */
function resolveCash(
  tender: PaymentTender | null,
  cashReceived: number | undefined,
  total: number,
): { cashReceived: number | null; changeGiven: number | null } {
  if (tender !== 'cash' || cashReceived === undefined) {
    return { cashReceived: null, changeGiven: null };
  }
  if (cashReceived < total) {
    throw new BadRequestException(
      `Montant reçu insuffisant : ${cashReceived} centimes pour un total de ${total}`,
    );
  }
  return { cashReceived, changeGiven: cashReceived - total };
}
