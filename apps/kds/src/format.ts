import { mmss, type Order, type OrderLine } from '@sm/client-core';

/** « 14:07 » — heure murale française, chiffres toujours sur 2 positions. */
export function clockHM(input: number | string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Secondes écoulées depuis la prise de commande — base de tous les minuteurs. */
export function elapsedSeconds(order: Order, now: number): number {
  const placed = Date.parse(order.createdAt);
  if (Number.isNaN(placed)) return 0;
  return Math.max(0, (now - placed) / 1000);
}

/**
 * Minuteur affiché. `mm:ss` est la lecture de service (le noyau fournit `mmss`),
 * mais au-delà de 99 minutes le compteur devient illisible — « 398:57 » ne se
 * lit pas d'un coup d'œil. On bascule alors en heures : un ticket aussi vieux
 * n'est plus une minuterie, c'est une anomalie.
 */
export function elapsedLabel(seconds: number): string {
  if (seconds < 6000) return mmss(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} h ${String(minutes).padStart(2, '0')}`;
}

/** Récapitulatif d'une ligne d'options, joint par « · ». */
export function optionsText(line: OrderLine): string {
  return line.options.map((o) => o.name).join(' · ');
}
