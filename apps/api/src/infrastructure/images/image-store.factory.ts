import { Logger } from '@nestjs/common';

import { readNonEmpty, type ConfigSource } from '../config-source';
import type { FactoryLogger } from '../factory-logger';
import { NoopImageStore, type ImageStore } from './image-store';
import { R2ImageStore } from './r2-image-store';

/**
 * Choix du magasin d'images — même règle que Stripe et les alertes : la
 * présence des variables EST l'interrupteur, et la fabrique ne lève jamais.
 *
 *   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID → Cloudflare R2
 *     (+ SM_IMAGES_BUCKET pour changer de bucket, défaut `sm-images`)
 *
 * Ce sont LES MÊMES secrets que la sauvegarde nocturne : les poser une fois
 * sur Railway arme les deux. Sans eux, l'écran Paramètres du gérant dit que
 * l'envoi de logo n'est pas encore activé — il ne fait pas semblant.
 */
export function createImageStore(
  get: ConfigSource,
  logger: FactoryLogger = new Logger('ImageStoreFactory'),
): ImageStore {
  const token = readNonEmpty(get, 'CLOUDFLARE_API_TOKEN');
  const accountId = readNonEmpty(get, 'CLOUDFLARE_ACCOUNT_ID');

  if (!token || !accountId) {
    if (token || accountId) {
      logger.warn(
        "Images : configuration incomplète (il faut CLOUDFLARE_API_TOKEN ET CLOUDFLARE_ACCOUNT_ID) — magasin désactivé",
      );
    } else {
      logger.log("Images : aucun fournisseur configuré — l'envoi de logo est désactivé");
    }
    return new NoopImageStore();
  }

  const bucket = readNonEmpty(get, 'SM_IMAGES_BUCKET') ?? 'sm-images';
  logger.log(`Images : Cloudflare R2, bucket « ${bucket} »`);
  return new R2ImageStore(token, accountId, bucket);
}
