import {
  Body,
  Controller,
  GoneException,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  LoyaltyAdminAdjustmentSchema,
  LoyaltyConsentEventSchema,
  LoyaltyEnrollmentAcknowledgementSchema,
  LoyaltyEnrollmentPrepareSchema,
  LoyaltyEnrollmentRecoverySchema,
  LoyaltyEarnSchema,
  LoyaltyLedgerReversalSchema,
  LoyaltyMemberCreateSchema,
  LoyaltyMemberLifecycleSchema,
  LoyaltyMemberQrReplaceSchema,
  LoyaltyMemberResolveSchema,
  LoyaltyRedeemSchema,
  type JwtPayload,
  type LoyaltyAdminAdjustment,
  type LoyaltyConsentEvent,
  type LoyaltyEnrollmentAcknowledgement,
  type LoyaltyEnrollmentPrepare,
  type LoyaltyEnrollmentRecovery,
  type LoyaltyEarn,
  type LoyaltyLedgerReversal,
  type LoyaltyMemberCreate,
  type LoyaltyMemberLifecycle,
  type LoyaltyMemberQrReplace,
  type LoyaltyMemberResolve,
  type LoyaltyRedeem,
} from '@sm/contracts';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import { Fonction } from '../../common/capacites';
import { zod } from '../../common/zod.pipe';
import {
  LoyaltyMemberService,
  type LoyaltyActorContext,
} from './loyalty-member.service';

/**
 * Contexte d'audit signé de la fidélité autonome.
 *
 * Ni la source, ni l'auteur, ni l'appareil ne viennent du body : les accepter
 * du client permettrait à une caisse d'effacer sa propre trace.
 * Les gestes quotidiens gardent le canal réel : un équipier, gérant compris,
 * agit depuis le POS. Les gestes réservés au management passent explicitement
 * par `managerActor` plus bas ; rôle et canal ne sont jamais confondus.
 */
function authenticatedActor(user: JwtPayload): LoyaltyActorContext {
  return {
    source: user.kind === 'staff' ? 'pos' : 'admin',
    actorRef: user.sub,
    deviceRef: user.deviceId ?? null,
  };
}

function managerActor(user: JwtPayload): LoyaltyActorContext {
  return {
    source: 'admin',
    actorRef: user.sub,
    deviceRef: user.deviceId ?? null,
  };
}

/** Un gain désigne toujours une vente POS vérifiable, jamais un ajustement. */
function saleActor(user: JwtPayload): LoyaltyActorContext {
  return {
    source: 'pos',
    actorRef: user.sub,
    deviceRef: user.deviceId ?? null,
  };
}

/**
 * Cartes et mouvements utilisables au comptoir, même sans commande en ligne.
 *
 * La cuisine ne recherche pas un client et ne touche jamais à son solde. Le
 * propriétaire, le gérant et la caisse partagent en revanche le parcours
 * quotidien : créer/retrouver la carte et créditer une vente prouvée. La
 * consommation reste fermée tant qu'elle n'est pas atomiquement liée au ticket.
 */
@Controller('loyalty/members')
@Roles('owner', 'gerant', 'caisse')
@Fonction('fidelite')
export class LoyaltyMemberController {
  constructor(private readonly members: LoyaltyMemberService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(LoyaltyMemberCreateSchema)) body: unknown,
  ) {
    return this.members.createMember(
      tenantRef,
      body as LoyaltyMemberCreate,
      authenticatedActor(user),
    );
  }

  /** Réserve l'intention avant l'envoi du profil afin de fermer la course 404. */
  @Post('enrollments/prepare')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  prepareEnrollment(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(LoyaltyEnrollmentPrepareSchema)) body: unknown,
  ) {
    return this.members.prepareEnrollment(
      tenantRef,
      body as LoyaltyEnrollmentPrepare,
      authenticatedActor(user),
    );
  }

  /** Reprise sans PII, limitée au principal/appareil ayant préparé l'adhésion. */
  @Post('enrollments/recover')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  recoverEnrollment(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(LoyaltyEnrollmentRecoverySchema)) body: unknown,
  ) {
    return this.members.recoverEnrollment(
      tenantRef,
      body as LoyaltyEnrollmentRecovery,
      authenticatedActor(user),
    );
  }

  /** Clôture définitivement la restitution du secret après remise au client. */
  @Post('enrollments/acknowledge')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  acknowledgeEnrollment(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(LoyaltyEnrollmentAcknowledgementSchema)) body: unknown,
  ) {
    return this.members.acknowledgeEnrollment(
      tenantRef,
      body as LoyaltyEnrollmentAcknowledgement,
      authenticatedActor(user),
    );
  }

  /** Une recherche n'est pas une création de ressource : elle répond 200. */
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  resolve(
    @TenantId() tenantRef: string,
    @Body(zod(LoyaltyMemberResolveSchema)) body: unknown,
  ) {
    return this.members.resolveMember(tenantRef, body as LoyaltyMemberResolve);
  }

  @Post(':id/earn')
  earn(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyEarnSchema)) body: unknown,
  ) {
    return this.members.earn(
      tenantRef,
      memberId,
      body as LoyaltyEarn,
      saleActor(user),
    );
  }

  @Post(':id/redemptions')
  redeem(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyRedeemSchema)) body: unknown,
  ) {
    // Le débit autonome historique ne prouve pas que l'avantage a été porté
    // par une commande. La route reste explicite pour les anciennes caisses,
    // mais échoue fermée jusqu'à la saga réservation -> ticket -> consommation.
    void tenantRef;
    void user;
    void memberId;
    void (body as LoyaltyRedeem);
    throw new GoneException({
      statusCode: HttpStatus.GONE,
      error: 'Gone',
      message: 'La consommation fidélité exige désormais un ticket de vente',
      code: 'loyalty_redemption_requires_order',
    });
  }

  @Post(':id/adjustments')
  @Roles('owner', 'gerant')
  adjust(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyAdminAdjustmentSchema)) body: unknown,
  ) {
    return this.members.adjust(
      tenantRef,
      memberId,
      body as LoyaltyAdminAdjustment,
      managerActor(user),
    );
  }

  /** Compensation append-only d'un gain ou d'une consommation précise. */
  @Post(':id/ledger/:entryId/reversals')
  @Roles('owner', 'gerant')
  reverseLedgerEntry(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @Body(zod(LoyaltyLedgerReversalSchema)) body: unknown,
  ) {
    return this.members.reverseLedgerEntry(
      tenantRef,
      memberId,
      entryId,
      body as LoyaltyLedgerReversal,
      managerActor(user),
    );
  }

  @Post(':id/consents')
  recordConsent(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyConsentEventSchema)) body: unknown,
  ) {
    return this.members.recordConsent(
      tenantRef,
      memberId,
      body as LoyaltyConsentEvent,
      authenticatedActor(user),
    );
  }

  @Post(':id/lifecycle')
  @Roles('owner', 'gerant')
  changeLifecycle(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyMemberLifecycleSchema)) body: unknown,
  ) {
    return this.members.changeLifecycle(
      tenantRef,
      memberId,
      body as LoyaltyMemberLifecycle,
      managerActor(user),
    );
  }

  @Post(':id/qr/replace')
  @Roles('owner', 'gerant')
  @Header('Cache-Control', 'no-store')
  replaceQr(
    @TenantId() tenantRef: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body(zod(LoyaltyMemberQrReplaceSchema)) body: unknown,
  ) {
    return this.members.replaceQr(
      tenantRef,
      memberId,
      body as LoyaltyMemberQrReplace,
      managerActor(user),
    );
  }
}
