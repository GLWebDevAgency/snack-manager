import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ScreenContent } from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { MenuBoardRepository } from './menu-board.repository';
import { renderScreenContent } from './render-screen-content';
import { requirePairedScreen } from './screen-access';
import { ScreensRepository } from './screens.repository';

/**
 * CAS D'USAGE — tout ce que l'écran doit afficher, en un seul appel.
 *
 * Un aller-retour et pas deux : le wifi d'un snack tombe, et une réponse
 * partielle laisserait l'écran avec une identité de restaurant sans carte, ou
 * l'inverse. Le contenu est atomique, l'écran le met en cache tel quel et le
 * rejoue au démarrage quand la connexion manque.
 *
 * Tout le calcul vit dans `renderScreenContent`, fonction pure : ce cas d'usage
 * ne fait qu'authentifier, lire, et dater.
 */
@Injectable()
export class BuildScreenContent {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly screens: ScreensRepository,
    private readonly board: MenuBoardRepository,
  ) {}

  async execute(deviceToken: string): Promise<ScreenContent> {
    const screen = await requirePairedScreen(this.screens, deviceToken);
    const now = this.clock.now();

    const snapshot = await this.board.snapshot(screen.tenantId, now);
    // L'établissement a disparu sous l'écran : c'est anormal, et il vaut mieux
    // que la clé HDMI rejoue son cache qu'elle n'affiche une carte vide.
    if (!snapshot) throw new NotFoundException('Établissement introuvable');

    return renderScreenContent(screen, snapshot, now);
  }
}
