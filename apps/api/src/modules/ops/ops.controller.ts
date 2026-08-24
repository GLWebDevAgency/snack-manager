import { Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../common/auth';
import { AlertsService } from './alerts.service';
import { OpsService } from './ops.service';

/**
 * L'exploitation vue de l'équipe — même cloisonnement que le reste du CRM :
 * `@Roles('sm_admin')` sur la classe, trans-tenant, un gérant reçoit 403.
 */
@Roles('sm_admin')
@Controller('crm/ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly alerts: AlertsService,
  ) {}

  /** Les groupes d'erreurs, jamais vus d'abord — l'écran /sm/erreurs. */
  @Get('errors')
  async errors() {
    return { groups: await this.ops.recentGroups() };
  }

  /** « Vu » : le groupe redescend, il ne disparaît pas — l'historique reste. */
  @Post('errors/:id/seen')
  async seen(@Param('id') id: string) {
    await this.ops.markSeen(id);
    return { ok: true };
  }

  /** L'entonnoir du tunnel de commande, par établissement, sur 30 jours. */
  @Get('funnel')
  async funnel() {
    return { rows: await this.ops.funnelRows() };
  }

  /** L'état du canal d'alerte — l'écran dit la vérité sur ce qui sonnerait. */
  @Get('alerts')
  alertChannel() {
    return this.alerts.status();
  }

  /** Envoi d'essai réel sur le canal configuré. */
  @Post('alerts/test')
  testAlert() {
    return this.alerts.test();
  }
}
