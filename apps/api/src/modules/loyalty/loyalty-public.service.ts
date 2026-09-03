import { Injectable, NotFoundException } from '@nestjs/common';
import {
  aLaCapacite,
  brandColorDe,
  logoUrlDe,
  LoyaltyCustomerCardSchema,
  LoyaltyPublicProgramSchema,
  publicLoyaltyAvailable,
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
 * volontairement rendus comme « indisponibles », sans détail exploitable — et
 * depuis, le compte SUSPENDU et le module de fidélité NON SOUSCRIT empruntent
 * exactement la même sortie (cf. `context`).
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
    /*
     * LE SLUG NE SUFFIT PAS À OUVRIR CE PROGRAMME.
     *
     * `bySlug` ne rend qu'un document : il ne dit ni si le compte est suspendu
     * ni si la fidélité a été vendue. La vitrine, elle, passe par
     * `publicBySlug`, qui pose les deux questions — ces routes-ci ne les
     * posaient pas, si bien qu'un restaurant suspendu servait sa carte pendant
     * que sa commande en ligne était fermée, et qu'un restaurant sans le module
     * servait un programme qu'il n'a jamais acheté.
     *
     * La règle et son pourquoi vivent dans le contrat (`publicLoyaltyAvailable`,
     * @sm/contracts), à côté de `publicOrderingState` : c'est là que se décide
     * ce qu'une suspension ferme, et une décision de ce poids ne doit pas
     * s'écrire dans un service de module.
     *
     * La capacité vérifiée est `loyalty`, PAS `online` : ce sont deux modules
     * distincts de la grille, et un restaurant peut très bien avoir acheté l'un
     * sans l'autre.
     *
     * Posé ICI plutôt que sur le contrôleur, pour deux raisons. D'abord le
     * refus : `@Capacites(...)` rend un 403 nommé, réservé aux écrans du
     * restaurateur — un client n'a pas à lire une proposition commerciale
     * adressée à quelqu'un d'autre (cf. `common/capacites.ts`). Ensuite la
     * portée : `context` est le passage obligé du catalogue ET de la carte, une
     * garde posée ici ne peut pas oublier une route.
     *
     * AVANT la lecture du programme : rien à lire chez un restaurant qu'on ne
     * sert pas, et la réponse est de toute façon la même 404 uniforme.
     */
    if (!publicLoyaltyAvailable(tenant.account, aLaCapacite(tenant, 'loyalty'))) {
      throw new NotFoundException('Programme de fidélité indisponible');
    }
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
