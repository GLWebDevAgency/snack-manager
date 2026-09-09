import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

/** Validation failed before any committing CAS was sent. */
export class PublicOrderSnapshotInvalid extends BadRequestException {
  constructor() { super('La configuration de la commande ne peut pas être enregistrée.'); }
}

/** This validator lost account authority BEFORE issuing a committing CAS. */
export class CustomerOrderAuthorityLost extends ForbiddenException {
  constructor() { super('Le compte ne peut plus autoriser cette nouvelle commande.'); }
}

export function orderAttemptUncertain(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN',
    message: 'La création reste à vérifier. Reprenez cette même tentative.' });
}
