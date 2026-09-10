import { Inject, Injectable } from '@nestjs/common';
import webpush from 'web-push';
import { isOrderPushEndpoint, orderPushTarget, type OrderPushSubscription } from '@sm/contracts';
import { ORDER_PUSH_CONFIG, type OrderPushConfig } from './order-push.crypto';

export type PushOutcome = 'sent' | 'expired' | 'retry';

@Injectable()
export class OrderPushSender {
  constructor(@Inject(ORDER_PUSH_CONFIG) private readonly config: OrderPushConfig | null) {}

  async send(subscription: OrderPushSubscription, slug: string): Promise<PushOutcome> {
    if (!this.config || !isOrderPushEndpoint(subscription.endpoint)) return 'expired';
    try {
      // web-push utilise https.request, sans suivre les réponses de redirection.
      // La preuve de suivi et les données du ticket ne quittent jamais l'API.
      await webpush.sendNotification(subscription, JSON.stringify({
        title: 'Votre commande est prête',
        body: 'Consultez le suivi de votre commande.',
        path: orderPushTarget(slug),
        tag: 'sm-order-ready',
      }), {
        vapidDetails: { subject: this.config.subject, publicKey: this.config.publicKey, privateKey: this.config.privateKey },
        TTL: 900,
        timeout: 10_000,
        urgency: 'normal',
      });
      return 'sent';
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : null;
      // Ne pas journaliser l'erreur fournisseur : elle peut contenir l'URL secrète.
      return status === 404 || status === 410 || (typeof status === 'number' && status >= 300 && status < 400) ? 'expired' : 'retry';
    }
  }
}
