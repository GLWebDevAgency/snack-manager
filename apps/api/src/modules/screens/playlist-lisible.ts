import { BadRequestException } from '@nestjs/common';
import type { ScreenScene } from '@sm/contracts';
import { invalidSceneIds } from './screens.repository';

/**
 * Un identifiant de scène illisible vaut une erreur de saisie, pas un 500.
 *
 * Partagée par la gestion des écrans et par l'aperçu : une boucle éditée dans
 * le back-office passe par l'un ou l'autre, et les deux doivent la refuser de
 * la même voix.
 */
export function assertPlaylistIsReadable(playlist: readonly ScreenScene[] | undefined): void {
  const invalid = invalidSceneIds(playlist ?? []);
  if (invalid.length > 0) {
    throw new BadRequestException(`Identifiants de scène invalides : ${invalid.join(', ')}`);
  }
}
