import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EncaissementController } from './encaissement.controller';
import { ENCAISSEMENT_CONFIG, EncaissementService, type EncaissementConfig } from './encaissement.service';
import { STRIPE_CONNECT_CLIENT, StripeConnectHttpClient } from './stripe-connect.client';

/**
 * ENCAISSEMENT MARCHAND — le sous-domaine « où va l'argent ».
 *
 * Module à part, et pas un dossier de plus dans `ordering` : le raccordement
 * d'un compte marchand a son propre vocabulaire (dossier déposé, vérification,
 * restriction), son propre rythme (des jours, pas des minutes) et sa propre
 * source de vérité (Stripe). `ordering` ne lui demande qu'UNE chose, par une
 * interface étroite — `compteActifDe(tenantId)` — d'où l'export du seul
 * service.
 *
 * L'URL de retour est CONSTRUITE ici, à partir de l'origine publique du
 * back-office : elle diffère entre staging et production, et un lien de retour
 * codé en dur renverrait un restaurateur de production sur l'environnement de
 * test — avec un compte Stripe bien réel au bout.
 */
@Module({
  controllers: [EncaissementController],
  providers: [
    EncaissementService,
    {
      provide: STRIPE_CONNECT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new StripeConnectHttpClient(config.get<string>('STRIPE_SECRET_KEY') ?? null),
    },
    {
      provide: ENCAISSEMENT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EncaissementConfig => ({
        retourUrl: `${(config.get<string>('WEB_PUBLIC_URL') ?? 'https://app.snackmanager.fr').replace(/\/+$/, '')}/admin/encaissement`,
      }),
    },
  ],
  exports: [EncaissementService],
})
export class EncaissementModule {}
