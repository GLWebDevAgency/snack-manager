import { Money, TenantSlug, unwrap } from '@sm/domain';
// `OrderNumber` vit dans le sous-domaine COMMANDE, non réexporté par la racine.
import { OrderNumber } from '@sm/domain/src/ordering';
import type { PaymentReference } from '@sm/domain/src/ports';
import { describe, expect, it } from 'vitest';

import type { FactoryLogger } from '../factory-logger';
import { NullPaymentGateway } from './null-payment-gateway';
import { createPaymentGateway } from './payment-gateway.factory';
import { StripePaymentGateway } from './stripe-payment-gateway';

/**
 * Une seule règle est testée ici, et c'est la plus importante du module :
 * l'absence de paiement en ligne n'est JAMAIS une erreur. Le comptoir encaisse
 * depuis toujours, et un snack qui découvre le produit n'ouvrira pas un compte
 * Stripe avant de l'avoir essayé.
 */

const REFERENCE: PaymentReference = {
  tenant: unwrap(TenantSlug.create('classfood')),
  orderId: '665f0d0a1c2b3d4e5f6a7b8c',
  orderNumber: unwrap(OrderNumber.create(42)),
};

function recorder(): FactoryLogger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m) };
}

describe('NullPaymentGateway', () => {
  it('annonce que le paiement en ligne n’est pas configuré, sans échouer', async () => {
    const gateway = new NullPaymentGateway();

    const attempt = await gateway.createIntent(REFERENCE, Money.fromCents(1250), {});

    expect(attempt.available).toBe(false);
    if (!attempt.available) {
      expect(attempt.reason).toBe('Paiement en ligne non configuré');
    }
  });

  it('renvoie au comptoir pour un remboursement', async () => {
    const refund = await new NullPaymentGateway().refund('peu-importe', Money.fromCents(500), 'geste');

    expect(refund.available).toBe(false);
    if (!refund.available) expect(refund.reason).toContain('comptoir');
  });
});

describe('StripePaymentGateway', () => {
  it('refuse un montant sous le plancher facturable plutôt que de laisser Stripe le rejeter', async () => {
    // Un supplément sauce à 0,30 € : Stripe refuserait sous les 50 centimes, et
    // le client verrait l'échec au moment de payer, pas avant.
    const gateway = new StripePaymentGateway('sk_test_peu_importe');

    const attempt = await gateway.createIntent(REFERENCE, Money.fromCents(30), {});

    expect(attempt.available).toBe(false);
    if (!attempt.available) expect(attempt.reason).toContain('trop faible');
  });

  it('se déclare non configurée sans clé secrète', async () => {
    const gateway = new StripePaymentGateway(null);

    expect(gateway.isConfigured()).toBe(false);
    const attempt = await gateway.createIntent(REFERENCE, Money.fromCents(1250), {});
    expect(attempt.available).toBe(false);
  });

  it('dégrade proprement quand le paquet « stripe » n’est pas installé', async () => {
    // C'est l'état actuel du dépôt : la clé peut être posée, le paquet absent.
    // L'import dynamique échoue, on le journalise, et la commande reste payable
    // au comptoir.
    const gateway = new StripePaymentGateway('sk_test_peu_importe');

    const attempt = await gateway.createIntent(REFERENCE, Money.fromCents(1250), {});

    expect(attempt.available).toBe(false);
    if (!attempt.available) {
      expect(attempt.reason).toMatch(/non configuré|indisponible/);
    }
  });
});

describe('createPaymentGateway', () => {
  it('encaisse au comptoir quand STRIPE_SECRET_KEY est absente', () => {
    const gateway = createPaymentGateway(() => undefined, recorder());

    expect(gateway).toBeInstanceOf(NullPaymentGateway);
    expect(gateway.providerName).toBe('aucun');
  });

  it('choisit Stripe dès que la clé est présente, sans second interrupteur', () => {
    // Pas de `PAYMENT_PROVIDER` : la clé renseignée SUFFIT. Un deuxième
    // réglage produirait la panne classique — clé posée, interrupteur oublié.
    const gateway = createPaymentGateway(
      (key) => (key === 'STRIPE_SECRET_KEY' ? 'sk_live_x' : undefined),
      recorder(),
    );

    expect(gateway).toBeInstanceOf(StripePaymentGateway);
  });

  it('traite une clé blanche comme absente', () => {
    const gateway = createPaymentGateway(
      (key) => (key === 'STRIPE_SECRET_KEY' ? '   ' : undefined),
      recorder(),
    );

    expect(gateway).toBeInstanceOf(NullPaymentGateway);
  });
});
