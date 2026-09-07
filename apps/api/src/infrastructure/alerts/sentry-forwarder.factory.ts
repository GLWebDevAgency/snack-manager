import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import { readNonEmpty, type ConfigSource } from '../config-source';
import type { FactoryLogger } from '../factory-logger';
import type { ErrorForwarder } from './error-forwarder';

function reportPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { return new URL(value, 'https://alert.invalid').pathname.slice(0, 300); }
  catch { return undefined; }
}

/** Final SDK boundary: request isolation/processors can add bodies, headers,
 * cookies and URL breadcrumbs even to a synthetic, generic Error. Forward
 * only the diagnostic alert, never that automatically inherited context.
 */
function alertOnly(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const url = reportPath(event.extra?.url);
  return {
    type: undefined,
    event_id: event.event_id, timestamp: event.timestamp, level: event.level,
    message: event.message, exception: event.exception, platform: event.platform,
    environment: event.environment, release: event.release, dist: event.dist,
    sdk: event.sdk,
    tags: { source: event.tags?.source },
    extra: {
      ...(url ? { url } : {}),
      ...(typeof event.extra?.appVersion === 'string' ? { appVersion: event.extra.appVersion.slice(0, 40) } : {}),
    },
  };
}

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
    // Avoid collecting incoming bodies, then enforce the alert-only contract
    // after every SDK event processor. sendDefaultPii:false alone is not a
    // body/header/cookie barrier in the installed SDK.
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    beforeSend: alertOnly,
    beforeSendTransaction: () => null,
  });
  logger.log('Sentry : relais actif');

  return {
    enabled: true,
    forward: (report) => {
      Sentry.withScope((scope) => {
        scope.setTag('source', report.source);
        const url = reportPath(report.url);
        if (url) scope.setExtra('url', url);
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
