import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth';
import { revisionServie } from './revision';

/**
 * La surface la plus regardée du produit : c'est elle que `scripts/smoke.mjs`
 * interroge après chaque mise en ligne, et elle est PUBLIQUE (`@Public()`).
 *
 * Ce qu'elle publie tient en une règle : de quoi savoir QUI répond et QUELLE
 * révision est servie, rien de plus. Aucune adresse de base, aucun état de
 * dépendance, aucun nom d'hôte interne — un contrôle de santé ouvert à tous ne
 * doit rien apprendre à qui n'a pas à le savoir.
 *
 * `ok` et `service` ne bougent pas : `scripts/smoke.mjs` les exige, et un
 * ancien script qui les lirait continue de fonctionner. Les champs de révision
 * s'AJOUTENT (voir `revision.ts`).
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true, service: 'snack-manager-api', ...revisionServie() };
  }
}
