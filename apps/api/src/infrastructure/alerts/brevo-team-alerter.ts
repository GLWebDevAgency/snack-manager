import type { TeamAlert, TeamAlerter, TeamAlertResult } from './team-alerter';

type FetchFn = typeof fetch;

/**
 * E-mail transactionnel via Brevo — un POST nu sur leur API v3, sans SDK :
 * la dépendance ne vaudrait pas les quatre lignes qu'elle remplacerait.
 *
 * L'expéditeur doit être un domaine ou une adresse VALIDÉE côté Brevo, sinon
 * l'API accepte et ne livre pas — c'est écrit dans la checklist de
 * configuration, pas devinable depuis le code.
 */
export class BrevoTeamAlerter implements TeamAlerter {
  readonly providerName = 'e-mail (Brevo)';
  readonly enabled = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(alert: TeamAlert): Promise<TeamAlertResult> {
    try {
      const res = await this.fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': this.apiKey },
        body: JSON.stringify({
          sender: { email: this.from, name: 'Snack Manager — alertes' },
          to: [{ email: this.to }],
          subject: `⚠ ${alert.title}`,
          textContent: alert.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { sent: false, reason: `Brevo : HTTP ${res.status}` };
      return { sent: true };
    } catch (cause) {
      return { sent: false, reason: `Brevo injoignable (${String(cause).slice(0, 120)})` };
    }
  }
}
