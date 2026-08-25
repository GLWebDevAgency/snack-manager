import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ProductionTickSchema,
  type CrmProductionWeek,
  type JwtPayload,
  type ProductionTick,
} from '@sm/contracts';
import { CurrentUser, Roles } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { ProductionService } from './production.service';

/**
 * LA PRODUCTION DE L'ATELIER — « qu'est-ce que je dois à mes clients cette
 * semaine ? ».
 *
 * Quatrième responsabilité du préfixe `/crm`, et pas une fusion :
 * `CrmController` OBSERVE le pipeline, `AdminController` AGIT sur les
 * comptes, `HealthController` ANALYSE l'exploitation — celui-ci TIENT LES
 * PROMESSES récurrentes signées à l'Atelier (publications, fiche Google,
 * rapports mensuels).
 *
 * ─── CLOISONNEMENT ───
 *
 * `@Roles('sm_admin')` sur la CLASSE, comme ses trois voisins : la file
 * balaie le parc entier, un gérant qui l'appelle reçoit un 403. Aucun
 * `@TenantId()` — le client coché vient de l'URL, jamais du jeton.
 */
@Roles('sm_admin')
@Controller('crm')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  /** La file d'une semaine — la courante sans paramètre, jamais la prochaine. */
  @Get('production')
  week(@Query('week') week?: string): Promise<CrmProductionWeek> {
    return this.production.week(week);
  }

  /** Cocher/décocher une tâche due — l'auteur du geste reste sur la trace. */
  @Post('production/:tenantId/tick')
  tick(
    @CurrentUser() actor: JwtPayload,
    @Param('tenantId') tenantId: string,
    @Body(zod(ProductionTickSchema)) body: ProductionTick,
  ): Promise<{ done: boolean }> {
    return this.production.tick(actor, tenantId, body);
  }
}
