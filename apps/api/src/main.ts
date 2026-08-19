import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // `rawBody: true` conserve les octets bruts de la requête dans `req.rawBody`,
  // EN PLUS du corps parsé habituel : aucune route existante ne change de
  // comportement. C'est la seule façon de vérifier une signature de webhook
  // Stripe — le HMAC porte sur les octets exacts reçus, et un JSON re-sérialisé
  // (ordre des clés, espaces, échappements unicode) donne une autre empreinte,
  // donc un webhook rejeté à chaque appel. Voir
  // `modules/ordering/stripe-webhook.controller.ts`.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Snack Manager API — port ${port}`);
}

bootstrap();
