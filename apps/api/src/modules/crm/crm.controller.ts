import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  LeadConvertSchema,
  LeadCreateSchema,
  LeadListQuerySchema,
  LeadStageChangeSchema,
  LeadTouchCreateSchema,
  LeadUpdateSchema,
  type JwtPayload,
  type LeadConvert,
  type LeadCreate,
  type LeadListQuery,
  type LeadStageChange,
  type LeadTouchCreate,
  type LeadUpdate,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Roles } from '../../common/auth';
import { ConversionService } from './conversion.service';
import { CrmService } from './crm.service';
import { DevisService } from './devis.service';

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
  constructor(
    private readonly crm: CrmService,
    private readonly conversion: ConversionService,
    private readonly devis: DevisService,
  ) {}

  /** Compteurs de pipeline, places fondateur, MRR estimé, santé du parc. */
  @Get('overview')
  overview() {
    return this.crm.overview();
  }

  /**
   * LE PARC RÉEL — identité, activité 30 jours, et la santé de chaque client.
   *
   * Chaque ligne porte désormais son `score`, son `accountStatus`, sa tendance
   * (`previousOrders` / `ordersDeltaPct`) et ses appareils muets
   * (`devicesOffline`). Ces quatre-là manquaient : la colonne « Santé »
   * affichait un tiret, et l'écran comblait le trou en appelant
   * `/crm/tenants/:id/health` UNE FOIS PAR CLIENT après l'affichage — une
   * requête par ligne, dont chacune journalise une consultation de dossier.
   * Afficher la liste revenait donc à « ouvrir » le parc entier.
   *
   * Le calcul se fait ici en une agrégation par champ sur tout le parc, avec
   * les fonctions de jugement de la fiche : le score lu dans la liste est celui
   * qu'on retrouve en cliquant dessus. La fiche reste la seule à rendre le
   * DÉTAIL rédigé de chaque axe — et la seule à tracer la consultation, parce
   * qu'elle seule ouvre vraiment un dossier.
   */
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

  /**
   * SIGNER : le lead devient un restaurant — tenant, compte gérant, place
   * fondateur, échéance d'essai, journal. Le mot de passe de la réponse ne
   * se relit jamais : il s'écrit sur un papier, maintenant.
   */
  @Post('leads/:id/convert')
  convert(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(LeadConvertSchema)) body: LeadConvert,
  ) {
    return this.conversion.convert(actor, id, body);
  }

  /**
   * Le devis de la proposition posée — le document que l'étape « Proposition »
   * promettait sans le tenir. `attachment` : il se télécharge pour partir en
   * pièce jointe ou s'imprimer, il ne se lit pas dans un onglet d'admin.
   */
  @Get('leads/:id/devis')
  async devisPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, number } = await this.devis.pdf(id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-length', String(buffer.length));
    res.setHeader('content-disposition', `attachment; filename="${number}.pdf"`);
    return new StreamableFile(buffer);
  }
}
