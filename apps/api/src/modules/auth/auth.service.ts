import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  isAccessBlocked,
  type JwtPayload,
  type Login,
  type PinLogin,
  type StaffRole,
} from '@sm/contracts';
import type { Staff, Tenant, User } from '@sm/db';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('User') private readonly users: Model<User>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly jwt: JwtService,
  ) {}

  /** Gérant / équipe SM — email + mot de passe. */
  async login({ email, password }: Login) {
    const user = await this.users.findOne({ email: email.toLowerCase() });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const payload: JwtPayload = {
      sub: String(user._id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      role: user.role,
      kind: 'user',
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { email: user.email, name: user.name, role: user.role, tenantId: payload.tenantId },
    };
  }

  /**
   * POS/KDS — PIN sur tablette. Le PIN identifie la personne au sein du
   * tenant ; hashé, donc vérification séquentielle sur la petite équipe.
   */
  async loginPin({ tenantSlug, pin }: PinLogin) {
    const tenant = await this.tenants.findOne({ slug: tenantSlug });
    if (!tenant) throw new UnauthorizedException('Établissement inconnu');

    // Compte suspendu : on refuse D'ÉMETTRE un jeton, pas seulement de le
    // servir. Sans ce refus, la tablette afficherait « connecté » puis
    // échouerait sur chaque appel — un poste de caisse qui ment est pire
    // qu'un poste fermé. L'équipe lit le vrai motif : c'est elle qui
    // préviendra le patron.
    if (isAccessBlocked(tenant.account?.status)) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    const members = await this.staff.find({ tenantId: tenant._id, active: true });
    for (const member of members) {
      if (await argon2.verify(member.pinHash, pin)) {
        const payload: JwtPayload = {
          sub: String(member._id),
          tenantId: String(tenant._id),
          role: member.role,
          kind: 'staff',
        };
        return {
          token: await this.jwt.signAsync(payload),
          staff: { name: member.name, role: member.role },
          tenant: { slug: tenant.slug, name: tenant.name, brandColor: tenant.brandColor },
        };
      }
    }
    throw new UnauthorizedException('PIN invalide');
  }

  /**
   * Re-validation PIN pour action sensible (annulation, remise…) — NF525.
   *
   * Rend le RÔLE avec l'identité, et ce n'est pas un détail de confort :
   * re-saisir un code prouve QUI agit, jamais que cette personne en a le droit.
   * Les appelants n'avaient que le `staffId` et ne pouvaient donc pas faire le
   * second contrôle — n'importe quel code actif du restaurant, cuisine
   * comprise, accordait une remise de n'importe quel montant.
   */
  async verifyPin(tenantId: string, pin: string): Promise<{ staffId: string; role: StaffRole }> {
    const members = await this.staff.find({ tenantId, active: true });
    for (const member of members) {
      if (await argon2.verify(member.pinHash, pin)) {
        return { staffId: String(member._id), role: member.role as StaffRole };
      }
    }
    throw new UnauthorizedException('PIN invalide');
  }
}
