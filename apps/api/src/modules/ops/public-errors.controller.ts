import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ClientErrorReportSchema, type ClientErrorReport } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public } from '../../common/auth';
import { OpsService } from './ops.service';
import { ReportThrottle } from './report-throttle';

/**
 * Le guichet public des interfaces : la caisse, la cuisine, le web y déposent
 * leurs pannes. Public par nécessité — une tablette dont la session a expiré
 * est précisément celle dont on veut entendre parler.
 *
 * La réponse est TOUJOURS `{ ok: true }`, limité ou pas : un rapporteur
 * d'erreurs qui provoque des erreurs entretiendrait sa propre avalanche, et
 * dire « vous êtes limité » n'aide que l'abuseur.
 */
@Public()
@Controller('public')
export class PublicErrorsController {
  private readonly throttle = new ReportThrottle();

  constructor(private readonly ops: OpsService) {}

  @Post('client-errors')
  async report(
    @Body(zod(ClientErrorReportSchema)) body: ClientErrorReport,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    const key = clientKey(req);
    if (this.throttle.allow(key, Date.now())) {
      await this.ops.record(body);
    }
    return { ok: true };
  }
}

/** L'adresse d'origine, en tête de `x-forwarded-for` derrière le proxy Railway. */
function clientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.ip ?? 'inconnu').trim();
}
