import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuPopularityService } from './menu-popularity.service';
import { TenantsModule } from '../tenants/tenants.module';
// La carte servie au POS et en ligne tire ses modificateurs de la recette :
// le menu dépend du contexte supply, jamais l'inverse.
import { SupplyModule } from '../supply/supply.module';
// La carte DÉRIVE `photoUrl` de la médiathèque : le menu en dépend, jamais
// l'inverse — un média ne sait pas ce qu'est un produit.
import { MediathequeModule } from '../mediatheque/mediatheque.module';

@Module({
  imports: [TenantsModule, SupplyModule, MediathequeModule],
  controllers: [MenuController],
  providers: [MenuService, MenuPopularityService],
  // Exporté pour que le module ordering serve exactement le même menu public
  // (sans quoi la requête serait dupliquée et finirait par diverger).
  exports: [MenuService],
})
export class MenuModule {}
