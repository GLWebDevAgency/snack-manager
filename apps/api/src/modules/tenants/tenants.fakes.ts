import type { ConfigService } from '@nestjs/config';
import { OriginesImages } from './origines-images';

/**
 * `OriginesImages` sans ConfigService — mêmes deux variables, en clair.
 *
 * Le défaut REPRODUIT le déploiement : un domaine public dont tout hôte
 * d'image est un sous-domaine. Un test qui a besoin d'un hôte hors domaine
 * (le magasin d'images, l'API de développement) le nomme explicitement, et
 * c'est ce qu'on veut lire dans le test.
 *
 * Le même helper sert les deux routes `PATCH …/marque` (restaurateur et CRM) :
 * elles doivent partager la liste, pas seulement la fonction.
 */
export function testOriginesImages(
  racinePublique = 'snackmanager.fr',
  ...origines: string[]
): OriginesImages {
  const valeurs: Record<string, string> = {
    PUBLIC_ROOT_DOMAIN: racinePublique,
    SM_IMAGE_ORIGINS: origines.join(','),
  };
  return new OriginesImages({
    get: (key: string) => valeurs[key],
  } as unknown as ConfigService);
}
