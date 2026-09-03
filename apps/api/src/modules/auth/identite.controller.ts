import { Body, Controller, Get, Patch } from '@nestjs/common';
import { AuthMeUpdateSchema, type AuthMe, type AuthMeUpdate, type JwtPayload } from '@sm/contracts';
import { CurrentUser } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { IdentiteService } from './identite.service';

/**
 * `GET /auth/me` — la personne connectée. `PATCH /auth/me` — son nom.
 *
 * ─── AUCUN `@Roles`, ET C'EST LE POINT ───
 *
 * Toute session authentifiée a le droit de savoir qui elle est : le
 * propriétaire sur son téléphone, l'équipier derrière son code, l'équipe Snack
 * Manager sur son CRM. Restreindre par rôle reviendrait à cacher son propre nom
 * à quelqu'un qui vient de le prouver. Le garde global suffit : sans jeton
 * valide, on n'entre pas ; avec, on ne lit que SOI — le sujet vient du jeton,
 * jamais d'un paramètre.
 *
 * L'ÉCRITURE SUIT LA MÊME RÈGLE, et pour la même raison : poser son propre nom
 * n'est pas un privilège de rôle. Ce qui la borne n'est donc pas un `@Roles`
 * mais la NATURE de la session — un porteur de code n'a pas de compte à
 * renommer, et le service le refuse en le disant (voir `poserMonNom`).
 *
 * ─── POURQUOI UN CONTRÔLEUR À PART ───
 *
 * `AuthController` porte `@UseGuards(ThrottlerGuard)` et dix essais par minute
 * et par adresse : le bon réglage pour une CONNEXION, qu'un dictionnaire
 * martèle. Cette route-ci est appelée à chaque ouverture de back-office, et un
 * restaurant sort par une SEULE adresse publique : le comptoir, la cuisine et
 * le bureau useraient le quota en un service, et les écrans perdraient leur
 * identité sans que rien n'explique pourquoi.
 *
 * Elle n'a donc pas de limite propre — comme la quasi-totalité des routes du
 * logiciel, le garde de débit étant posé route par route (cf. `app.module.ts`)
 * là où la force brute paie quelque chose. Ici elle ne paie rien : il faut
 * déjà un jeton valide, et la réponse ne dit que ce que son porteur sait.
 */
@Controller('auth')
export class IdentiteController {
  constructor(private readonly identite: IdentiteService) {}

  @Get('me')
  moi(@CurrentUser() session: JwtPayload): Promise<AuthMe> {
    return this.identite.moi(session);
  }

  /**
   * Le nom de la personne connectée — le seul champ qu'elle écrit sur
   * elle-même. La réponse est celle de `GET /auth/me`, projetée à l'identique :
   * l'écran qui vient d'enregistrer repart avec l'état qu'il aurait relu.
   */
  @Patch('me')
  poserMonNom(
    @CurrentUser() session: JwtPayload,
    @Body(zod(AuthMeUpdateSchema)) body: AuthMeUpdate,
  ): Promise<AuthMe> {
    return this.identite.poserMonNom(session, body);
  }
}
