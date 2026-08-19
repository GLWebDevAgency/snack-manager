import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PAIRING_CODE_LENGTH, type ScreenPaired } from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { generateDeviceToken, isPairingCodeShape, normalizePairingCode } from './pairing-code';
import { ScreensRepository } from './screens.repository';

/**
 * CAS D'USAGE — appairer un téléviseur.
 *
 * Le seul moment où un humain intervient sur l'écran : il lit six caractères
 * affichés et les recopie. Ensuite, plus jamais. Trois refus distincts, avec
 * trois messages différents, parce que le gérant debout sur son escabeau doit
 * savoir s'il a mal tapé, s'il a trop attendu, ou si quelqu'un l'a devancé.
 */
@Injectable()
export class PairScreenDevice {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: ScreensRepository,
  ) {}

  async execute(input: string): Promise<ScreenPaired> {
    const code = normalizePairingCode(input);
    if (!isPairingCodeShape(code)) {
      throw new BadRequestException(
        `Le code d'appairage compte ${PAIRING_CODE_LENGTH} caractères — vérifiez la saisie.`,
      );
    }

    const screen = await this.repository.findByPairingCode(code);
    if (!screen) {
      throw new NotFoundException(
        'Code inconnu. Générez-en un nouveau depuis « Écrans » dans le back-office.',
      );
    }

    // Un code reste affiché sur un téléviseur, en salle, à la vue de tous :
    // passé un quart d'heure, ce n'est plus un secret. On refuse explicitement
    // plutôt que de laisser un code périmé traîner comme une porte ouverte.
    const now = this.clock.now();
    const expiresAt = screen.pairingCodeExpiresAt;
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      throw new GoneException(
        'Ce code a expiré. Régénérez-en un depuis « Écrans » dans le back-office.',
      );
    }

    const deviceToken = generateDeviceToken();

    // Usage unique, garanti par l'écriture elle-même : la mise à jour n'aboutit
    // que si le code est TOUJOURS posé sur l'écran. Deux appareils lancés en
    // même temps sur le même code — cela arrive quand on installe quatre écrans
    // d'affilée — n'obtiennent jamais deux jetons valides.
    const claimed = await this.repository.claim(screen.id, code, deviceToken, now);
    if (!claimed) {
      throw new ConflictException('Ce code vient d’être utilisé par un autre écran.');
    }

    return {
      screenId: screen.id,
      deviceToken,
      name: screen.name,
      orientation: screen.orientation,
      theme: screen.theme,
    };
  }
}
