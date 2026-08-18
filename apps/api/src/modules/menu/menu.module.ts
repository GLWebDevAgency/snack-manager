import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TenantsModule],
  controllers: [MenuController],
  providers: [MenuService],
  // Exporté pour que le module ordering serve exactement le même menu public
  // (sans quoi la requête serait dupliquée et finirait par diverger).
  exports: [MenuService],
})
export class MenuModule {}
