import { BadRequestException, ConflictException } from '@nestjs/common';
import { NEXT_OPEN_LOOKAHEAD_DAYS, SLOT_LEAD_TIME_MIN } from '@sm/contracts';
import { addDays, compareDays, parisYmd } from './paris-time';

/** Pure temporal gate for NEW requests, never for a committed receipt replay.
 * A free durable seat is not permission to book yesterday or rush preparation.
 * Calendar membership and delivery-specific lead time remain separate guards. */
export function assertOrderSlotFresh(iso: string, now = new Date()): Date {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) throw new BadRequestException('Créneau de retrait invalide.');
  const today = parisYmd(now);
  if (compareDays(parisYmd(at), addDays(today, NEXT_OPEN_LOOKAHEAD_DAYS)) > 0) {
    throw new ConflictException(`Les commandes ouvrent au maximum ${NEXT_OPEN_LOOKAHEAD_DAYS} jours a l avance.`);
  }
  if (at.getTime() < now.getTime() + SLOT_LEAD_TIME_MIN * 60_000) {
    throw new ConflictException('Ce créneau n’est plus disponible — choisissez-en un autre.');
  }
  return at;
}
