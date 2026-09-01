import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  DeviceCreateSchema,
  DeviceHeartbeatBodySchema,
  DevicePinLoginSchema,
  DeviceUpdateSchema,
  PairDeviceSchema,
  type DeviceCreate,
  type DeviceHeartbeatBody,
  type DevicePinLogin as DevicePinLoginDto,
  type DeviceUpdate,
  type PairDevice,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public, Roles, TenantId } from '../../common/auth';
import { readDeviceToken } from './device-access';
import { DevicePinLogin } from './device-pin-login.usecase';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { HeartbeatDevice } from './heartbeat-device.usecase';
import { ManageDevices } from './manage-devices.usecase';
import { PairDeviceUseCase } from './pair-device.usecase';

/**
 * « Caisses & cuisine » — les appareils de terrain.
 *
 * Deux publics, deux régimes d'authentification, exactement comme pour les
 * écrans de salle :
 *
 *  - le BACK-OFFICE (owner / gérant), avec le `tenantId` pris dans le token ;
 *  - les APPAREILS eux-mêmes, publics au sens de Nest mais authentifiés par
 *    leur jeton d'appareil. Une tablette n'a ni compte ni session : son jeton
 *    porte à la fois son identité et son établissement, si bien qu'aucune
 *    route appareil n'accepte de `tenantId` ni de `tenantSlug`.
 *
 * Le contrôleur ne contient aucune règle : il traduit HTTP ⇄ cas d'usage.
 */
@Controller()
export class DevicesController {
  constructor(
    private readonly manage: ManageDevices,
    private readonly pair: PairDeviceUseCase,
    private readonly heartbeat: HeartbeatDevice,
    private readonly pinLogin: DevicePinLogin,
  ) {}

  // ─── Back-office (owner / gérant) ───

  @Roles('owner', 'gerant')
  @Get('devices')
  list(@TenantId() tenantId: string) {
    return this.manage.list(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('devices')
  create(@TenantId() tenantId: string, @Body(zod(DeviceCreateSchema)) body: unknown) {
    return this.manage.create(tenantId, body as DeviceCreate);
  }

  @Roles('owner', 'gerant')
  @Get('devices/:id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.get(tenantId, id);
  }

  @Roles('owner', 'gerant')
  @Patch('devices/:id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(DeviceUpdateSchema)) body: unknown,
  ) {
    return this.manage.update(tenantId, id, body as DeviceUpdate);
  }

  @Roles('owner', 'gerant')
  @Delete('devices/:id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.remove(tenantId, id);
  }

  /** Code expiré, ou tablette perdue : un nouveau code, l'ancien jeton révoqué. */
  @Roles('owner', 'gerant')
  @Post('devices/:id/regenerate-code')
  regenerateCode(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.manage.regenerateCode(tenantId, id);
  }

  // ─── Appareils (jeton d'appareil) ───

  // Un code d'appairage fait 6 caractères sur 31 possibles et vit 15 minutes :
  // sans limite, il se devine ; à 10 essais/minute, jamais.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('public/devices/pair')
  pairDevice(@Body(zod(PairDeviceSchema)) body: unknown) {
    return this.pair.execute(body as PairDevice);
  }

  @Public()
  @HttpCode(200)
  @Post('public/devices/heartbeat')
  beat(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(zod(DeviceHeartbeatBodySchema)) body: DeviceHeartbeatBody,
  ) {
    return this.heartbeat.execute(readDeviceToken(headers, body.deviceToken), {
      appVersion: body.appVersion,
      queueDepth: body.queueDepth,
      lastError: body.lastError,
    });
  }

  /**
   * Ouverture de service par PIN.
   *
   * L'établissement vient du jeton d'appareil — en-tête `x-device-token`, ou
   * corps quand la file hors ligne rejoue une requête persistée. Jamais du
   * corps sous forme de slug : c'est précisément ce qu'on remplace ici.
   */
  // Un PIN à 4-6 chiffres est LE gibier de la force brute. 15/min laisse un
  // équipier fébrile retenter, pas un script énumérer.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Public()
  @HttpCode(200)
  @Post('public/devices/pin')
  pin(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body(zod(DevicePinLoginSchema)) body: DevicePinLoginDto,
  ) {
    return this.pinLogin.execute(readDeviceToken(headers, body.deviceToken), body.pin);
  }
}
