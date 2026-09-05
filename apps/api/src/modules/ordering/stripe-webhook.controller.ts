import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/auth';
import { PaymentsService } from './payments.service';

/**
 * WEBHOOK STRIPE — le chaînon qui confirme une commande payée en ligne.
 *
 * Sans lui, le client paie, Stripe encaisse, et la commande reste « en attente »
 * pour l'éternité : la cuisine ne la voit jamais confirmée. Le navigateur du
 * client ne peut pas jouer ce rôle (onglet fermé, réseau coupé, ou simplement
 * quelqu'un qui appelle l'API en prétendant avoir payé) — seul Stripe, signature
 * à l'appui, fait foi.
 *
 * ─── Développement local ───
 *
 *   stripe login
 *   stripe listen --forward-to localhost:3001/public/stripe/webhook
 *
 * `stripe listen` affiche au démarrage un secret « whsec_… » : c'est celui-ci,
 * et pas celui du tableau de bord, qu'il faut mettre dans `STRIPE_WEBHOOK_SECRET`
 * du `.env` puis relancer l'API. Il change à chaque `stripe listen`.
 *
 * Une fixture générique avec metadata.orderId ne confirme PAS une commande :
 * l'identifiant PaymentIntent, le compte et le montant doivent correspondre
 * exactement au paiement enregistré par l'application.
 * Pour vérifier le parcours : créer la commande, appeler
 * `POST /public/orders/:id/payment-intent`, payer avec la carte de test
 * `4242 4242 4242 4242` — les métadonnées sont alors posées par
 * `PaymentsService.resolveIntent`.
 *
 * ─── En production ───
 *
 * Tableau de bord Stripe → Developers → Webhooks → endpoint
 * `https://<api>/public/stripe/webhook`, événements `payment_intent.succeeded`
 * et `payment_intent.payment_failed`, ainsi que `charge.refunded`,
 * `refund.created`, `refund.updated`, `refund.failed`, puis reporter le secret.
 *
 * ─── Câblage ───
 *
 * Comme tout contrôleur Nest, celui-ci n'existe que s'il est déclaré : il doit
 * figurer dans `controllers` d'`OrderingModule` (aux côtés d'`OrderingController`),
 * qui fournit déjà `PaymentsService`. Sans cette ligne, la route répond 404 et
 * les commandes payées en ligne restent « en attente » sans le moindre message
 * d'erreur — la panne exacte que ce fichier existe pour éviter.
 *
 * ─── Contrat de réponse ───
 *
 *  · 200 — événement reçu, y compris quand il est ignoré (rejeu, type non
 *    traité, commande introuvable). Tout autre code ferait rejouer Stripe
 *    pendant trois jours pour un problème qu'un rejeu ne réglera jamais.
 *  · 400 — signature absente, invalide, ou horodatage hors tolérance.
 *  · 503 — `STRIPE_WEBHOOK_SECRET` non configurée. On refuse proprement plutôt
 *    que de planter, et Stripe rejouera une fois la variable posée.
 */
@Controller()
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Route PUBLIQUE : Stripe n'a pas de JWT. L'authentification, ici, c'est la
   * signature HMAC du corps — vérifiée avant toute lecture du contenu.
   *
   * `req.rawBody` est peuplé par `NestFactory.create(AppModule, { rawBody: true })`
   * (voir `main.ts`). C'est indispensable : le HMAC porte sur les octets exacts
   * envoyés par Stripe, et un corps déjà parsé puis re-sérialisé ne donne jamais
   * la même empreinte — la vérification échouerait à chaque appel.
   */
  @Public()
  @HttpCode(200)
  @Post('public/stripe/webhook')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const event = this.payments.constructWebhookEvent(req.rawBody, signature);
    return this.payments.handleWebhookEvent(event);
  }
}
