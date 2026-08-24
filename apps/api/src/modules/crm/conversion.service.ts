import { randomInt } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload, LeadConvert, LeadConversion } from '@sm/contracts';
import type { Lead, Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import { SECRET_HASHER } from '../../infrastructure/tokens';
import { AdminService } from './admin.service';
import { TRIAL_DAYS } from './signals.service';

/**
 * SIGNER — le geste qui transforme une carte du pipeline en restaurant réel.
 *
 * En un appel : le tenant (essai de TRIAL_DAYS jours, échéance POSÉE en base),
 * le compte gérant (mot de passe généré, stocké en empreinte, remis une fois),
 * la place fondateur s'il y a lieu, la trace sur le lead et la ligne au
 * journal d'administration. Avant ce service, tout cela était des écritures
 * Mongo à la main et un script CLI contre la production.
 *
 * Ordre d'écriture et rattrapage : le tenant d'abord, le compte ensuite. Si
 * le compte échoue (e-mail pris entre la vérification et l'écriture), le
 * tenant orphelin est SUPPRIMÉ avant de relancer l'erreur — un restaurant sans
 * gérant dans le parc serait un mensonge que la liste des clients répéterait.
 */

const DAY_MS = 86_400_000;

/**
 * Mot de passe lisible AU TÉLÉPHONE : trois groupes de quatre, alphabet sans
 * ambiguïté (ni 0/O, ni 1/l/I) — le même que les codes d'appairage, pour les
 * mêmes raisons. ~62 bits : largement au-dessus de ce qu'un guichet de
 * connexion sans limite de débit mérite, et il se change à la première visite.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(pick: (max: number) => number = randomInt): string {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[pick(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

@Injectable()
export class ConversionService {
  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('User') private readonly users: Model<User>,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    private readonly admin: AdminService,
  ) {}

  async convert(
    actor: JwtPayload,
    leadId: string,
    body: LeadConvert,
    now: Date = new Date(),
  ): Promise<LeadConversion> {
    if (!Types.ObjectId.isValid(leadId)) throw new NotFoundException('Lead introuvable');
    const lead = await this.leads.findById(leadId).lean();
    if (!lead) throw new NotFoundException('Lead introuvable');

    const email = body.ownerEmail.toLowerCase();
    if (await this.tenants.findOne({ slug: body.slug }).lean()) {
      throw new ConflictException(`Le slug « ${body.slug} » est déjà pris`);
    }
    if (await this.users.findOne({ email }).lean()) {
      throw new ConflictException(`L’e-mail « ${email} » a déjà un compte`);
    }

    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);

    const tenant = await this.tenants.create({
      slug: body.slug,
      name: lead.restaurantName,
      plan: body.plan,
      founderSeat: body.founderSeat,
      account: {
        status: 'trial',
        since: now,
        reason: `Créé depuis le pipeline (lead « ${lead.restaurantName} »)`,
        suspendedAt: null,
        trialEndsAt,
      },
    });

    try {
      await this.users.create({
        email,
        passwordHash,
        role: 'owner',
        tenantId: tenant._id,
        name: body.ownerName,
      });
    } catch (cause) {
      await this.tenants.deleteOne({ _id: tenant._id });
      throw cause;
    }

    // Le lead passe « signé », la réservation s'éteint : la place fondateur
    // vit désormais sur le TENANT — la compter encore côté pipeline la
    // vendrait deux fois (voir `CrmService.overview`).
    await this.leads.updateOne(
      { _id: lead._id },
      {
        $set: { stage: 'signe', founderSeatReserved: false },
        $push: {
          touches: {
            at: now,
            type: 'autre',
            note: `Converti en restaurant « ${body.slug} » — essai jusqu'au ${trialEndsAt.toLocaleDateString('fr-FR')}.`,
          },
        },
      },
    );

    await this.admin.recordTenantCreation(actor, String(tenant._id), {
      slug: body.slug,
      plan: body.plan,
      founderSeat: body.founderSeat,
      leadId: String(lead._id),
      ownerEmail: email,
    });

    return {
      tenantId: String(tenant._id),
      slug: body.slug,
      name: lead.restaurantName,
      ownerEmail: email,
      password,
      trialEndsAt: trialEndsAt.toISOString(),
    };
  }

  /**
   * Nouveau mot de passe pour le gérant d'un restaurant — le geste qui
   * remplace `set-password.ts` lancé contre la production à chaque oubli.
   * Même fabrication, même remise unique, et la trace au journal.
   */
  async resetOwnerPassword(
    actor: JwtPayload,
    tenantId: string,
  ): Promise<{ ownerEmail: string; password: string }> {
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const owner = await this.users
      .findOne({ tenantId: new Types.ObjectId(tenantId), role: 'owner' })
      .lean();
    if (!owner) throw new NotFoundException('Aucun compte gérant sur cet établissement');

    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);
    await this.users.updateOne({ _id: owner._id }, { $set: { passwordHash } });

    await this.admin.recordOwnerReset(actor, tenantId, owner.email);
    return { ownerEmail: owner.email, password };
  }
}
