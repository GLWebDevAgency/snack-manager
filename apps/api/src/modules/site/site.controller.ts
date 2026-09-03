import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
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

  /*
   * CES DEUX ROUTES PARLENT À UN FOURNISSEUR EXTERNE, ET LUI COÛTE.
   *
   * Rattacher un domaine et en vérifier la propagation appellent le registrar
   * (Railway ou Cloudflare selon la configuration) à CHAQUE requête. Sans
   * limite, un écran qui boucle ou une main lourde sur le bouton épuise notre
   * quota d'API fournisseur — et le quota est partagé par tout le parc, donc
   * un seul restaurant peut empêcher les autres de rattacher leur domaine.
   *
   * Six par minute laissent tout le confort d'usage : on rattache un domaine
   * une fois, et on vérifie sa propagation toutes les quelques minutes, pas
   * toutes les secondes. Les lectures et le détachement ne sont pas limités,
   * ils ne sortent pas de chez nous.
   */
  @Roles('owner', 'gerant')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('site/domains')
  add(@TenantId() tenantId: string, @Body(zod(DomainAddSchema)) body: unknown) {
    return this.addDomain.execute(tenantId, (body as DomainAdd).hostname);
  }

  @Roles('owner', 'gerant')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
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
