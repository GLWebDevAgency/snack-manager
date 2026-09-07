import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/** Validation failed before any committing CAS was sent. */
export class PublicOrderSnapshotInvalid extends BadRequestException {
  constructor() { super('La configuration de la commande ne peut pas être enregistrée.'); }
}

export function orderAttemptUncertain(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN',
    message: 'La création reste à vérifier. Reprenez cette même tentative.' });
}
