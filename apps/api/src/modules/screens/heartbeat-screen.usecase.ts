import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ScreenHeartbeat } from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { MenuBoardRepository } from './menu-board.repository';
import { renderScreenContent } from './render-screen-content';
import { requirePairedScreen } from './screen-access';
import { ScreensRepository } from './screens.repository';

/**
 * CAS D'USAGE — battement de cœur.
 *
 * Il rend deux services à la fois, et c'est voulu :
 *
 *  1. il date le dernier signe de vie, seule source du « écran hors ligne
 *     depuis 20 min » du back-office — l'unique panne possible sur ce produit
 *     est un écran muet, et personne ne monte vérifier une clé HDMI au plafond ;
 *  2. il renvoie l'empreinte du contenu. L'écran ne retélécharge la carte que
 *     si elle a changé, ce qui tient sur une connexion fatiguée et évite de
 *     repeindre l'écran — donc de casser une animation — pour rien.
 */
@Injectable()
export class HeartbeatScreen {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly screens: ScreensRepository,
    private readonly board: MenuBoardRepository,
  ) {}

  async execute(deviceToken: string): Promise<ScreenHeartbeat> {
    const screen = await requirePairedScreen(this.screens, deviceToken);
    const now = this.clock.now();

    await this.screens.touch(screen.id, now);

    const snapshot = await this.board.snapshot(screen.tenantId, now);
    if (!snapshot) throw new NotFoundException('Établissement introuvable');

    return {
      ok: true,
      at: now.toISOString(),
      contentHash: renderScreenContent(screen, snapshot, now).contentHash,
    };
  }
}
