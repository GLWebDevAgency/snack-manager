import { Injectable, NotFoundException } from '@nestjs/common';
import {
  brandColorDe,
  logoUrlDe,
  LoyaltyCustomerCardSchema,
  LoyaltyPublicProgramSchema,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from '@sm/contracts';
import { marqueObservee } from '../../common/marque-observee';
import { TenantsService } from '../tenants/tenants.service';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyMemberService } from './loyalty-member.service';

/**
 * Lecture client de la carte fidélité.
 *
 * Le slug ne donne accès qu'au catalogue public. Le solde exige le secret QR
 * dans le corps d'un POST ; aucune route GET, query string ou cookie ne le
 * transporte. Les statuts bloqué/anonymisé et les programmes non actifs sont
 * volontairement rendus comme « indisponibles », sans détail exploitable.
 */
@Injectable()
export class LoyaltyPublicService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly loyalty: LoyaltyAdminService,
    private readonly members: LoyaltyMemberService,
  ) {}

  private async context(slug: string) {
    const tenant = await this.tenants.bySlug(slug);
    const tenantRef = String(tenant._id);
    const [program, rewards] = await Promise.all([
      this.loyalty.getProgram(tenantRef),
      this.loyalty.listRewards(tenantRef),
    ]);
    if (!program || program.status !== 'active') {
      throw new NotFoundException('Programme de fidélité indisponible');
    }
    return { tenant, tenantRef, program, rewards: rewards.filter((reward) => reward.active) };
  }

  async catalog(slug: string): Promise<LoyaltyPublicProgram> {
    const { tenant, program, rewards } = await this.context(slug);
    // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
    const brand = marqueObservee(tenant);
    return LoyaltyPublicProgramSchema.parse({
      restaurant: {
        slug: String(tenant.slug),
        name: String(tenant.name),
        brand,
        brandColor: brandColorDe(brand),
        logoUrl: logoUrlDe(brand),
      },
      program: {
        name: program.name,
        mechanism: program.earn.mechanism,
        unitLabelSingular: program.unitLabelSingular,
        unitLabelPlural: program.unitLabelPlural,
        termsSummary: program.termsSummary,
      },
      rewards: rewards.map(({ id, name, description, costUnits, kind, valueCents, productRef }) => ({
        id,
        name,
        description,
        costUnits,
        kind,
        valueCents,
        productRef,
      })),
    });
  }

  async card(slug: string, qrToken: string): Promise<LoyaltyCustomerCard> {
    const { tenant, tenantRef, program, rewards } = await this.context(slug);
    const resolved = await this.members.resolveMember(tenantRef, {
      by: 'qr_token',
      qrToken,
    });
    if (resolved.status !== 'active') {
      throw new NotFoundException('Carte fidélité indisponible');
    }
    const detail = await this.members.getMemberDetail(tenantRef, resolved.id);
    if (detail.member.status !== 'active') {
      throw new NotFoundException('Carte fidélité indisponible');
    }
    // Calculé une fois : le champ plat en dérive, jamais l'inverse. Pas de
    // `logoUrl` ici : `LoyaltyCustomerCardSchema.restaurant` (loyalty.ts) ne le
    // porte pas — l'ajouter ferait échouer le `.strict()` de ce contrat.
    const brand = marqueObservee(tenant);
    return LoyaltyCustomerCardSchema.parse({
      restaurant: {
        slug: String(tenant.slug),
        name: String(tenant.name),
        brand,
        brandColor: brandColorDe(brand),
      },
      program: {
        name: program.name,
        mechanism: program.earn.mechanism,
        unitLabelSingular: program.unitLabelSingular,
        unitLabelPlural: program.unitLabelPlural,
        termsSummary: program.termsSummary,
      },
      member: {
        alias: detail.member.alias,
        balanceUnits: detail.member.balanceUnits,
      },
      rewards: rewards.map(({ id, name, description, costUnits, kind, valueCents, productRef }) => ({
        id,
        name,
        description,
        costUnits,
        kind,
        valueCents,
        productRef,
        affordable: detail.member.balanceUnits >= costUnits,
      })),
      activity: detail.ledger.slice(0, 20).map((entry) => ({
        kind: entry.kind,
        deltaUnits: entry.deltaUnits,
        balanceAfter: entry.balanceAfter,
        label:
          entry.kind === 'earn'
            ? 'Achat enregistré'
            : entry.kind === 'redeem'
              ? entry.reason
              : entry.kind === 'expire'
                ? 'Unités expirées'
                : entry.kind === 'reverse'
                  ? 'Mouvement annulé'
                  : 'Correction de solde',
        recordedAt: entry.recordedAt,
      })),
    });
  }
}
