import { Global, Module } from '@nestjs/common';
import { CapaciteGuard, CapacitesService } from './capacites';

/**
 * LE SECOND AXE DU CONTRÔLE D'ACCÈS — et il a son propre module.
 *
 * `AuthModule` porte les PERMISSIONS (qui es-tu, qu'as-tu le droit de faire) ;
 * celui-ci porte les CAPACITÉS (qu'est-ce que ton restaurant a payé). Les
 * fusionner « puisque les deux gardent des routes » ferait exactement ce que
 * l'architecture cherche à empêcher : mêler un fait de personne et un fait de
 * contrat, jusqu'à ce qu'un refus d'abonnement se présente comme un refus de
 * droits — ou l'inverse.
 *
 * `@Global()` pour la même raison qu'`AuthModule` : `@Capacites(...)` pose son
 * garde sur n'importe quel contrôleur du produit, et ce garde doit pouvoir
 * résoudre son service sans qu'on ait à importer un module de plus dans les
 * vingt modules métier — un import oublié rendrait la garde impossible à
 * instancier, donc la route morte, sur la seule surface qu'on voulait protéger.
 */
@Global()
@Module({
  providers: [CapacitesService, CapaciteGuard],
  exports: [CapacitesService, CapaciteGuard],
})
export class CapacitesModule {}
