import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import type { JwtPayload } from '@sm/contracts';
import type { User } from '@sm/db';
import { DUMMY_PASSWORD_HASH } from '../auth/auth.service';

/** Financial confirmation uses the owner account, independently of staff/POS subscriptions. */
@Injectable()
export class OwnerReauthentication {
  constructor(@InjectModel('User') private readonly users: Model<User>) {}

  async verify(actor: JwtPayload, password: string): Promise<void> {
    if (actor.kind !== 'user' || actor.role !== 'owner' || !actor.tenantId) {
      throw new ForbiddenException('Confirmation réservée au propriétaire.');
    }
    const user = await this.users.findOne({
      _id: actor.sub, tenantId: actor.tenantId, role: 'owner', active: { $ne: false },
    }).lean();
    let valid = false;
    try { valid = await argon2.verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password); }
    catch { /* An unreadable credential never confirms a financial operation. */ }
    if (!user || !valid) throw new UnauthorizedException('Mot de passe incorrect.');
  }
}
