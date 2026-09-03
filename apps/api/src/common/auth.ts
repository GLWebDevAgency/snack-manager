import {
  CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { roleSatisfait, type JwtPayload } from '@sm/contracts';
import { SessionAccessService } from './session-access';

export const IS_PUBLIC = 'isPublic';
/** Routes sans authentification (menu public, création de commande en ligne, suivi). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/**
 * Restreint une route à certains rôles (`gerant`, `owner`, `sm_admin`, …).
 *
 * Le rôle du jeton n'est PAS confronté tel quel à cette liste : il est d'abord
 * étendu de ce qu'il subsume (`rolesEndosses`, @sm/contracts). Un décorateur
 * `@Roles('owner', 'gerant')` ouvre donc aussi à `cogerant`, sans que la ligne
 * change — voir `AuthGuard.canActivate` pour ce que ce choix coûte et rapporte.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

export interface AuthedRequest {
  user?: JwtPayload;
  headers: Record<string, string | undefined>;
}

/**
 * Guard global : vérifie le Bearer JWT et attache le payload à req.user.
 * Le tenantId vient TOUJOURS du token, jamais du body — isolation tenant
 * par construction (convention reprise du boilerplate audité).
 *
 * Il porte aussi le STATUT DE COMPTE : un jeton parfaitement valide est refusé
 * si l'établissement qu'il désigne a été suspendu par l'équipe Snack Manager.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly sessions: SessionAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    try {
      req.user = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    // AVANT le contrôle de rôle : un gérant suspendu doit lire pourquoi on lui
    // ferme la porte, pas un 403 muet sur la première route qu'il touche.
    await this.sessions.assertAllows(req.user);

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // ─── LA SUBSOMPTION S'APPLIQUE ICI, ET NULLE PART AILLEURS ───
    //
    // `cogerant` peut tout ce que peut `gerant`. Cette phrase s'écrit UNE fois,
    // en donnée (`ROLES_SUBSUMES`, @sm/contracts), et se relit ici : les 67
    // décorateurs `@Roles('owner', 'gerant')` de l'API restent intacts et
    // continuent de dire vrai. Les modifier un à un aurait été 67 occasions
    // d'en oublier un — et l'oubli est muet : la route refuse un rôle légitime
    // sur un écran qu'on n'ouvre pas tous les jours.
    //
    // Ce qu'elle n'atteint pas : `@Roles('owner')` reste `owner` seul. Un rôle
    // qui subsume `gerant` n'hérite de rien d'autre, donc l'encaissement,
    // l'identité de facturation et les rémunérations restent fermés — un test
    // le prouve route par route (`roles-subsomption.test.ts`).
    if (roles?.length && !roleSatisfait(req.user.role, roles)) {
      throw new ForbiddenException();
    }
    return true;
  }

}

/** Payload JWT complet. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

/** tenantId du token — lève si absent (routes plateforme sm_admin exclues). */
export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user?.tenantId) throw new ForbiddenException('Route tenant-scoped');
  return user.tenantId;
});
