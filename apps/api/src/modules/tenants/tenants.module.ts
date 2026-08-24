import { Module } from '@nestjs/common';
import { LogoController } from './logo.controller';
import { LogoService } from './logo.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [TenantsController, LogoController],
  providers: [TenantsService, LogoService],
  exports: [TenantsService],
})
export class TenantsModule {}
