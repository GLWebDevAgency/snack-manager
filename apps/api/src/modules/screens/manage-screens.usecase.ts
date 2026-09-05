import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PAIRING_CODE_TTL_MS,
  type ScreenCreate,
  type ScreenUpdate,
  type ScreenView,
} from '@sm/contracts';
import { CLOCK, type Clock } from './screens.tokens';
import { buildDefaultPlaylist } from './default-playlist';
import { MenuBoardRepository } from './menu-board.repository';
import { generatePairingCode } from './pairing-code';
import { assertPlaylistIsReadable } from './playlist-lisible';
import { ScreensRepository } from './screens.repository';
import { toScreenView } from './screens.view';

/**
 * CAS D'USAGE — le back-office des écrans (rôles owner / gérant).
 *
 * Le `tenantId` vient TOUJOURS du token : un gérant ne peut ni lister, ni
 * renommer, ni surtout régénérer le code d'appairage d'un écran voisin.
 */
@Injectable()
export class ManageScreens {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: ScreensRepository,
    private readonly board: MenuBoardRepository,
  ) {}

  async list(tenantId: string): Promise<ScreenView[]> {
    const now = this.clock.now();
    const screens = await this.repository.list(tenantId);
    return screens.map((s) => toScreenView(s, now));
  }

  async get(tenantId: string, id: string): Promise<ScreenView> {
    const screen = await this.repository.byId(tenantId, id);
    if (!screen) throw new NotFoundException('Écran introuvable');
    return toScreenView(screen, this.clock.now());
  }

  /**
   * Création : l'écran repart avec une playlist DÉJÀ remplie et un code prêt à
   * saisir. C'est la promesse du produit — brancher une clé HDMI et voir sa
   * carte, sans rien configurer. Une liste de scènes vide à composer à la main
   * laisserait la moitié des restaurants avec un écran noir.
   */
  async create(tenantId: string, dto: ScreenCreate): Promise<ScreenView> {
    assertPlaylistIsReadable(dto.playlist);
    const now = this.clock.now();
    const snapshot = dto.playlist ? null : await this.board.snapshot(tenantId, now);

    const created = await this.repository.create(tenantId, {
      name: dto.name,
      orientation: dto.orientation,
      theme: dto.theme,
      scenography: dto.scenography,
      playlist:
        dto.playlist ??
        (snapshot ? buildDefaultPlaylist(snapshot.categories, snapshot.products) : []),
      pairingCode: generatePairingCode(),
      pairingCodeExpiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    });

    return toScreenView(created, now);
  }

  async update(tenantId: string, id: string, dto: ScreenUpdate): Promise<ScreenView> {
    assertPlaylistIsReadable(dto.playlist);
    const updated = await this.repository.update(tenantId, id, dto);
    if (!updated) throw new NotFoundException('Écran introuvable');
    return toScreenView(updated, this.clock.now());
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: true }> {
    const removed = await this.repository.remove(tenantId, id);
    if (!removed) throw new NotFoundException('Écran introuvable');
    return { deleted: true };
  }

  /**
   * Nouveau code d'appairage.
   *
   * Deux usages, un seul geste : le code a expiré pendant que le gérant
   * cherchait son escabeau, ou la clé HDMI a été remplacée — dans ce second cas
   * l'ancien jeton doit cesser d'ouvrir la carte, ce dont le dépôt se charge.
   */
  async regenerateCode(tenantId: string, id: string): Promise<ScreenView> {
    const now = this.clock.now();
    const updated = await this.repository.resetPairing(
      tenantId,
      id,
      generatePairingCode(),
      new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    );
    if (!updated) throw new NotFoundException('Écran introuvable');
    return toScreenView(updated, now);
  }
}
