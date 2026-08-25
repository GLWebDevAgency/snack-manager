import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { Public } from '../../common/auth';
import { verifierEvenementStripe } from '../../common/stripe-signature';
import { EncaissementService } from '../encaissement/encaissement.service';
import { PaymentsService, type WebhookResult } from './payments.service';

/**
 * WEBHOOK DES COMPTES CONNECTÉS — le second point d'entrée, et il n'est pas
 * optionnel.
 *
 * ─── POURQUOI DEUX WEBHOOKS ───
 *
 * En CHARGES DIRECTES, le paiement d'une commande est créé sur le compte du
 * RESTAURANT : Stripe émet donc `payment_intent.succeeded` sur ce compte-là,
 * et cet événement part vers le point d'entrée « Connect » du tableau de bord,
 * signé avec un secret DIFFÉRENT de celui de la plateforme.
 *
 * Sans cette route, le client paie, le restaurant encaisse… et la commande
 * reste « en attente » pour l'éternité : la cuisine ne la voit jamais
 * confirmée. C'est la panne exacte que ce fichier existe pour éviter — la même
 * que celle décrite dans `stripe-webhook.controller.ts`, mais pour l'argent
 * qui va vraiment chez le restaurateur.
 *
 * ─── DEUX FAMILLES D'ÉVÉNEMENTS, UN SEUL POINT D'ENTRÉE ───
 *
 *  · `account.updated` — Stripe a changé d'avis sur ce qu'un marchand peut
 *    faire (dossier accepté, pièce rejetée). C'est LA source de vérité de
 *    l'encaissement : on recopie ses drapeaux, on ne les devine jamais.
 *  · `account.application.deauthorized` — le restaurateur nous a débranchés
 *    depuis son tableau de bord. C'est le SEUL événement émis dans ce cas, et
 *    plus aucun `account.updated` ne suivra : sans lui, nos drapeaux
 *    resteraient « actif » pour toujours et chaque client verrait son paiement
 *    échouer au dernier clic.
 *  · tout le reste (`payment_intent.*`) — c'est le paiement d'une commande :
 *    il repart dans la MÊME machine à états que les paiements de plateforme
 *    (`PaymentsService.handleWebhookEvent`), qui sait déjà être idempotente
 *    face aux rejeux. Dupliquer cette logique ici serait se condamner à
 *    corriger les bugs deux fois.
 *
 * ─── CONFIGURATION ───
 *
 * Tableau de bord Stripe → Developers → Webhooks → **Connected accounts** →
 * `https://<api>/public/stripe/webhook/connect`, événements
 * `account.updated`, `account.application.deauthorized`,
 * `payment_intent.succeeded`, `payment_intent.payment_failed`,
 * puis reporter le secret dans `STRIPE_CONNECT_WEBHOOK_SECRET`.
 *
 * En local : `stripe listen --forward-connect-to localhost:3001/public/stripe/webhook/connect`
 * — l'option `--forward-connect-to`, et non `--forward-to`, sinon les
 * événements des comptes connectés ne sortent jamais.
 *
 * ─── CONTRAT DE RÉPONSE ───
 *
 * Identique au webhook de plateforme : 200 même quand l'événement est ignoré
 * (tout autre code ferait rejouer Stripe trois jours durant pour un problème
 * qu'aucun rejeu ne règle), 400 sur signature invalide, 503 si le secret
 * manque.
 */
@Controller()
export class StripeConnectWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly encaissement: EncaissementService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('public/stripe/webhook/connect')
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookResult> {
    const secret = this.config.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Webhook des comptes connectés non configuré : renseigner STRIPE_CONNECT_WEBHOOK_SECRET côté API.',
      );
    }

    const event = verifierEvenementStripe(request.rawBody, signature, secret);

    if (event.type === 'account.application.deauthorized') {
      if (event.account) await this.encaissement.revoquer(event.account);
      return {
        received: true,
        outcome: 'ignoree',
        message: event.account
          ? `Compte ${event.account} débranché — encaissement fermé.`
          : 'Révocation sans identifiant de compte — ignorée.',
      };
    }

    if (event.type === 'account.updated') {
      // `event.account` est l'identifiant du compte connecté concerné. Absent,
      // l'événement ne désigne personne : on accuse réception sans rien faire
      // plutôt que de laisser Stripe rejouer un événement inexploitable.
      if (event.account) await this.encaissement.synchroniser(event.account);
      return {
        received: true,
        outcome: 'ignoree',
        message: event.account
          ? `Compte ${event.account} resynchronisé.`
          : 'Événement de compte sans identifiant — ignoré.',
      };
    }

    return this.payments.handleWebhookEvent(event);
  }
}
