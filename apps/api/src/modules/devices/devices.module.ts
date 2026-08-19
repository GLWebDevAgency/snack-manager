import { Module } from '@nestjs/common';
import { systemClock } from '@sm/domain';
import { CLOCK } from './devices.tokens';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { TenantBrandRepository } from './tenant-brand.repository';
import { DevicePinLogin } from './device-pin-login.usecase';
import { HeartbeatDevice } from './heartbeat-device.usecase';
import { ManageDevices } from './manage-devices.usecase';
import { PairDeviceUseCase } from './pair-device.usecase';

/**
 * « Caisses & cuisine » — l'appairage des appareils de terrain.
 *
 * Ce module existe pour une raison unique et suffisante : jusqu'ici la caisse
 * portait `TENANT_SLUG = 'classfood'` dans son code source. Le produit ne
 * pouvait servir qu'un seul restaurant, et le changer imposait une
 * recompilation. Un logiciel de caisse multi-restaurants ne se distingue pas
 * d'un logiciel mono-restaurant par ses écrans, mais par cette ligne-là.
 *
 * La réponse n'est pas nouvelle : les téléviseurs de salle s'appairent déjà
 * proprement par code. On réemploie donc leur générateur de code
 * (`../screens/pairing-code`) plutôt que d'en écrire un second, et on garde
 * leur vocabulaire — appairage, code, jeton d'appareil, révocation.
 *
 * Les modèles Mongoose viennent de `DatabaseModule` (@Global) et `JwtService`
 * du `JwtModule` global déclaré par `AuthModule` : ce module ne dépend
 * d'aucun autre.
 */
@Module({
  controllers: [DevicesController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    DevicesRepository,
    TenantBrandRepository,
    ManageDevices,
    PairDeviceUseCase,
    HeartbeatDevice,
    DevicePinLogin,
  ],
})
export class DevicesModule {}
