import { createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DELIVERY_INVITE_TTL_MS,
  DELIVERY_SESSION_TTL_MS,
  DeliveryAccessSecretSchema,
  DeliverySessionExchangeSchema,
  capacitesEffectives,
  isAccessBlocked,
  type DeliverySessionExchange,
  type DeliverySessionView,
  type SouscriptionLue,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { DeliveryOperator, Staff, Tenant } from '@sm/db';
import { SOUSCRIPTION_FIELDS } from '../../common/capacites';

/** Hash commun à l'émission gérant et à l'échange. Aucun secret brut en base. */
export function hashDeliveryAccessSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Les deux entrées font chacune 256 bits et doivent être conservées AVANT le
 * POST par le téléphone. Une réponse perdue peut ainsi être restituée sans
 * stocker le bearer en clair ni transformer l'invitation en connexion durable.
 */
export function deriveDeliverySessionToken(input: DeliverySessionExchange): string {
  return createHash('sha256')
    .update(`snackmanager:delivery-session:v1\0${input.token}\0${input.nonce}`)
    .digest('base64url');
}

type OperatorRow = {
  _id: unknown;
  tenantId: unknown;
  staffId?: unknown;
  name: string;
  active: boolean;
  revision: number;
  staffSessionVersion: string | null;
  sessionVersion: string;
  invite?: { hash: string; expiresAt: Date } | null;
  session?: {
    hash: string;
    version: string;
    expiresAt: Date;
    inviteHash: string;
    nonceHash: string;
    retryUntil: Date;
  } | null;
};

type TenantRow = SouscriptionLue & {
  name: string;
  slug: string;
  account?: { status?: TenantAccountStatus };
};

/** Contexte privé de cette surface ; ce n'est jamais un JwtPayload/req.user. */
export type DeliveryAccessSession = {
  operatorId: string;
  tenantId: string;
  revision: number;
  sessionVersion: string;
  sessionHash: string;
  session: DeliverySessionView;
};

@Injectable()
export class DeliveryAccessService {
  constructor(
    @InjectModel('DeliveryOperator') private readonly operators: Model<DeliveryOperator>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
  ) {}

  async exchange(input: DeliverySessionExchange): Promise<{ token: string; session: DeliverySessionView }> {
    if (!DeliverySessionExchangeSchema.safeParse(input).success) throw this.denied();
    const inviteHash = hashDeliveryAccessSecret(input.token);
    const nonceHash = hashDeliveryAccessSecret(input.nonce);
    const token = deriveDeliverySessionToken(input);
    const sessionHash = hashDeliveryAccessSecret(token);
    const operator = await this.operators
      .findOne({ $or: [{ 'invite.hash': inviteHash }, { 'session.inviteHash': inviteHash }] })
      .read('primary')
      .readConcern('majority').maxTimeMS(10_000)
      .select('+invite +session +sessionVersion +staffSessionVersion')
      .lean<OperatorRow | null>();
    if (!operator) throw this.denied();
    await this.assertEligible(operator);

    if (this.isRetry(operator, inviteHash, nonceHash, sessionHash)) {
      const access = await this.authenticate(token);
      if (!this.isRetry(operator, inviteHash, nonceHash, sessionHash)) throw this.denied();
      return { token, session: access.session };
    }

    const now = new Date();
    if (operator.invite?.hash !== inviteHash || !this.after(operator.invite.expiresAt, now)) {
      throw this.denied();
    }
    const claimed = await this.operators.findOneAndUpdate(
      {
        _id: operator._id,
        tenantId: operator.tenantId,
        active: true,
        revision: operator.revision,
        sessionVersion: operator.sessionVersion,
        'invite.hash': inviteHash,
        'invite.expiresAt': { $gt: now },
        $expr: { $gt: ['$invite.expiresAt', '$$NOW'] },
      },
      {
        $set: {
          invite: null,
          session: {
            hash: sessionHash,
            version: operator.sessionVersion,
            expiresAt: new Date(now.getTime() + DELIVERY_SESSION_TTL_MS),
            inviteHash,
            nonceHash,
            retryUntil: new Date(now.getTime() + DELIVERY_INVITE_TTL_MS),
          },
        },
        $inc: { revision: 1 },
        $push: {
          history: {
            at: now,
            action: 'connected',
            actorId: String(operator._id),
            actorKind: 'delivery',
            revision: operator.revision + 1,
          },
        },
      },
      { new: true, runValidators: true, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } },
    ).read('primary').select('+invite +session +sessionVersion +staffSessionVersion').lean<OperatorRow | null>();

    let retry: OperatorRow | null = null;
    if (!claimed) {
      // Deux POST identiques peuvent se croiser. Seul le gagnant écrit ; le
      // second ne restitue que CE résultat, jamais une session d'un autre nonce.
      const current = await this.operators.findOne({
        _id: operator._id,
        tenantId: operator.tenantId,
        'session.hash': sessionHash,
      }).read('primary').readConcern('majority').maxTimeMS(10_000)
        .select('+invite +session +sessionVersion +staffSessionVersion').lean<OperatorRow | null>();
      if (!current || !this.isRetry(current, inviteHash, nonceHash, sessionHash)) throw this.denied();
      retry = current;
    }

    // Une révocation, suspension ou désactivation Staff peut avoir croisé le
    // CAS. Rien n'est rendu avant une nouvelle lecture d'autorité complète.
    const access = await this.authenticate(token);
    if (retry && !this.isRetry(retry, inviteHash, nonceHash, sessionHash)) throw this.denied();
    return { token, session: access.session };
  }

  async authenticate(token: string): Promise<DeliveryAccessSession> {
    if (!DeliveryAccessSecretSchema.safeParse(token).success) throw this.denied();
    return this.authenticateHash(hashDeliveryAccessSecret(token));
  }

  /** Revalidation interne d'un contexte déjà authentifié, sans conserver le
   * bearer brut. Ce contrôle ne forme pas une transaction avec une commande :
   * une requête autorisée déjà en vol peut croiser une révocation ultérieure. */
  async revalidate(access: DeliveryAccessSession): Promise<DeliveryAccessSession> {
    const current = await this.authenticateHash(access.sessionHash);
    if (current.operatorId !== access.operatorId || current.tenantId !== access.tenantId
      || current.sessionVersion !== access.sessionVersion) throw this.denied();
    return current;
  }

  private async authenticateHash(sessionHash: string): Promise<DeliveryAccessSession> {
    if (!/^[a-f0-9]{64}$/.test(sessionHash)) throw this.denied();
    const operator = await this.operators.findOne({ 'session.hash': sessionHash })
      .read('primary')
      .readConcern('majority').maxTimeMS(10_000)
      .select('+session +sessionVersion +staffSessionVersion')
      .lean<OperatorRow | null>();
    if (!operator || !this.sessionCurrent(operator)) throw this.denied();
    const tenant = await this.assertEligible(operator);
    const session = operator.session!;

    // Relecture étroite APRÈS les dépendances : une révocation du document
    // opérateur pendant ces lectures ne laisse pas passer le résultat périmé.
    const stillCurrent = await this.operators.exists({
      _id: operator._id,
      tenantId: operator.tenantId,
      active: true,
      revision: operator.revision,
      sessionVersion: operator.sessionVersion,
      'session.version': operator.sessionVersion,
      'session.hash': sessionHash,
      'session.expiresAt': { $gt: new Date() },
    }).read('primary').readConcern('majority').maxTimeMS(10_000);
    if (!stillCurrent || !this.after(session.expiresAt, new Date())) throw this.denied();

    return {
      operatorId: String(operator._id),
      tenantId: String(operator.tenantId),
      revision: operator.revision,
      sessionVersion: operator.sessionVersion,
      sessionHash,
      session: {
        operatorId: String(operator._id),
        name: operator.name,
        restaurantName: tenant.name,
        restaurantSlug: tenant.slug,
        expiresAt: new Date(session.expiresAt).toISOString(),
      },
    };
  }

  async logout(access: DeliveryAccessSession): Promise<void> {
    const result = await this.operators.updateOne(
      {
        _id: access.operatorId,
        tenantId: access.tenantId,
        revision: access.revision,
        sessionVersion: access.sessionVersion,
        'session.hash': access.sessionHash,
      },
      {
        $set: { session: null },
        $inc: { revision: 1 },
        $push: {
          history: {
            at: new Date(),
            action: 'logout',
            actorId: access.operatorId,
            actorKind: 'delivery',
            revision: access.revision + 1,
          },
        },
      },
      { runValidators: true, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } },
    );
    if (result.modifiedCount !== 1) throw this.denied();
  }

  private async assertEligible(operator: OperatorRow): Promise<TenantRow> {
    if (
      operator.active !== true ||
      typeof operator.sessionVersion !== 'string' || !operator.sessionVersion ||
      !Types.ObjectId.isValid(String(operator.tenantId)) ||
      !Number.isSafeInteger(operator.revision) || operator.revision < 0
    ) throw this.denied();

    const tenant = await this.tenants.findById(operator.tenantId, {
      ...SOUSCRIPTION_FIELDS, name: 1, slug: 1, 'account.status': 1,
    }).read('primary').readConcern('majority').maxTimeMS(10_000).lean<TenantRow | null>();
    if (!tenant || isAccessBlocked(tenant.account?.status) || !capacitesEffectives(tenant).includes('delivery')) {
      throw this.denied();
    }
    if (operator.staffId !== null && operator.staffId !== undefined) {
      if (!Types.ObjectId.isValid(String(operator.staffId)) || typeof operator.staffSessionVersion !== 'string') {
        throw this.denied();
      }
      const member = await this.staff.findOne(
        { _id: operator.staffId, tenantId: operator.tenantId },
        { active: 1, sessionVersion: 1 },
      ).read('primary').readConcern('majority').maxTimeMS(10_000).lean<{ active?: boolean; sessionVersion?: string } | null>();
      if (!member || member.active !== true || String(member.sessionVersion ?? '0') !== operator.staffSessionVersion) {
        throw this.denied();
      }
    }
    return tenant;
  }

  private isRetry(operator: OperatorRow, inviteHash: string, nonceHash: string, sessionHash: string): boolean {
    return this.sessionCurrent(operator) &&
      operator.session!.inviteHash === inviteHash &&
      operator.session!.nonceHash === nonceHash &&
      operator.session!.hash === sessionHash &&
      this.after(operator.session!.retryUntil, new Date());
  }

  private sessionCurrent(operator: OperatorRow): boolean {
    return operator.active === true && !!operator.session &&
      operator.session.version === operator.sessionVersion &&
      this.after(operator.session.expiresAt, new Date());
  }

  private after(value: Date, now: Date): boolean {
    return new Date(value).getTime() > now.getTime();
  }

  private denied(): UnauthorizedException {
    return new UnauthorizedException('Accès livreur invalide ou expiré');
  }
}
