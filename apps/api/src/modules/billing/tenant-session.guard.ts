import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { JwtPayload } from '@sm/contracts';
import type { AuthedRequest } from '../../common/auth';
import { SessionAccessService } from '../../common/session-access';

/**
 * LA SEULE PORTE QUI RESTE OUVERTE À UN COMPTE SUSPENDU.
 *
 * ─── POURQUOI CE GARDE EXISTE ───
 *
 * `AuthGuard` (common/auth.ts) est global et fait DEUX choses : il vérifie le
 * jeton, puis il relit le statut du compte et refuse tout accès à un
 * établissement suspendu. Cette seconde vérification est juste partout
 * ailleurs — c'est elle qui applique la règle « on ferme ce qui encaisse »
 * (@sm/contracts, admin.ts) — et elle est FAUSSE ici, pour une seule route.
 *
 * Couper à un impayé l'accès à ses propres factures, c'est lui retirer le
 * document dont il a besoin pour payer : le numéro de pièce à mettre en
 * référence du virement, le montant exact, notre IBAN. On suspend un
 * restaurateur pour qu'il régularise, pas pour l'en empêcher. L'écran
 * « Abonnement » est donc le seul qui survit à la suspension, et c'est
 * précisément là qu'il doit lire ce qu'il doit.
 *
 * ─── POURQUOI IL NE MODIFIE PAS `AuthGuard` ───
 *
 * Ajouter une exception de chemin dans le garde global ferait porter à toute
 * l'API la connaissance d'une route particulière, et la prochaine exception
 * s'ajouterait à côté sans que personne ne relise la règle. L'exception vit
 * donc AVEC la surface qui la réclame : `@Public()` désarme le garde global sur
 * ces deux routes-là, et ce garde-ci refait le travail d'authentification —
 * moins la lecture du statut de compte.
 *
 * ─── CE QU'IL VÉRIFIE, ET C'EST PLUS STRICT QUE LE GARDE GLOBAL ───
 *
 *  · jeton signé et non expiré (même secret, même service) ;
 *  · `kind: 'user'` ET un rôle de `ROLES_LECTURE_FACTURATION` — un compte à
 *    mot de passe, pas une session de tablette. Un équipier connecté au PIN sur
 *    la caisse du comptoir n'a rien à faire dans la facturation de son patron,
 *    et une tablette est justement l'appareil qui traîne à portée de tout le
 *    monde ;
 *  · un `tenantId` présent et castable. C'est LUI qui désigne l'établissement,
 *    jamais l'URL : une facture est une donnée financière, et lire celle du
 *    voisin serait une fuite, pas un défaut d'affichage.
 *
 * Le rôle `sm_admin` est refusé ici sans regret : son jeton ne porte aucun
 * tenant, et l'équipe a déjà sa surface — `GET /crm/tenants/:id/billing`.
 */

/**
 * QUI LIT LES FACTURES DE L'ÉTABLISSEMENT — deux rôles, et pas un de plus.
 *
 * `owner` : c'est son abonnement, c'est lui qui règle.
 *
 * `comptable` : c'est son métier. Un rôle « lecture seule sur l'argent » qui ne
 * verrait pas les factures de l'éditeur serait vide de sens — c'est la
 * première pièce qu'on lui demande, et la faire transiter par une capture
 * d'écran du patron ramène le mot de passe partagé qu'on vient de supprimer.
 *
 * `cogerant` en est ABSENT, et c'est la décision, pas un oubli : l'abonnement
 * et l'encaissement restent au propriétaire. Un cogérant tient le service, il
 * ne négocie pas le contrat.
 *
 * ─── CETTE LISTE NE GARDE QUE DE LA LECTURE ───
 *
 * `MyBillingController` ne porte que des `@Get` — c'est la condition posée en
 * tête de ce fichier, et un test l'épingle : l'unique écriture de la surface
 * (`PUT /billing/me/identity`, le SIRET imprimé sur les pièces) vit sur un
 * AUTRE contrôleur, sous le garde global et `@Roles('owner')`. Ajouter un rôle
 * ici n'ouvre donc jamais une écriture par mégarde.
 */
export const ROLES_LECTURE_FACTURATION: readonly string[] = ['owner', 'comptable'];
@Injectable()
export class TenantSessionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    if (payload.kind !== 'user' || !ROLES_LECTURE_FACTURATION.includes(payload.role)) {
      throw new ForbiddenException(
        'Cet espace est réservé au gérant de l’établissement et à son comptable.',
      );
    }

    // Un jeton de restaurant sans tenant n'existe pas en production : s'il s'en
    // présente un, il est forgé ou corrompu. Un 401 vaut mieux qu'une requête
    // Mongo sur `undefined`.
    if (!payload.tenantId || !Types.ObjectId.isValid(payload.tenantId)) {
      throw new UnauthorizedException();
    }

    // Cette route ignore uniquement la suspension COMMERCIALE du tenant. Le
    // compte et sa génération de session restent relus en base, comme sur
    // toutes les autres frontières HTTP et WebSocket : un compte révoqué ou
    // changé de rôle ne lit donc plus une facture, suspension ou pas.
    await this.sessions.assertUserSessionAllows(payload);

    req.user = payload;
    return true;
  }
}
