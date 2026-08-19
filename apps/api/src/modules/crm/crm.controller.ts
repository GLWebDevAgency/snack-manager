import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  LeadCreateSchema,
  LeadListQuerySchema,
  LeadStageChangeSchema,
  LeadTouchCreateSchema,
  LeadUpdateSchema,
  type LeadCreate,
  type LeadListQuery,
  type LeadStageChange,
  type LeadTouchCreate,
  type LeadUpdate,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Roles } from '../../common/auth';
import { CrmService } from './crm.service';

/**
 * CRM interne Snack Manager — NOTRE société, pas celle du client.
 *
 * `@Roles('sm_admin')` posé sur la CLASSE : toutes les routes en héritent, y
 * compris celles qu'on ajoutera demain. Un gérant de restaurant (`owner`) qui
 * appelle ces routes avec son jeton reçoit un 403 — c'est la seule garde qui
 * compte, celle du web n'est qu'un confort de navigation.
 *
 * Aucun `@TenantId()` ici : le CRM est TRANS-TENANT et l'équipe SM porte un
 * jeton sans tenantId. Le cloisonnement se fait par le rôle, pas par le tenant.
 */
@Roles('sm_admin')
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  /** Compteurs de pipeline, places fondateur, MRR estimé, santé du parc. */
  @Get('overview')
  overview() {
    return this.crm.overview();
  }

  /** Restaurants clients réels + activité 30 jours (détection de décrochage). */
  @Get('tenants')
  clients() {
    return this.crm.listClients();
  }

  /** `?stage=demo` filtre une colonne ; sans query, tout le pipeline. */
  @Get('leads')
  listLeads(@Query(zod(LeadListQuerySchema)) q: LeadListQuery) {
    return this.crm.listLeads(q.stage);
  }

  @Get('leads/:id')
  getLead(@Param('id') id: string) {
    return this.crm.getLead(id);
  }

  @Post('leads')
  createLead(@Body(zod(LeadCreateSchema)) body: LeadCreate) {
    return this.crm.createLead(body);
  }

  @Patch('leads/:id')
  updateLead(@Param('id') id: string, @Body(zod(LeadUpdateSchema)) body: LeadUpdate) {
    return this.crm.updateLead(id, body);
  }

  @Patch('leads/:id/stage')
  changeStage(@Param('id') id: string, @Body(zod(LeadStageChangeSchema)) body: LeadStageChange) {
    return this.crm.changeStage(id, body.stage);
  }

  /** Relance tracée : date, canal, message (spec crm-sm §8.1). */
  @Post('leads/:id/touches')
  addTouch(@Param('id') id: string, @Body(zod(LeadTouchCreateSchema)) body: LeadTouchCreate) {
    return this.crm.addTouch(id, body);
  }
}
