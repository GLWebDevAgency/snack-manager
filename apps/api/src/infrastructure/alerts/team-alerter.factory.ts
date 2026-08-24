import { Logger } from '@nestjs/common';

import { readNonEmpty, type ConfigSource } from '../config-source';
import type { FactoryLogger } from '../factory-logger';
import { BrevoTeamAlerter } from './brevo-team-alerter';
import { CompositeTeamAlerter, NoopTeamAlerter, type TeamAlerter } from './team-alerter';
import { WebhookTeamAlerter } from './webhook-team-alerter';

/**
 * Choix du canal d'alerte équipe — même règle que Stripe : la présence de la
 * variable EST l'interrupteur, et la fabrique ne lève jamais.
 *
 *   SM_ALERT_WEBHOOK                       → webhook (Discord, Slack, ntfy…)
 *   BREVO_API_KEY + SM_ALERT_EMAIL_TO      → e-mail Brevo
 *     (+ SM_ALERT_EMAIL_FROM : expéditeur validé chez Brevo,
 *        sinon le destinataire fait expéditeur)
 *
 * Les deux configurés = les deux servis. Aucun = veilleur au repos, et l'écran
 * /sm/erreurs le dit plutôt que de laisser croire qu'une alerte partirait.
 */
export function createTeamAlerter(
  get: ConfigSource,
  logger: FactoryLogger = new Logger('TeamAlerterFactory'),
): TeamAlerter {
  const channels: TeamAlerter[] = [];

  const webhook = readNonEmpty(get, 'SM_ALERT_WEBHOOK');
  if (webhook) channels.push(new WebhookTeamAlerter(webhook));

  const brevoKey = readNonEmpty(get, 'BREVO_API_KEY');
  const to = readNonEmpty(get, 'SM_ALERT_EMAIL_TO');
  if (brevoKey && to) {
    const from = readNonEmpty(get, 'SM_ALERT_EMAIL_FROM') ?? to;
    channels.push(new BrevoTeamAlerter(brevoKey, from, to));
  } else if (brevoKey || to) {
    logger.warn(
      'Alerte e-mail : configuration incomplète (il faut BREVO_API_KEY ET SM_ALERT_EMAIL_TO) — canal ignoré',
    );
  }

  const [seul] = channels;
  if (!seul) {
    logger.log('Alertes équipe : aucun canal configuré — veilleur au repos');
    return new NoopTeamAlerter();
  }
  const alerter = channels.length === 1 ? seul : new CompositeTeamAlerter(channels);
  logger.log(`Alertes équipe : ${alerter.providerName}`);
  return alerter;
}
