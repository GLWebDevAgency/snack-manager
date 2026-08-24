import type { TeamAlert } from '../../infrastructure/alerts/team-alerter';

/**
 * La partie PURE du veilleur : décider quoi envoyer, et rédiger le message.
 * Séparée du service pour être testée sans base ni horloge réelle — c'est
 * elle qui porte les deux règles anti-spam.
 */

/** Une alerte candidate : une clé stable (dédup) et sa ligne rédigée. */
export type AlertCandidate = { key: string; line: string };

/** Six heures : la même caisse muette sonne au prochain service, pas toutes
 *  les cinq minutes. */
export const ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

/** Au-delà, le message cite les premières lignes et compte le reste. */
const MAX_LINES = 10;

/**
 * Ce qui mérite de partir MAINTENANT : jamais envoyé, ou envoyé il y a plus
 * d'un refroidissement. Dédoublonne aussi le lot lui-même — deux signaux qui
 * partagent une clé ne doivent compter qu'une fois.
 */
export function dueCandidates(
  candidates: readonly AlertCandidate[],
  lastSentByKey: ReadonlyMap<string, Date>,
  now: Date,
  cooldownMs: number = ALERT_COOLDOWN_MS,
): AlertCandidate[] {
  const seen = new Set<string>();
  const due: AlertCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    const last = lastSentByKey.get(candidate.key);
    if (last && now.getTime() - last.getTime() < cooldownMs) continue;
    due.push(candidate);
  }
  return due;
}

/** UN message par passage, jamais un par signal : le canal d'alerte reste
 *  lisible, et dix pannes simultanées font un digest, pas dix sonneries. */
export function composeAlert(due: readonly AlertCandidate[]): TeamAlert | null {
  if (due.length === 0) return null;
  const shown = due.slice(0, MAX_LINES).map((c) => `• ${c.line}`);
  const rest = due.length - shown.length;
  if (rest > 0) shown.push(`… et ${rest} autre${rest > 1 ? 's' : ''}`);
  shown.push('→ la file complète : /sm/signals');
  return {
    title:
      due.length === 1 ? 'Snack Manager — 1 alerte' : `Snack Manager — ${due.length} alertes`,
    text: shown.join('\n'),
  };
}
