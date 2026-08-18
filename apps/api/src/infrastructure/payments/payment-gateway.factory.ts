import { Logger } from '@nestjs/common';
import type { PaymentGateway } from '@sm/domain/src/ports';

import { readNonEmpty, type ConfigSource } from '../config-source';
import type { FactoryLogger } from '../factory-logger';
import { NullPaymentGateway } from './null-payment-gateway';
import { StripePaymentGateway } from './stripe-payment-gateway';

/**
 * Choix de la passerelle de paiement.
 *
 * Pas de variable `PAYMENT_PROVIDER` : la présence de `STRIPE_SECRET_KEY` dit
 * déjà tout ce qu'il y a à savoir. Un deuxième interrupteur créerait la panne
 * classique — clé renseignée, interrupteur oublié, et personne ne comprend
 * pourquoi le bouton « payer en ligne » ne s'affiche pas.
 *
 * Comme la fabrique de registrars, celle-ci NE LÈVE JAMAIS : sans Stripe, on
 * encaisse au comptoir.
 */
export function createPaymentGateway(
  get: ConfigSource,
  logger: FactoryLogger = new Logger('PaymentGatewayFactory'),
): PaymentGateway {
  const key = readNonEmpty(get, 'STRIPE_SECRET_KEY');

  if (!key) {
    logger.log('Paiement en ligne : désactivé (règlement au comptoir uniquement)');
    return new NullPaymentGateway();
  }

  logger.log('Paiement en ligne : Stripe');
  return new StripePaymentGateway(key);
}
