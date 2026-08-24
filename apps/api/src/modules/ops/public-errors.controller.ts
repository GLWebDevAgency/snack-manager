import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ClientErrorReportSchema,
  FunnelEventSchema,
  type ClientErrorReport,
  type FunnelEvent,
} from '@sm/contracts';
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
  /** Un client normal émet 4 jalons par commande — 60/min est déjà large. */
  private readonly funnelThrottle = new ReportThrottle(60);

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

  /** Un jalon du tunnel — même posture que les erreurs : toujours `{ok}`. */
  @Post('funnel')
  async funnel(
    @Body(zod(FunnelEventSchema)) body: FunnelEvent,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    if (this.funnelThrottle.allow(clientKey(req), Date.now())) {
      await this.ops.recordFunnel(body);
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
