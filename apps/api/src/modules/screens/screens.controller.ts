import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  PairScreenSchema,
  ScreenCreateSchema,
  ScreenTokenQuerySchema,
  ScreenUpdateSchema,
  type PairScreen,
  type ScreenCreate,
  type ScreenTokenQuery,
  type ScreenUpdate,
} from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { zod } from '../../common/zod.pipe';
import { Public, Roles, TenantId } from '../../common/auth';
import { BuildScreenContent } from './build-screen-content.usecase';
import { HeartbeatScreen } from './heartbeat-screen.usecase';
import { ManageScreens } from './manage-screens.usecase';
import { PairScreenDevice } from './pair-screen.usecase';

/**
 * « Menu Board » — les écrans TV de la salle.
 *
 * Deux publics, deux régimes d'authentification :
 *
 *  - le BACK-OFFICE (owner / gérant), avec le `tenantId` pris dans le token ;
 *  - les ÉCRANS eux-mêmes, publics au sens de Nest mais authentifiés par leur
 *    jeton d'appareil. Un téléviseur n'a ni compte ni session : son jeton porte
 *    à la fois son identité et son établissement, si bien qu'aucune route
 *    écran n'accepte de `tenantId`.
 *
 * Le contrôleur ne contient aucune règle : il traduit HTTP ⇄ cas d'usage.
 */
@Controller()
export class ScreensController {
  constructor(
    private readonly manage: ManageScreens,
    private readonly pair: PairScreenDevice,
    private readonly content: BuildScreenContent,
    private readonly heartbeat: HeartbeatScreen,
  ) {}

  // ─── Back-office (owner / gérant) ───

  @Roles('owner', 'gerant')
  @Get('screens')
  list(@TenantId() tenantId: string) {
    return this.manage.list(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('screens')
  create(@TenantId() tenantId: string, @Body(zod(ScreenCreateSchema)) body: unknown) {
    return this.manage.create(tenantId, body as ScreenCreate);
  }

  @Roles('owner', 'gerant')
  @Get('screens/:id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.get(tenantId, id);
  }

  @Roles('owner', 'gerant')
  @Patch('screens/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(ScreenUpdateSchema)) body: unknown,
  ) {
    return this.manage.update(tenantId, id, body as ScreenUpdate);
  }

  @Roles('owner', 'gerant')
  @Delete('screens/:id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.remove(tenantId, id);
  }

  /** Code expiré, ou clé HDMI remplacée : un nouveau code, l'ancien jeton révoqué. */
  @Roles('owner', 'gerant')
  @Post('screens/:id/regenerate-code')
  regenerateCode(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.regenerateCode(tenantId, id);
  }

  // ─── Écrans (jeton d'appareil) ───

  @Public()
  // Même serrure que l'appairage des tablettes : un code court se devine,
  // 10 essais/minute l'en empêchent.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/screens/pair')
  pairDevice(@Body(zod(PairScreenSchema)) body: unknown) {
    return this.pair.execute((body as PairScreen).pairingCode);
  }

  /**
   * TOUT le contenu de l'écran. Le jeton passe en query plutôt qu'en en-tête :
   * une clé Fire TV pointe une URL, elle ne compose pas d'en-tête HTTP.
   */
  @Public()
  @Get('public/screens/content')
  fetchContent(@Query(zod(ScreenTokenQuerySchema)) query: ScreenTokenQuery) {
    return this.content.execute(query.token);
  }

  @Public()
  @Post('public/screens/heartbeat')
  beat(@Query(zod(ScreenTokenQuerySchema)) query: ScreenTokenQuery) {
    return this.heartbeat.execute(query.token);
  }
}
