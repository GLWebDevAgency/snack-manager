import { Module } from '@nestjs/common';
import { OriginesImages } from '../tenants/origines-images';
import { MediasController } from './medias.controller';
import { MediasService } from './medias.service';

/**
 * LA MÉDIATHÈQUE — les images d'un restaurant, qui lui appartiennent.
 *
 * Le module ne connaît que deux collections (`medias` et `products`) et le
 * port `ImageStore` ; les modèles Mongoose viennent de `DatabaseModule`
 * (@Global), l'adaptateur R2 d'`InfrastructureModule` (@Global).
 *
 * `MediasService` est EXPORTÉ parce que trois autres modules en dépendent pour
 * dériver `photoUrl` — le menu, la commande en ligne (vitrine) et les écrans
 * de salle. C'est le sens de la dépendance qui compte : la médiathèque ne
 * connaît ni la carte, ni la vitrine, ni le téléviseur. Elle sert des médias ;
 * ce sont eux qui viennent les chercher.
 *
 * `OriginesImages` est fourni ici comme le module tenants et le CRM le font
 * chacun de leur côté : deux lectures d'environnement sans état ne justifient
 * pas de coupler deux modules pour un singleton de configuration.
 */
@Module({
  controllers: [MediasController],
  providers: [MediasService, OriginesImages],
  exports: [MediasService],
})
export class MediathequeModule {}
