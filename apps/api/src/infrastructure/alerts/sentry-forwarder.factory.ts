import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import { readNonEmpty, type ConfigSource } from '../config-source';
import type { FactoryLogger } from '../factory-logger';
import type { ErrorForwarder } from './error-forwarder';

/**
 * Sentry, si — et seulement si — `SENTRY_DSN` est posée. Même règle que
 * Stripe : la variable est l'interrupteur, la fabrique ne lève jamais.
 *
 * `tracesSampleRate: 0` : on relaie des PANNES, pas de la performance — le
 * quota Sentry gratuit est un budget d'alertes, pas de télémétrie.
 */
export function createSentryForwarder(
  get: ConfigSource,
  logger: FactoryLogger = new Logger('SentryFactory'),
): ErrorForwarder {
  const dsn = readNonEmpty(get, 'SENTRY_DSN');
  if (!dsn) {
    logger.log('Sentry : désactivé (journal maison seul)');
    return { enabled: false, forward: () => {} };
  }

  Sentry.init({
    dsn,
    environment: readNonEmpty(get, 'SM_ENV') ?? 'production',
    release: readNonEmpty(get, 'SM_REVISION') ?? undefined,
    tracesSampleRate: 0,
  });
  logger.log('Sentry : relais actif');

  return {
    enabled: true,
    forward: (report) => {
      Sentry.withScope((scope) => {
        scope.setTag('source', report.source);
        if (report.url) scope.setExtra('url', report.url);
        if (report.appVersion) scope.setExtra('appVersion', report.appVersion);
        // La pile d'origine est recousue sur une erreur synthétique : c'est
        // elle que Sentry regroupe, pas le point de relais.
        const err = new Error(report.message);
        if (report.stack) err.stack = report.stack;
        Sentry.captureException(err);
      });
    },
  };
}
