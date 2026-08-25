import { Controller, Get, Post } from '@nestjs/common';
import type { EncaissementFiche, EncaissementLien } from '@sm/contracts';

import { Roles, TenantId } from '../../common/auth';
import { EncaissementService } from './encaissement.service';

/**
 * L'ÉCRAN « ENCAISSEMENT EN LIGNE » DU RESTAURATEUR.
 *
 * Trois gestes, et aucun de plus : voir où j'en suis, me raccorder, vérifier
 * que Stripe a validé. Le restaurateur ne saisit ici NI coordonnées bancaires,
 * NI pièce d'identité — tout cela se passe chez Stripe, qui porte
 * l'identification du marchand et la lutte anti-blanchiment. C'est ce
 * transfert de responsabilité qui rend le montage tenable pour un éditeur
 * seul, et il se voit dans la minceur de ce contrôleur.
 *
 * ─── CLOISONNEMENT ───
 *
 * `@TenantId()` et JAMAIS un identifiant d'URL : un gérant ne raccorde que SON
 * établissement, et son jeton dit lequel. C'est l'exact inverse des routes
 * `/crm`, trans-tenant et réservées à l'équipe SM.
 *
 * `@Roles('owner')` sur la CLASSE, même règle que l'identité de facturation :
 * le compte du gérant, jamais une session de tablette au PIN. Raccorder un
 * compte marchand crée une entité bancaire au nom de l'établissement et rend
 * un lien où l'on saisit un IBAN — sans ce garde, un équipier connecté au
 * comptoir pouvait ouvrir ce compte et y déclarer SES coordonnées bancaires
 * comme compte de versement du restaurant. Le garde global ne filtre que si
 * l'annotation existe : son absence était une porte ouverte, pas un défaut.
 */
@Roles('owner')
@Controller('encaissement')
export class EncaissementController {
  constructor(private readonly encaissement: EncaissementService) {}

  /** Où en est mon encaissement en ligne ? */
  @Get('me')
  fiche(@TenantId() tenantId: string): Promise<EncaissementFiche> {
    return this.encaissement.ficheDe(tenantId);
  }

  /**
   * Le lien d'inscription Stripe — redemandé à CHAQUE clic, jamais mis en
   * cache : ces liens expirent en quelques minutes, et un lien périmé
   * afficherait une page morte au restaurateur qui croirait le service cassé.
   */
  @Post('me/raccordement')
  raccorder(@TenantId() tenantId: string): Promise<EncaissementLien> {
    return this.encaissement.demarrerRaccordement(tenantId);
  }

  /**
   * Relit les drapeaux chez Stripe — appelé au RETOUR du restaurateur depuis
   * l'inscription. Le webhook `account.updated` fait le même travail, mais il
   * peut arriver quelques secondes après : sans cette relecture, le gérant
   * revient sur un écran qui dit encore « inscription à terminer » alors qu'il
   * vient de la terminer, et il recommence.
   */
  @Post('me/synchroniser')
  async synchroniser(@TenantId() tenantId: string): Promise<EncaissementFiche> {
    const avant = await this.encaissement.ficheDe(tenantId);
    // La relecture est un CONFORT : si elle échoue, l'écran doit tout de même
    // s'afficher avec ce qu'on sait. La faire tomber en erreur donnerait un
    // écran vide au gérant, précisément quand il cherche à comprendre où il
    // en est — `synchroniser` ne lève pas, mais la garantie se pose ici aussi.
    if (avant.compte) {
      try {
        await this.encaissement.synchroniser(avant.compte.accountId);
      } catch {
        return avant;
      }
    }
    return this.encaissement.ficheDe(tenantId);
  }
}
