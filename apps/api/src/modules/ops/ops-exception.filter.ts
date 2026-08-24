import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ErrorReport } from '@sm/contracts';
import { OpsService } from './ops.service';

/**
 * Le filet sous l'API : toute exception NON MÉTIER entre au journal.
 *
 * Un 404 « Lead introuvable » ou un 409 de doublon est une RÉPONSE, pas une
 * panne — les journaliser noierait le signal sous le bruit du quotidien. Ce
 * qui compte, c'est ce que personne n'a prévu : le `throw` nu, le timeout
 * Mongo, la 500. La décision est une fonction pure pour être testée sans
 * monter Nest.
 *
 * Le filtre DÉLÈGUE ensuite à `BaseExceptionFilter` : la forme des réponses
 * d'erreur ne change pas d'un octet — ce filtre observe, il ne répond pas.
 */

export function toRecord(exception: unknown): ErrorReport | null {
  if (exception instanceof HttpException && exception.getStatus() < 500) return null;
  if (exception instanceof Error) {
    return { source: 'api', message: exception.message || exception.name, stack: exception.stack ?? '' };
  }
  return { source: 'api', message: String(exception) };
}

@Catch()
export class OpsExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly ops: OpsService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const record = toRecord(exception);
    // Jamais attendu : la réponse au client ne dépend pas du journal.
    if (record) void this.ops.record(record);
    super.catch(exception, host);
  }
}
