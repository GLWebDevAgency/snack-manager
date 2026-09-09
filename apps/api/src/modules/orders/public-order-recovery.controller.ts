import { Body, Controller, Header, HttpCode, HttpException, HttpStatus, NotFoundException, Param, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { AbandonPublicOrderSchema, RecoverPublicOrderSchema, type AbandonPublicOrder, type RecoverPublicOrder } from '@sm/contracts';
import { Public } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trustedClientIp } from '../../common/trusted-client-ip';
import { TenantsService } from '../tenants/tenants.service';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { recoveryNotFound } from './order-recovery';

@Public()
@Controller('public/tenants/:slug/orders')
export class PublicOrderRecoveryController {
  constructor(private readonly admissions: PublicOrderAdmissionService, private readonly tenants: TenantsService, private readonly quota: SharedPublicQuota) {}

  @Post('recovery')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async recover(@Param('slug') slug: string, @Body(zod(RecoverPublicOrderSchema)) body: RecoverPublicOrder, @Req() request: Request) {
    await enforceOrderRecoveryQuota(this.quota, slug, body.clientId, request);
    const tenant = await this.tenant(slug);
    return this.admissions.recover(String(tenant._id), body.clientId, body.recoveryProof);
  }

  @Post('abandon')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async abandon(@Param('slug') slug: string, @Body(zod(AbandonPublicOrderSchema)) body: AbandonPublicOrder, @Req() request: Request) {
    await enforceOrderRecoveryQuota(this.quota, slug, body.clientId, request);
    const tenant = await this.tenant(slug);
    const tenantId = String(tenant._id);
    const original = { ...body, turnstileToken: body.turnstileToken ?? '' };
    return this.admissions.abandon(tenantId, original);
  }

  private async tenant(slug: string) {
    try { return await this.tenants.bySlug(slug); }
    catch (error) { if (error instanceof NotFoundException) throw recoveryNotFound(); throw error; }
  }

}

/** Même quota partagé AVANT toute admission, y compris le POST de création. */
export async function enforceOrderRecoveryQuota(quota: SharedPublicQuota, slug: string, clientId: string, request: Pick<Request, 'headers' | 'socket'>): Promise<void> {
  return enforceOrderRecoverySourceQuota(quota, slug, clientId, trustedClientIp(request));
}

/** The account route supplies only its authenticated opaque relay source. */
export async function enforceOrderRecoverySourceQuota(quota: SharedPublicQuota, slug: string, clientId: string, sourceKey: string): Promise<void> {
    let allowed: boolean;
    try {
      allowed = await quota.reserve({ scope: 'order-recovery-source', clientKey: sourceKey, windowMs: 60_000, clientLimit: 60, globalLimit: 2_000 });
      if (allowed) allowed = await quota.reserveClient({ scope: 'order-recovery-attempt', clientKey: `${slug}\0${clientId}`, windowMs: 60_000, clientLimit: 30 });
    } catch {
      throw new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'La reprise est momentanément indisponible. Conservez cette tentative.' });
    }
    if (!allowed) throw new HttpException({ code: 'ORDER_RECOVERY_RATE_LIMITED', message: 'Trop de vérifications. Patientez avant de reprendre cette même tentative.' }, HttpStatus.TOO_MANY_REQUESTS);
}
