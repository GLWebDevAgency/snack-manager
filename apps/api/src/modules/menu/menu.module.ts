import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { TenantsModule } from '../tenants/tenants.module';
// La carte servie au POS et en ligne tire ses modificateurs de la recette :
// le menu dépend du contexte supply, jamais l'inverse.
import { SupplyModule } from '../supply/supply.module';

@Module({
  imports: [TenantsModule, SupplyModule],
  controllers: [MenuController],
  providers: [MenuService],
  // Exporté pour que le module ordering serve exactement le même menu public
  // (sans quoi la requête serait dupliquée et finirait par diverger).
  exports: [MenuService],
})
export class MenuModule {}
