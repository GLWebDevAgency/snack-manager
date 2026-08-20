import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  PlannedShiftCreateSchema,
  PlannedShiftUpdateSchema,
  PlanningDuplicateSchema,
  PlanningPublishSchema,
  PlanningWeekQuerySchema,
  StaffHourlyCostSchema,
  type JwtPayload,
  type PlannedShiftCreate,
  type PlannedShiftUpdate,
  type PlanningDuplicate,
  type PlanningPublish,
  type PlanningWeekQuery,
  type StaffHourlyCost,
} from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { canReadPayroll, PayrollGuard } from './payroll-access';
import { PlanningService } from './planning.service';

/**
 * Planning des services — back-office du gérant.
 *
 * Deux niveaux d'accès, et la différence est délibérée :
 *
 *  - POSER ET LIRE un planning est ouvert au gérant, y compris depuis une
 *    tablette connectée au PIN : c'est là qu'il travaille, entre deux services.
 *    Les montants, eux, sortent alors à `null` — l'écran affiche le planning
 *    sans les salaires.
 *
 *  - Les routes dont la réponse EST une rémunération (coûts horaires,
 *    confrontation prévu/pointé en euros) sont fermées à tout ce qui n'est pas
 *    le compte propriétaire. Les masquer n'aurait aucun sens : il ne resterait
 *    rien à renvoyer.
 *
 * tenantId : toujours issu du jeton, jamais du corps de requête.
 */
@Roles('owner', 'gerant')
@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  /** Semaine complète : services par jour et par service, totaux, rappels. */
  @Get('week')
  week(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query(zod(PlanningWeekQuerySchema)) q: PlanningWeekQuery,
  ) {
    return this.planning.week(tenantId, q.week, canReadPayroll(user));
  }

  /** Adéquation au volume attendu — croisement avec les prévisions du tableau de bord. */
  @Get('week/coverage')
  coverage(
    @TenantId() tenantId: string,
    @Query(zod(PlanningWeekQuerySchema)) q: PlanningWeekQuery,
  ) {
    return this.planning.coverage(tenantId, q.week);
  }

  /**
   * Prévu contre pointé, en heures ET en euros.
   * Réservé au propriétaire : la réponse est une masse salariale ligne à ligne.
   */
  @Get('week/comparison')
  @UseGuards(PayrollGuard)
  comparison(
    @TenantId() tenantId: string,
    @Query(zod(PlanningWeekQuerySchema)) q: PlanningWeekQuery,
  ) {
    return this.planning.comparison(tenantId, q.week);
  }

  @Post('shifts')
  create(@TenantId() tenantId: string, @Body(zod(PlannedShiftCreateSchema)) body: PlannedShiftCreate) {
    return this.planning.create(tenantId, body);
  }

  @Patch('shifts/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(PlannedShiftUpdateSchema)) body: PlannedShiftUpdate,
  ) {
    return this.planning.update(tenantId, id, body);
  }

  @Delete('shifts/:id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.planning.remove(tenantId, id);
  }

  /** Duplique une semaine vers une autre — la copie arrive toujours en brouillon. */
  @Post('week/duplicate')
  duplicate(@TenantId() tenantId: string, @Body(zod(PlanningDuplicateSchema)) body: PlanningDuplicate) {
    return this.planning.duplicate(tenantId, body);
  }

  /** Rend la semaine visible à l'équipe : le seul geste qui sort du brouillon. */
  @Post('week/publish')
  publish(@TenantId() tenantId: string, @Body(zod(PlanningPublishSchema)) body: PlanningPublish) {
    return this.planning.publish(tenantId, body.week);
  }

  // ─── Coûts horaires — DONNÉES PERSONNELLES, propriétaire uniquement ───

  @Get('staff-costs')
  @UseGuards(PayrollGuard)
  staffCosts(@TenantId() tenantId: string) {
    return this.planning.teamCosts(tenantId);
  }

  @Put('staff-costs/:staffId')
  @UseGuards(PayrollGuard)
  setStaffCost(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
    @Body(zod(StaffHourlyCostSchema)) body: StaffHourlyCost,
  ) {
    return this.planning.setHourlyCost(tenantId, staffId, body.hourlyCostCents);
  }
}
