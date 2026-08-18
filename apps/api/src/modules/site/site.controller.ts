import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { zod } from '../../common/zod.pipe';
import { Public, Roles, TenantId } from '../../common/auth';
import { DomainAddSchema, type DomainAdd } from './site.dto';
import { AddCustomDomain } from './add-custom-domain.usecase';
import { CheckDomainStatus } from './check-domain-status.usecase';
import { ListSiteAddresses } from './list-site-addresses.usecase';
import { RemoveCustomDomain } from './remove-custom-domain.usecase';
import { ResolveTenantByHost } from './resolve-tenant-by-host.usecase';

/**
 * Module « Votre site web ».
 *
 * Le contrôleur ne contient aucune règle : il traduit HTTP ⇄ cas d'usage.
 * Le `tenantId` vient TOUJOURS du token (jamais du body ni de l'URL), donc un
 * gérant ne peut pas manipuler les domaines d'un autre établissement.
 */
@Controller()
export class SiteController {
  constructor(
    private readonly listAddresses: ListSiteAddresses,
    private readonly addDomain: AddCustomDomain,
    private readonly checkDomain: CheckDomainStatus,
    private readonly removeDomain: RemoveCustomDomain,
    private readonly resolveHost: ResolveTenantByHost,
  ) {}

  // ─── Back-office (owner / gérant) ───

  @Roles('owner', 'gerant')
  @Get('site/domains')
  list(@TenantId() tenantId: string) {
    return this.listAddresses.execute(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('site/domains')
  add(@TenantId() tenantId: string, @Body(zod(DomainAddSchema)) body: unknown) {
    return this.addDomain.execute(tenantId, (body as DomainAdd).hostname);
  }

  @Roles('owner', 'gerant')
  @Post('site/domains/:id/check')
  check(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.checkDomain.execute(tenantId, id);
  }

  @Roles('owner', 'gerant')
  @Delete('site/domains/:id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.removeDomain.execute(tenantId, id);
  }

  // ─── Site public ───

  /**
   * Appelée par le middleware du site public à chaque requête entrante, avant
   * toute authentification : c'est elle qui décide de quel restaurant il s'agit.
   */
  @Public()
  @Get('public/resolve')
  resolve(@Query('host') host?: string) {
    if (!host?.trim()) throw new BadRequestException('Paramètre « host » requis');
    return this.resolveHost.execute(host);
  }
}
