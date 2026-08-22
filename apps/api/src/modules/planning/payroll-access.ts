import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '@sm/contracts';
import type { AuthedRequest } from '../../common/auth';

/**
 * QUI A LE DROIT DE LIRE UNE RÉMUNÉRATION.
 *
 * Un salaire est une donnée personnelle. Le back-office et la caisse partagent
 * le même mécanisme de jeton, mais pas la même exigence : la tablette du
 * comptoir s'ouvre à quatre chiffres, tapés devant tout le monde, et le jeton
 * qu'elle obtient porte le rôle du membre d'équipe — `gerant` compris. Se
 * contenter de `@Roles('owner', 'gerant')` laisserait donc un équipier lire le
 * coût horaire de son collègue en tapotant l'écran du comptoir.
 *
 * D'où la double condition, et le fait qu'elle vive dans UNE seule fonction :
 *  - `kind === 'user'` : le jeton vient d'une connexion e-mail + mot de passe,
 *    pas d'un PIN de tablette ;
 *  - `role === 'owner'` : le patron, pas son équipe.
 *
 * Cette fonction est le seul endroit où la règle est écrite. Le garde
 * `PayrollGuard` ferme les routes entièrement consacrées à l'argent ; la
 * lecture du planning, elle, reste ouverte au gérant mais sort avec tous ses
 * montants à `null` (cf. `PlanningPayrollAccess`). Deux points d'application,
 * une seule règle.
 */
export function canReadPayroll(user: JwtPayload | undefined | null): boolean {
  return user?.kind === 'user' && user.role === 'owner';
}

export const PAYROLL_FORBIDDEN_MESSAGE =
  'Les rémunérations sont réservées au compte propriétaire — une session ouverte au code PIN n’y a pas accès.';

/**
 * Ferme une route dont la réponse EST un montant de rémunération : la masquer
 * n'aurait pas de sens, il ne resterait rien à renvoyer.
 */
@Injectable()
export class PayrollGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const { user } = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!canReadPayroll(user)) throw new ForbiddenException(PAYROLL_FORBIDDEN_MESSAGE);
    return true;
  }
}
