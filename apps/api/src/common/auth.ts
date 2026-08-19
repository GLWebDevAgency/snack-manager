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
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ACCOUNT_SUSPENDED_CODE,
  ACCOUNT_SUSPENDED_MESSAGE,
  isAccessBlocked,
  type JwtPayload,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';

export const IS_PUBLIC = 'isPublic';
/** Routes sans authentification (menu public, création de commande en ligne, suivi). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restreint une route à certains rôles (`gerant`, `owner`, `sm_admin`, …). */
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
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
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
    await this.assertAccountAllows(req.user);

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }

  /**
   * Statut de compte de l'établissement porté par le jeton.
   *
   * Un jeton reste valide douze heures : sans cette lecture, suspendre un
   * client pour impayé ne prendrait effet qu'à la fin de sa session — soit
   * jusqu'au lendemain matin. La révocation doit être IMMÉDIATE, donc lue à
   * chaque requête.
   *
   * C'est une lecture par `_id` avec projection sur un seul champ : l'index
   * primaire la sert sans toucher au document. On préfère ce coût constant à
   * un cache mémoire qu'il faudrait invalider depuis quatre endroits et qui,
   * le jour où l'API tourne sur deux instances, laisserait un restaurant
   * suspendu continuer à travailler sur l'autre.
   *
   * DEUX EXCEPTIONS, toutes deux délibérées :
   *  - le rôle `sm_admin`, sans quoi suspendre un client nous fermerait notre
   *    propre back-office — c'est de là qu'on le rouvre ;
   *  - les jetons sans tenant, qui ne désignent aucun établissement.
   */
  private async assertAccountAllows(user: JwtPayload): Promise<void> {
    if (user.role === 'sm_admin' || !user.tenantId) return;

    // Un tenantId non castable ferait lever une CastError à Mongoose, donc un
    // 500 : c'est un jeton forgé, il vaut un 401.
    if (!Types.ObjectId.isValid(user.tenantId)) throw new UnauthorizedException();

    const doc = await this.tenants
      .findById(user.tenantId, { 'account.status': 1 })
      .lean<{ account?: { status?: TenantAccountStatus } } | null>();

    // Établissement supprimé sous les pieds d'une session ouverte : le jeton
    // ne désigne plus rien.
    if (!doc) throw new UnauthorizedException();

    // `account` est absent des tenants créés avant ce champ, et `.lean()` ne
    // matérialise pas les défauts Mongoose. L'absence vaut « pas de blocage » :
    // un champ manquant ne doit jamais fermer un restaurant en plein service.
    if (isAccessBlocked(doc.account?.status)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: ACCOUNT_SUSPENDED_MESSAGE,
        // Le web s'appuie sur ce code pour afficher l'écran « compte
        // suspendu » plutôt que de renvoyer le gérant vers la connexion :
        // ses identifiants sont bons, c'est son abonnement qui ne l'est pas.
        code: ACCOUNT_SUSPENDED_CODE,
      });
    }
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
