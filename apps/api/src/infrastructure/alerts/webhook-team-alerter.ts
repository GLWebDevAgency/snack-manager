import type { TeamAlert, TeamAlerter, TeamAlertResult } from './team-alerter';

type FetchFn = typeof fetch;

/**
 * Le canal le plus simple à brancher : une URL. Le corps porte à la fois
 * `text` (Slack, Mattermost) et `content` (Discord) — le même webhook sert
 * les deux sans réglage, et un récepteur maison lit ce qu'il veut.
 */
export class WebhookTeamAlerter implements TeamAlerter {
  readonly providerName = 'webhook';
  readonly enabled = true;

  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(alert: TeamAlert): Promise<TeamAlertResult> {
    const body = `⚠ ${alert.title}\n${alert.text}`;
    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: body, content: body.slice(0, 1_900) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { sent: false, reason: `webhook : HTTP ${res.status}` };
      return { sent: true };
    } catch (cause) {
      return { sent: false, reason: `webhook injoignable (${String(cause).slice(0, 120)})` };
    }
  }
}
