import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CAPACITE_NON_SOUSCRITE_CODE,
  capaciteNonSouscriteMessage,
  capacitesEffectives,
  type Capacite,
  type SouscriptionLue,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import type { AuthedRequest } from './auth';

/**
 * LA GARDE DE CAPACITÉ — « ce restaurant a-t-il payé pour cette fonction ? ».
 *
 * Le second axe du contrôle d'accès, et il ne se mélange pas au premier :
 * `@Roles(...)` (cf. `auth.ts`) répond à « cette PERSONNE a-t-elle le droit »,
 * ce décorateur répond à « cet ÉTABLISSEMENT a-t-il souscrit ». Le contrôle
 * est un ET, les deux sources restent séparées, et leurs refus ne se
 * ressemblent pas :
 *
 *  · un manque de droit est un REFUS — 403 nu, rien à négocier ;
 *  · un manque de capacité est une PROPOSITION COMMERCIALE — la fonction
 *    existe, elle n'est pas achetée, et le message le dit avec le code
 *    `capacite_non_souscrite` pour que le front sache faire la différence.
 *
 * Le catalogue vit dans le contrat (`@sm/contracts/capacites`) : ce fichier ne
 * connaît AUCUN nom de formule, et ne doit jamais en connaître.
 *
 * ─── OÙ CETTE GARDE N'A RIEN À FAIRE ───
 *
 * Sur une surface PUBLIQUE. Un client qui commande son kebab n'a pas à
 * recevoir un 403 parce que le restaurant a laissé tomber une option : la page
 * publique se ferme comme une pause de service (`publicOrderingState`, qui
 * porte la règle pour toute la maison). Un refus franc est réservé aux routes
 * d'ADMINISTRATION, où c'est le restaurateur lui-même qui est devant l'écran
 * et où la phrase lui est adressée.
 */

/** Clé de métadonnée — lue par `CapaciteGuard`, jamais ailleurs. */
export const CAPACITES_REQUISES = 'capacitesRequises';

/** Les trois champs du tenant dont le calcul a besoin, et pas un de plus. */
export const SOUSCRIPTION_FIELDS = {
  plan: 1,
  onlineOrdering: 1,
  derogationsCapacite: 1,
} as const;

/**
 * Lit la souscription d'un établissement et en déduit ses capacités.
 *
 * Une LECTURE, jamais un stockage : les capacités effectives se recalculent à
 * chaque fois depuis le catalogue. Les figer en base les désynchroniserait au
 * premier changement d'offre, en silence, sur les seuls tenants déjà créés.
 */
@Injectable()
export class CapacitesService {
  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

  async pourTenant(tenantId: string): Promise<readonly Capacite[]> {
    const doc = await this.tenants
      .findById(tenantId, SOUSCRIPTION_FIELDS)
      .lean<SouscriptionLue | null>();
    // Un tenant introuvable n'est pas un tenant sans capacités : `AuthGuard`
    // vient de vérifier son existence, donc l'absence ici est une anomalie —
    // la traiter comme « il n'a rien souscrit » afficherait au restaurateur une
    // proposition commerciale pour masquer une base incohérente.
    if (!doc) throw new NotFoundException('Tenant introuvable');
    return capacitesEffectives(doc);
  }
}

@Injectable()
export class CapaciteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capacites: CapacitesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requises = this.reflector.getAllAndOverride<Capacite[]>(CAPACITES_REQUISES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requises?.length) return true;

    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    // `AuthGuard` est GLOBAL et s'exécute avant tout garde de contrôleur : à ce
    // point le jeton est vérifié et le tenant lu. Un `user` absent signifierait
    // que ce garde a été posé sur une route `@Public()` — une capacité n'a rien
    // à dire à un anonyme, et le refus l'annonce plutôt que de lire `undefined`.
    if (!user?.tenantId) throw new ForbiddenException('Route tenant-scoped');

    const effectives = await this.capacites.pourTenant(user.tenantId);
    const manquante = requises.find((c) => !effectives.includes(c));
    if (!manquante) return true;

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: capaciteNonSouscriteMessage(manquante),
      code: CAPACITE_NON_SOUSCRITE_CODE,
      /** La capacité manquante, pour que l'écran sache quoi proposer. */
      capacite: manquante,
    });
  }
}

/**
 * Exige une ou plusieurs capacités sur une route ou un contrôleur.
 *
 * Le décorateur POSE LUI-MÊME son garde (`applyDecorators`), et ce n'est pas
 * une commodité : un `@Capacites(...)` sans `@UseGuards(CapaciteGuard)` serait
 * une annotation parfaitement lisible et parfaitement inerte — le genre de
 * configuration qui a l'air juste et ne fait rien. La même faute avait déjà
 * laissé `EncaissementController` sans contrôle de rôle.
 *
 * Composable avec `@Roles(...)` : les deux s'écrivent l'une sous l'autre, sont
 * évaluées l'une après l'autre (le garde global de rôle d'abord), et gardent
 * chacune leur message.
 */
export const Capacites = (...capacites: Capacite[]) =>
  applyDecorators(SetMetadata(CAPACITES_REQUISES, capacites), UseGuards(CapaciteGuard));
