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
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import { OpsService } from './ops.service';

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
  constructor(
    private readonly ops: OpsService,
    private readonly quota: SharedPublicQuota,
  ) {}

  @Post('client-errors')
  async report(
    @Body(zod(ClientErrorReportSchema)) body: ClientErrorReport,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    if (
      await this.allowed({
        scope: 'client-errors',
        clientKey: clientKey(req),
        windowMs: 60_000,
        clientLimit: 30,
        globalLimit: 300,
      })
    ) {
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
    if (
      await this.allowed({
        scope: 'funnel',
        clientKey: clientKey(req),
        windowMs: 60_000,
        // Un client normal émet quatre jalons par commande — 60/min est large.
        clientLimit: 60,
        globalLimit: 1_000,
      })
    ) {
      await this.ops.recordFunnel(body);
    }
    return { ok: true };
  }

  private async allowed(input: Parameters<SharedPublicQuota['reserve']>[0]): Promise<boolean> {
    try {
      return await this.quota.reserve(input);
    } catch {
      // La télémétrie est auxiliaire : Redis indisponible = DROP. Écrire quand
      // même ouvrirait précisément le chemin non borné que le quota protège.
      return false;
    }
  }
}

/**
 * Railway reconstruit `X-Real-IP`. `trustedClientIp` le valide et refuse le
 * `X-Forwarded-For` arbitraire, y compris quand Express l'a déjà placé dans
 * `req.ip`.
 */
function clientKey(req: Request): string {
  return trustedClientIp(req);
}
