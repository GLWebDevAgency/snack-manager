import { Controller, Get } from '@nestjs/common';
import type { AuthMe, JwtPayload } from '@sm/contracts';
import { CurrentUser } from '../../common/auth';
import { IdentiteService } from './identite.service';

/**
 * `GET /auth/me` — la personne connectée.
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
}
