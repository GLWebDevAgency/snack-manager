import { Module } from '@nestjs/common';
import { LogoController } from './logo.controller';
import { LogoService } from './logo.service';
import { OriginesImages } from './origines-images';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [TenantsController, LogoController],
  // `OriginesImages` est sans état (deux lectures d'environnement) : le CRM la
  // fournit AUSSI de son côté, comme `IssuerConfig`, plutôt que de coupler
  // deux modules pour un singleton de configuration.
  providers: [TenantsService, LogoService, OriginesImages],
  exports: [TenantsService],
})
export class TenantsModule {}
