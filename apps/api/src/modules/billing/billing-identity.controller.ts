import { Body, Controller, Put } from '@nestjs/common';
import {
  TenantBillingIdentitySchema,
  type JwtPayload,
  type TenantBillingIdentity,
} from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { MyBillingService } from './my-billing.service';

/**
 * L'IDENTITÉ DE FACTURATION DU CLIENT — la seule ÉCRITURE de cette surface.
 *
 * ─── POURQUOI UN CONTRÔLEUR À PART ───
 *
 * `MyBillingController` est marqué `@Public()` : il désarme le garde global
 * pour qu'un établissement SUSPENDU puisse continuer à lire ses factures et
 * régulariser. Son en-tête le dit sans détour — n'y mettre QUE de la lecture.
 *
 * Cette route-ci MODIFIE l'établissement. Elle repasse donc par le garde
 * global, avec ce qu'il apporte : vérification du jeton ET refus d'un compte
 * suspendu. Un gérant suspendu lit ses factures, il ne réécrit pas sa raison
 * sociale — et si l'exception devait un jour être élargie, ce serait une
 * décision prise en connaissance de cause, pas l'effet de bord d'une méthode
 * ajoutée sous une annotation qu'on n'avait pas relue.
 *
 * `@Roles('owner')` : le compte du gérant, jamais une session de tablette au
 * PIN. Le SIRET qui s'imprimera sur les factures n'est pas un réglage de
 * comptoir.
 */
@Controller('billing')
export class BillingIdentityController {
  constructor(private readonly billing: MyBillingService) {}

  /**
   * ENREGISTRE L'IDENTITÉ DE FACTURATION.
   *
   * `PUT` et non `PATCH` : le corps porte le formulaire ENTIER, et une chaîne
   * vide y signifie « effacé ». Avec `PATCH`, effacer un SIRET erroné
   * demanderait de distinguer « champ absent » de « champ vidé » — deux
   * intentions que personne ne distingue à la relecture six mois plus tard.
   *
   * L'établissement vient du JETON. Il n'y a aucun paramètre d'URL : nul ne
   * peut écrire l'identité de facturation d'un autre restaurant.
   */
  @Roles('owner')
  @Put('me/identity')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(TenantBillingIdentitySchema)) body: TenantBillingIdentity,
  ) {
    return this.billing.updateIdentity(tenantId, body, user);
  }
}
