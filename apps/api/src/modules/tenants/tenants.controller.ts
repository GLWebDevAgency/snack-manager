import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { TenantIdentityUpdateSchema, type TenantIdentityUpdate } from '@sm/contracts';
import { Public, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { TenantsService } from './tenants.service';

@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /**
   * L'établissement de la session — nom, couleur, horaires. Tout l'équipage en
   * a besoin pour afficher son propre restaurant, y compris sur une tablette.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Get('tenants/me')
  me(@TenantId() tenantId: string) {
    return this.tenants.byId(tenantId);
  }

  @Roles('owner', 'gerant')
  @Patch('tenants/me/settings')
  updateSettings(@TenantId() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.tenants.updateSettings(tenantId, body);
  }

  /**
   * L'identité de l'enseigne — nom, couleur, adresse, téléphones. Le nom et
   * la couleur repartent vers les tablettes AU BATTEMENT SUIVANT (heartbeat) :
   * aucune ré-installation, aucun geste d'équipe SM.
   */
  @Roles('owner', 'gerant')
  @Patch('tenants/me/identity')
  updateIdentity(
    @TenantId() tenantId: string,
    @Body(zod(TenantIdentityUpdateSchema)) body: TenantIdentityUpdate,
  ) {
    return this.tenants.updateIdentity(tenantId, body);
  }

  @Roles('owner', 'gerant')
  @Patch('tenants/me/hours')
  updateHours(
    @TenantId() tenantId: string,
    @Body() body: { hours: unknown[]; closures?: unknown[] },
  ) {
    return this.tenants.updateHours(tenantId, body.hours, body.closures);
  }

  @Public()
  @Get('public/tenants/:slug')
  publicInfo(@Param('slug') slug: string) {
    return this.tenants.publicBySlug(slug);
  }
}
