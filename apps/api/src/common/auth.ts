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
import type { JwtPayload } from '@sm/contracts';

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
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
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

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.role)) {
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
