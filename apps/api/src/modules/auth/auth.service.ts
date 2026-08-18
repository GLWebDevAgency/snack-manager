import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import type { JwtPayload, Login, PinLogin } from '@sm/contracts';
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

  /** Re-validation PIN pour action sensible (annulation, remise…) — traçabilité NF525. */
  async verifyPin(tenantId: string, pin: string): Promise<string> {
    const members = await this.staff.find({ tenantId, active: true });
    for (const member of members) {
      if (await argon2.verify(member.pinHash, pin)) return String(member._id);
    }
    throw new UnauthorizedException('PIN invalide');
  }
}
