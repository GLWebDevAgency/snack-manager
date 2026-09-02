import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  BrandStrictSchema,
  type Brand,
  TenantHoursUpdateSchema,
  type TenantHoursUpdate,
  TenantIdentityUpdateSchema,
  type TenantIdentityUpdate,
  TenantSettingsUpdateSchema,
  type TenantSettingsUpdate,
} from '@sm/contracts';
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

  /**
   * Les réglages du service — créneaux, pause, impression, objectif du jour.
   *
   * Le corps arrivait NU, sans schéma : une liste blanche de clés recopiait les
   * valeurs sans regarder ce qu'elles contenaient. Une liste de clés dit quels
   * champs s'écrivent, jamais avec quoi.
   */
  @Roles('owner', 'gerant')
  @Patch('tenants/me/settings')
  updateSettings(
    @TenantId() tenantId: string,
    @Body(zod(TenantSettingsUpdateSchema)) body: TenantSettingsUpdate,
  ) {
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

  /**
   * Le masque d'identité du restaurateur — ce que voient SES clients. Validé
   * par le contrat en version STRICTE (une clé inattendue dans un corps de
   * requête est une tentative, pas une tolérance), puis le contraste est
   * REJOUÉ ici : l'API ne fait pas confiance à l'écran.
   */
  @Roles('owner', 'gerant')
  @Patch('tenants/me/marque')
  updateMarque(@TenantId() tenantId: string, @Body(zod(BrandStrictSchema)) body: Brand) {
    return this.tenants.updateMarque(tenantId, body);
  }

  /**
   * Les horaires hebdomadaires et les fermetures exceptionnelles.
   *
   * Elle prenait un corps NU — `@Body()` sans pipe, deux `unknown[]` recopiés
   * dans un `$set`. Ces tableaux repartent vers le PUBLIC (`publicBySlug`, la
   * vitrine, le tableau de menu, le calcul des créneaux de retrait) : un corps
   * mal formé ne cassait pas un écran d'administration, il cassait la commande
   * en ligne de tous les clients d'un restaurant. `runValidators` côté service
   * refusait bien l'écriture hors schéma, mais tard et sans rien dire de la
   * FORME d'un créneau — `{ open: '25:99' }` y passait.
   */
  @Roles('owner', 'gerant')
  @Patch('tenants/me/hours')
  updateHours(
    @TenantId() tenantId: string,
    @Body(zod(TenantHoursUpdateSchema)) body: TenantHoursUpdate,
  ) {
    return this.tenants.updateHours(tenantId, body);
  }

  @Public()
  @Get('public/tenants/:slug')
  publicInfo(@Param('slug') slug: string) {
    return this.tenants.publicBySlug(slug);
  }
}
