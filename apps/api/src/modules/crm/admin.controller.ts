import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  AdminLogQuerySchema,
  DeviceRevokeSchema,
  TenantNoteSchema,
  TenantPlanChangeSchema,
  TenantReactivateSchema,
  TenantSuspendSchema,
  type AdminLogQuery,
  type DeviceRevoke,
  type JwtPayload,
  type TenantNote,
  type TenantPlanChange,
  type TenantReactivate,
  type TenantSuspend,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Roles } from '../../common/auth';
import { AdminService } from './admin.service';
import { ConversionService } from './conversion.service';

/**
 * ADMINISTRATION CLIENT — « gérer un client de A à Z ».
 *
 * `@Roles('sm_admin')` posé sur la CLASSE, comme sur `CrmController` : toutes
 * les routes en héritent, y compris celles qu'on ajoutera demain. Un gérant de
 * restaurant (`owner`) qui appelle ces routes avec son jeton reçoit un 403 —
 * c'est la seule garde qui compte, celle du web n'est qu'un confort de
 * navigation. Ces routes lisent et écrivent sur TOUS les établissements : elles
 * ne doivent même pas être devinables depuis un back-office restaurant.
 *
 * Contrôleur séparé de `CrmController` et non fusionné avec lui : le CRM
 * OBSERVE le parc (pipeline, santé, MRR), cette surface AGIT dessus. Les deux
 * partagent le préfixe `/crm` parce que c'est le même écran pour l'équipe, pas
 * parce que c'est la même responsabilité.
 *
 * L'auteur (`@CurrentUser()`) est passé à chaque appel : le service en a besoin
 * pour le journal, qui n'accepte pas d'action anonyme.
 *
 * `@HttpCode(200)` sur les POST : ces routes ne créent pas de ressource à une
 * nouvelle adresse, elles rendent l'état à jour du compte.
 */
@Roles('sm_admin')
@Controller('crm')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly conversion: ConversionService,
  ) {}

  // ─── Statut de compte ───

  /** Fiche « compte » — statut, formule, blocage effectif. Consultation tracée. */
  @Get('tenants/:id/account')
  account(@CurrentUser() actor: JwtPayload, @Param('id') id: string) {
    return this.admin.account(actor, id);
  }

  /** Coupe l'accès (impayé, litige). Motif obligatoire. */
  @HttpCode(200)
  @Post('tenants/:id/suspend')
  suspend(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(TenantSuspendSchema)) body: TenantSuspend,
  ) {
    return this.admin.suspend(actor, id, body);
  }

  /** Rouvre l'accès — le compte repart « actif ». */
  @HttpCode(200)
  @Post('tenants/:id/reactivate')
  reactivate(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(TenantReactivateSchema)) body: TenantReactivate,
  ) {
    return this.admin.reactivate(actor, id, body);
  }

  @Patch('tenants/:id/plan')
  changePlan(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(TenantPlanChangeSchema)) body: TenantPlanChange,
  ) {
    return this.admin.changePlan(actor, id, body);
  }

  /** Note interne — elle s'ajoute au journal, elle ne vit pas ailleurs. */
  @HttpCode(200)
  @Post('tenants/:id/notes')
  addNote(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(TenantNoteSchema)) body: TenantNote,
  ) {
    return this.admin.addNote(actor, id, body);
  }

  // ─── Révocation d'appareil ───

  /**
   * Tablette perdue ou volée : le jeton est détruit immédiatement, l'appareil
   * repart en attente d'appairage avec un code frais à dicter au restaurateur.
   */
  @HttpCode(200)
  @Post('tenants/:id/devices/:deviceId/revoke')
  revokeDevice(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Param('deviceId') deviceId: string,
    @Body(zod(DeviceRevokeSchema)) body: DeviceRevoke,
  ) {
    return this.admin.revokeDevice(actor, id, deviceId, body);
  }

  /** Même geste pour un téléviseur de salle. */
  @HttpCode(200)
  @Post('tenants/:id/screens/:screenId/revoke')
  revokeScreen(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Param('screenId') screenId: string,
    @Body(zod(DeviceRevokeSchema)) body: DeviceRevoke,
  ) {
    return this.admin.revokeScreen(actor, id, screenId, body);
  }

  /**
   * Mot de passe gérant perdu : un NOUVEAU est fabriqué, remis une fois dans
   * la réponse, et le geste s'écrit au journal. Remplace le script CLI lancé
   * contre la production à chaque oubli.
   */
  @HttpCode(200)
  @Post('tenants/:id/owner-reset')
  resetOwner(@CurrentUser() actor: JwtPayload, @Param('id') id: string) {
    return this.conversion.resetOwnerPassword(actor, id);
  }

  // ─── Journal ───

  /** Journal d'un établissement : suspensions, révocations, notes, consultations. */
  @Get('tenants/:id/logs')
  journal(@Param('id') id: string, @Query(zod(AdminLogQuerySchema)) query: AdminLogQuery) {
    return this.admin.journal(id, query);
  }

  /** Journal du parc entier — « qu'a fait l'équipe cette semaine ». */
  @Get('admin-logs')
  allLogs(@Query(zod(AdminLogQuerySchema)) query: AdminLogQuery) {
    return this.admin.allLogs(query);
  }
}
