import 'reflect-metadata';
import { setDefaultAutoSelectFamily } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Repli IPv6 → IPv4 (« happy eyeballs ») imposé à TOUT le processus : les
  // adaptateurs maison passent par `fetchV4` (voir infrastructure/http-v4.ts),
  // mais les SDK tiers (Sentry…) gardent leur propre transport — sur un
  // conteneur Railway sans sortie IPv6, un hôte en double pile les casserait
  // du même « fetch failed » que ntfy le 24/08.
  setDefaultAutoSelectFamily(true);
  // `rawBody: true` conserve les octets bruts de la requête dans `req.rawBody`,
  // EN PLUS du corps parsé habituel : aucune route existante ne change de
  // comportement. C'est la seule façon de vérifier une signature de webhook
  // Stripe — le HMAC porte sur les octets exacts reçus, et un JSON re-sérialisé
  // (ordre des clés, espaces, échappements unicode) donne une autre empreinte,
  // donc un webhook rejeté à chaque appel. Voir
  // `modules/ordering/stripe-webhook.controller.ts`.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // Derrière le proxy Railway, `req.ip` serait l'adresse DU PROXY pour tout le
  // monde : la limitation de débit et le limiteur du guichet d'erreurs
  // puniraient la planète entière pour un seul abuseur. `trust proxy` fait
  // lire la vraie adresse dans X-Forwarded-For (premier saut uniquement).
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    1,
  );
  // `exposedHeaders` : sans lui, un fetch inter-origines ne PEUT PAS lire
  // Content-Disposition — les téléchargements (devis PDF, exports CSV)
  // retombaient sur un nom deviné depuis l'URL, et un PDF partait en
  // « devis.csv » illisible. L'en-tête est là, il faut le déclarer visible.
  app.enableCors({
    origin: true,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Snack Manager API — port ${port}`);
}

bootstrap();
