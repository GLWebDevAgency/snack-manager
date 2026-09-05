import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SCENOGRAPHY_DEFAULT, type ScreenContent, type ScreenPreview } from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { buildDefaultPlaylist } from './default-playlist';
import { MenuBoardRepository } from './menu-board.repository';
import { assertPlaylistIsReadable } from './playlist-lisible';
import { renderScreenContent } from './render-screen-content';
import { ScreensRepository, type StoredScreen } from './screens.repository';

/**
 * CAS D'USAGE — l'écran tel qu'il serait, vu du back-office.
 *
 * Le tiroir « Apparence » montre un téléviseur miniature qui joue la vraie
 * boucle avec la vraie carte. Il n'a ni jeton d'appareil, ni battement de
 * cœur, et il n'écrit rien : on compose un écran VIRTUEL depuis l'écran
 * désigné (ou les défauts), on lui applique les surcharges du brouillon, et
 * on passe par le même rendu que la clé HDMI — c'est la seule façon de
 * garantir que ce que le gérant voit est ce que le client verra.
 */
@Injectable()
export class PreviewScreenContent {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly screens: ScreensRepository,
    private readonly board: MenuBoardRepository,
  ) {}

  async execute(tenantId: string, dto: ScreenPreview): Promise<ScreenContent> {
    assertPlaylistIsReadable(dto.playlist);
    const now = this.clock.now();

    const base = dto.screenId ? await this.screens.byId(tenantId, dto.screenId) : null;
    if (dto.screenId && !base) throw new NotFoundException('Écran introuvable');

    const snapshot = await this.board.snapshot(tenantId, now);
    if (!snapshot) throw new NotFoundException('Établissement introuvable');

    const virtuel: StoredScreen = {
      id: base?.id ?? 'preview',
      tenantId,
      name: base?.name ?? 'Aperçu',
      pairingCode: null,
      pairingCodeExpiresAt: null,
      paired: true,
      orientation: dto.orientation ?? base?.orientation ?? 'landscape',
      theme: dto.theme ?? base?.theme ?? 'brand',
      scenography: dto.scenography ?? base?.scenography ?? SCENOGRAPHY_DEFAULT,
      playlist:
        dto.playlist ??
        base?.playlist ??
        buildDefaultPlaylist(snapshot.categories, snapshot.products),
      lastSeenAt: null,
      // Un aperçu est toujours « actif » : un écran désactivé montre sa veille
      // sur le téléviseur, mais le gérant qui règle l'apparence veut voir la carte.
      active: true,
    };

    return renderScreenContent(virtuel, snapshot, now, dto.service);
  }
}
