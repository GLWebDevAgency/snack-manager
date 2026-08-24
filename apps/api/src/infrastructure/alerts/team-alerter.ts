/**
 * PORT D'EXPLOITATION — prévenir L'ÉQUIPE, pas le client.
 *
 * À ne pas confondre avec le port `Notifier` du domaine, qui parle au client
 * final (« votre commande est prête ») : ici c'est la plateforme qui parle à
 * ceux qui la tiennent — caisse muette en plein service, avalanche d'erreurs,
 * impayé qui franchit un seuil. Le besoin est opérationnel, pas métier, d'où
 * sa place dans `infrastructure/` et non dans `@sm/domain`.
 *
 * Même doctrine que les autres ports : un envoi raté se constate et se
 * journalise, il ne fait jamais tomber ce qui l'a déclenché.
 */

export type TeamAlert = {
  /** Sujet court — c'est l'objet du mail, la première ligne du webhook. */
  title: string;
  /** Le corps, déjà rédigé : le transport n'a rien à savoir du métier. */
  text: string;
};

export type TeamAlertResult = { sent: boolean; reason?: string };

export interface TeamAlerter {
  readonly providerName: string;
  /** false = aucun canal configuré : le veilleur ne se lance même pas. */
  readonly enabled: boolean;
  send(alert: TeamAlert): Promise<TeamAlertResult>;
}

export class NoopTeamAlerter implements TeamAlerter {
  readonly providerName = 'aucun';
  readonly enabled = false;
  async send(): Promise<TeamAlertResult> {
    return { sent: false, reason: 'aucun canal d’alerte configuré' };
  }
}

/** Plusieurs canaux configurés = tous servis ; « envoyé » dès qu'un l'est. */
export class CompositeTeamAlerter implements TeamAlerter {
  readonly providerName: string;
  readonly enabled = true;

  constructor(private readonly channels: readonly TeamAlerter[]) {
    this.providerName = channels.map((c) => c.providerName).join(' + ');
  }

  async send(alert: TeamAlert): Promise<TeamAlertResult> {
    const results = await Promise.all(this.channels.map((c) => c.send(alert)));
    const sent = results.some((r) => r.sent);
    const reasons = results.filter((r) => !r.sent && r.reason).map((r) => r.reason);
    return sent ? { sent } : { sent, reason: reasons.join(' ; ') || 'échec d’envoi' };
  }
}
