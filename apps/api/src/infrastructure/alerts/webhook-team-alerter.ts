import { detailErreur, fetchV4 } from '../http-v4';
import type { TeamAlert, TeamAlerter, TeamAlertResult } from './team-alerter';

type FetchFn = typeof fetch;

/**
 * Le canal le plus simple à brancher : une URL. Le corps porte à la fois
 * `text` (Slack, Mattermost) et `content` (Discord) — le même webhook sert
 * les deux sans réglage, et un récepteur maison lit ce qu'il veut.
 *
 * CAS PARTICULIER — ntfy.sh : le seul canal qui ne demande AUCUN compte —
 * une URL de sujet suffit, et le téléphone s'abonne au sujet. C'est le canal
 * qu'on peut armer entièrement depuis ici, sans attendre qu'un Discord ou un
 * Brevo existe. ntfy attend du TEXTE BRUT, pas du JSON : lui poster
 * `{"text":…}` afficherait l'enveloppe dans la notification. Les en-têtes
 * restent ASCII (`x-tags`, `x-priority`) — un titre accentué dans un en-tête
 * HTTP arriverait mutilé, le titre vit donc en première ligne du corps.
 */
export class WebhookTeamAlerter implements TeamAlerter {
  readonly providerName = 'webhook';
  readonly enabled = true;

  constructor(
    private readonly url: string,
    // IPv4 forcé : ntfy.sh publie une IPv6 que Railway ne sait pas joindre —
    // voir `http-v4.ts`, c'est le « fetch failed » du 24/08 sur staging.
    private readonly fetchFn: FetchFn = fetchV4,
  ) {}

  private get estNtfy(): boolean {
    return /^https:\/\/ntfy\.sh\//.test(this.url);
  }

  async send(alert: TeamAlert): Promise<TeamAlertResult> {
    const body = `⚠ ${alert.title}\n${alert.text}`;
    try {
      const res = await this.fetchFn(this.url, {
        method: 'POST',
        headers: this.estNtfy
          ? {
              'content-type': 'text/plain; charset=utf-8',
              'x-tags': 'rotating_light',
              'x-priority': 'high',
            }
          : { 'content-type': 'application/json' },
        body: this.estNtfy
          ? body
          : JSON.stringify({ text: body, content: body.slice(0, 1_900) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { sent: false, reason: `webhook : HTTP ${res.status}` };
      return { sent: true };
    } catch (cause) {
      return { sent: false, reason: `webhook injoignable (${detailErreur(cause).slice(0, 160)})` };
    }
  }
}
