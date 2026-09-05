import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import { Roles, TenantId } from '../../common/auth';
import { StaffService } from './staff.service';
import {
  ClockSchema,
  ShiftsQuerySchema,
  StaffCreateSchema,
  StaffUpdateSchema,
  type Clock,
  type ShiftsQuery,
  type StaffCreate,
  type StaffUpdate,
} from './staff.dto';

/**
 * Équipe & pointage (spec backoffice §12) — réservé owner/gérant.
 * tenantId : toujours issu du JWT, jamais du body.
 */
@Roles('owner', 'gerant')
@Controller('staff')
@Fonction('team')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** Liste + « en poste maintenant » (shift ouvert) par membre. */
  @Get()
  list(@TenantId() tenantId: string) {
    return this.staff.list(tenantId);
  }

  /** Pointages sur période + total heures/personne (arrondi 0,5 h par shift). */
  @Get('shifts')
  shifts(@TenantId() tenantId: string, @Query(zod(ShiftsQuerySchema)) query: ShiftsQuery) {
    return this.staff.shiftsRange(tenantId, query);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body(zod(StaffCreateSchema)) body: StaffCreate) {
    return this.staff.create(tenantId, body);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(StaffUpdateSchema)) body: StaffUpdate,
  ) {
    return this.staff.update(tenantId, id, body);
  }

  /** Suppression douce : active=false. */
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.staff.remove(tenantId, id);
  }

  /** Badge arrivée/départ 1-clic (source 'backoffice'). */
  @Post(':id/clock')
  clock(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(ClockSchema)) body: Clock,
  ) {
    return this.staff.clock(tenantId, id, body.direction);
  }
}
