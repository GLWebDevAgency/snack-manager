import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Public, Roles, TenantId } from '../../common/auth';
import { TenantsService } from './tenants.service';

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('tenants/me')
  me(@TenantId() tenantId: string) {
    return this.tenants.byId(tenantId);
  }

  @Roles('owner', 'gerant')
  @Patch('tenants/me/settings')
  updateSettings(@TenantId() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.tenants.updateSettings(tenantId, body);
  }

  @Public()
  @Get('public/tenants/:slug')
  publicInfo(@Param('slug') slug: string) {
    return this.tenants.publicBySlug(slug);
  }
}
