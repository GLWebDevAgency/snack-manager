import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PAIRING_CODE_LENGTH, type DevicePaired } from '@sm/contracts';
import { CLOCK, type Clock } from './devices.tokens';
import {
  generateDeviceToken,
  isPairingCodeShape,
  normalizePairingCode,
} from '../screens/pairing-code';
import { DevicesRepository } from './devices.repository';
import { toDeviceIdentity } from './devices.view';
import { TenantBrandRepository } from './tenant-brand.repository';

/**
 * CAS D'USAGE — appairer une caisse ou un écran cuisine.
 *
 * Le seul moment où quelqu'un tape autre chose qu'un PIN sur ces tablettes :
 * six caractères, une fois, à l'installation. Ensuite, plus jamais — même
 * après une coupure de courant ou une réinstallation de l'application.
 *
 * Trois refus distincts, avec trois messages différents, parce que la
 * personne qui déballe la tablette doit savoir si elle a mal tapé, si elle a
 * trop attendu, ou si l'autre tablette du carton a pris le code.
 */
@Injectable()
export class PairDeviceUseCase {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: DevicesRepository,
    private readonly tenants: TenantBrandRepository,
  ) {}

  async execute(input: string): Promise<DevicePaired> {
    const code = normalizePairingCode(input);
    if (!isPairingCodeShape(code)) {
      throw new BadRequestException(
        `Le code d'appairage compte ${PAIRING_CODE_LENGTH} caractères — vérifiez la saisie.`,
      );
    }

    const device = await this.repository.findByPairingCode(code);
    if (!device) {
      throw new NotFoundException(
        'Code inconnu. Générez-en un nouveau depuis « Caisses & cuisine » dans le back-office.',
      );
    }

    // Un code affiché sur l'écran du bureau, dans un restaurant où passent des
    // saisonniers : passé un quart d'heure, ce n'est plus un secret. On refuse
    // explicitement plutôt que de laisser une porte ouverte.
    const now = this.clock.now();
    const expiresAt = device.pairingCodeExpiresAt;
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      throw new GoneException(
        'Ce code a expiré. Régénérez-en un depuis « Caisses & cuisine » dans le back-office.',
      );
    }

    // La marque est lue AVANT de consommer le code : si l'établissement a
    // disparu entre-temps, mieux vaut échouer sans avoir brûlé le code — le
    // gérant peut réessayer sans repasser par le back-office.
    const tenant = await this.tenants.byId(device.tenantId);
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    const deviceToken = generateDeviceToken();

    // Usage unique, garanti par l'écriture elle-même : la mise à jour n'aboutit
    // que si le code est TOUJOURS posé sur l'appareil. La caisse et l'écran
    // cuisine déballés en même temps ne peuvent pas se partager un jeton.
    const claimed = await this.repository.claim(device.id, code, deviceToken, now);
    if (!claimed) {
      throw new ConflictException('Ce code vient d’être utilisé par un autre appareil.');
    }

    return { deviceToken, tenant, device: toDeviceIdentity(device) };
  }
}
