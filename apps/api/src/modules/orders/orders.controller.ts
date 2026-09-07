import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type CreatePublicOrder,
  CreatePublicOrderSchema,
  CreateStaffOrderSchema,
  StaffPhoneOrderAttemptRequestSchema,
  type StaffPhoneOrderAttemptRequest,
  type OrderCancel,
  OrderCancelSchema,
  type OrderDiscount,
  OrderDiscountSchema,
  type CreateOrder,
  type JwtPayload,
  ORDER_READ_ROLES,
  type OrderStatus,
  publicOrderingState,
  aLaCapacite,
  TrackingTokenQuerySchema,
  type TrackingTokenQuery,
  UpdateOrderStatusSchema,
} from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { SlotsService } from '../ordering/slots.service';
import { PublicOrderGate } from './public-order-gate';
import { Fonction } from '../../common/capacites';
import { publicDeliverySettingsOf } from '../delivery/delivery-order';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { publicRecoveryBinding } from './order-recovery';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { enforceOrderRecoveryQuota } from './public-order-recovery.controller';

@Controller()
@Fonction('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly slots: SlotsService,
    private readonly publicOrderGate: PublicOrderGate,
    @Optional() private readonly admissions?: PublicOrderAdmissionService,
    @Optional() private readonly recoveryQuota?: SharedPublicQuota,
  ) {}

  // ─── Staff (POS / téléphone) ───
  //
  // AUCUNE de ces routes ne portait de rôle, et l'absence de `@Roles` vaut
  // « tout rôle authentifié » : un code cuisine atteignait la prise de
  // commande, l'annulation et la remise. Chaque route dit désormais qui elle
  // sert, et le dit explicitement — y compris quand la réponse est « tout le
  // monde », qui est une décision et non un oubli.

  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/slots')
  async staffSlots(@TenantId() tenantId: string, @Query('date') date?: string) {
    const tenant = await this.orders.tenantForStaffSlots(tenantId);
    return { tenantId, ...await this.slots.compute(tenant, date, 'pickup', 'staff') };
  }

  @Roles('owner', 'gerant', 'caisse')
  @HttpCode(200)
  @Post('orders/recovery')
  staffRecovery(@TenantId() tenantId: string, @Body(zod(StaffPhoneOrderAttemptRequestSchema)) body: StaffPhoneOrderAttemptRequest) {
    return this.orders.staffAttempt(tenantId, body, false);
  }

  @Roles('owner', 'gerant', 'caisse')
  @HttpCode(200)
  @Post('orders/abandon')
  staffAbandon(@TenantId() tenantId: string, @Body(zod(StaffPhoneOrderAttemptRequestSchema)) body: StaffPhoneOrderAttemptRequest) {
    return this.orders.staffAttempt(tenantId, body, true);
  }

  /** La cuisine ne prend pas les commandes : elle les prépare. */
  @Roles('owner', 'gerant', 'caisse')
  @Post('orders')
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(CreateStaffOrderSchema)) body: CreateOrder,
  ) {
    // Le pilote livre uniquement les commandes passées par le checkout :
    // c'est cette porte qui réserve la capacité et exige le paiement Stripe.
    // Les appareils continuent à lire/préparer ces tickets, sans pouvoir
    // créer une livraison qui contournerait les contrôles du parcours public.
    if (body.type === 'delivery') {
      throw new ForbiddenException('La livraison se réserve depuis le parcours de commande en ligne');
    }
    return this.orders.create(tenantId, body, user.sub, user.deviceId ?? null);
  }

  /** Tout l'équipage lit la file : c'est l'écran de travail du KDS. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders')
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.list(tenantId, { status, since });
  }

  /** Même périmètre que la liste, sans charger jusqu'à 200 commandes. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders/count')
  count(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.count(tenantId, { status, since });
  }

  /**
   * Réconciliation exacte d'une vente créée par une caisse hors ligne.
   *
   * La liste opérationnelle est volontairement plafonnée. Elle ne peut donc
   * pas servir de preuve qu'une ancienne commande synchronisée existe encore
   * dans un restaurant à fort débit. Le `clientId` UUID est la clé
   * d'idempotence du poste et la recherche reste strictement tenant-scopée.
   */
  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId/loyalty')
  async loyaltyEarnStatus(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const status = await this.orders.loyaltyEarnStatusByClientId(tenantId, clientId);
    if (!status) throw new NotFoundException('Commande introuvable');
    return status;
  }

  @Roles('owner', 'cogerant', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId')
  async byClientId(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const order = await this.orders.findByClientId(tenantId, clientId);
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  @Roles(...ORDER_READ_ROLES)
  @Get('orders/:id')
  byId(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.byId(tenantId, id);
  }

  /**
   * La cuisine peut préparer et marquer prêt. Le service distingue la remise
   * au client, réservée au comptoir/gestion : transmettre l'identité complète
   * permet de faire ce contrôle avant toute mutation ou réponse idempotente.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Patch('orders/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(UpdateOrderStatusSchema)) body: { status: OrderStatus },
  ) {
    return this.orders.updateStatus(tenantId, id, body.status, user);
  }

  /**
   * Annulation — exige la re-saisie du PIN (traçabilité NF525).
   *
   * Le rôle du valideur est vérifié EN PLUS du code : annuler une commande la
   * sort de la recette du jour, et c'est un geste de comptoir, pas de cuisine.
   * Re-saisir un code prouve qui agit, jamais que cette personne en a le droit.
   */
  /*
   * Le JETON reste ouvert à tout l'équipage, et c'est voulu : la tablette est
   * en session « caisse » quand le gérant vient taper SON code par-dessus.
   * Restreindre ici empêcherait le gérant d'autoriser quoi que ce soit depuis
   * le comptoir. C'est le PIN re-saisi qui décide, pas la session ouverte.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/cancel')
  async cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderCancelSchema)) body: OrderCancel,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    if (valideur.role === 'cuisine') {
      throw new ForbiddenException(
        'Ce code ne permet pas d’annuler une commande — demandez à la caisse ou au gérant.',
      );
    }
    return this.orders.cancel(tenantId, id, valideur, body.reason);
  }

  /**
   * Remise — exige la re-saisie du PIN ET le droit d'accorder ce montant.
   *
   * Le corps n'était pas validé, le motif était facultatif, le rôle n'était pas
   * lu et le seul plafond était le sous-total : un code cuisine offrait la
   * commande entière sans motif. Le montant se juge maintenant dans le domaine,
   * contre `REMISE_PLAFOND_CENTS`.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/discount')
  async discount(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderDiscountSchema)) body: OrderDiscount,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    return this.orders.discount(tenantId, id, valideur, body.amount, body.reason);
  }

  // ─── Public (commande en ligne, sans compte) ───

  @Public()
  // 20 commandes/minute par adresse : aucun client réel n'y touche, un
  // script qui rembourrerait la cuisine de fausses commandes, si.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/tenants/:slug/orders')
  async createOnline(
    @Param('slug') slug: string,
    @Body(zod(CreatePublicOrderSchema)) body: CreatePublicOrder,
    @Req() request?: Request,
  ) {
    if (body.recoveryProof) {
      if (!this.recoveryQuota) throw new ServiceUnavailableException('La reprise de commande est indisponible');
      await enforceOrderRecoveryQuota(this.recoveryQuota, slug, body.clientId, request ?? { headers: {}, socket: {} } as Request);
    }
    const tenant = await this.tenants.bySlug(slug);
    const tenantId = String(tenant._id);
    const fulfillment = body.fulfillment ?? 'pickup';
    // Identité métier identique à l'écriture, sans les preuves anti-robot.
    const { turnstileToken: _proof, recoveryProof: _recoveryProof, fulfillment: _fulfillment, ...trusted } = body;
    const trustedOrder: CreateOrder = {
      ...trusted,
      payment: { method: fulfillment === 'delivery' ? 'online' : body.payment.method },
      channel: 'online', type: fulfillment,
    };
    const legacyReplay = async () => {
      if (!this.admissions) return this.orders.findPublicReplay(tenantId, body.clientId);
      const observed = await this.admissions.observeInternal(tenantId, trustedOrder, 'legacy');
      if (observed.state === 'created') return observed.order;
      if (observed.state === 'rejected') throw this.admissions.rejectionError({ rejection: observed.reason });
      return null;
    };
    let binding = publicRecoveryBinding(tenantId, body);
    if (binding) {
      if (!this.admissions) throw new ServiceUnavailableException('La reprise de commande est indisponible');
      const observed = await this.admissions.begin(tenantId, body);
      if (observed.state === 'created') return this.admissions.createdOrder(tenantId, body);
      if (observed.state === 'rejected') throw this.admissions.rejectionError({ rejection: observed.reason });
      const owned = await this.admissions.claimValidation(tenantId, body.clientId, binding);
      if (!owned) throw new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'Cette tentative reste à vérifier. Consultez sa reprise avant un nouvel envoi.' });
      binding = owned;
    }
    // Un snapshot committing possède déjà sa place. Sa reprise précède toute
    // nouvelle vérification de pause, quota, Turnstile ou capacité complète.
    if (!binding) {
      const existing = await legacyReplay();
      if (existing) return existing;
    }
    // Pause volontaire du gérant, suspension du compte par Snack Manager, ou
    // commande en ligne non souscrite : même fermeture propre côté client,
    // messages distincts (le consommateur ne doit jamais lire « impayé » ni
    // « abonnement » — ni le litige ni le contrat ne le concernent).
    //
    // Une capacité manquante passe donc par la MÊME porte que la pause, et pas
    // par un 403 de garde : le client qui valide son panier à 12h15 doit lire
    // une phrase qui lui parle, pas recevoir une erreur.
    const gate = publicOrderingState(
      tenant.account,
      {
        paused: tenant.settings?.onlineOrderingPaused ?? false,
        message: tenant.settings?.pauseMessage ?? null,
      },
      aLaCapacite(tenant, 'online'),
    );
    if (gate.paused) {
      if (binding) {
        const observed = await this.admissions!.reject(tenantId, body.clientId, binding, 'unavailable');
        if (observed.state === 'created') return this.admissions!.createdOrder(tenantId, body);
        throw this.admissions!.rejectionError({ rejection: 'unavailable' });
      }
      return gate;
    }

    // Un POST dont la reponse s'est perdue garde la meme cle. La commande
    // existe deja : ne pas redemander une preuve Turnstile a usage unique, ni
    // recompter le quota ou la capacite du creneau.
    if (fulfillment === 'delivery' && !publicDeliverySettingsOf(tenant).available) {
      if (binding) {
        const observed = await this.admissions!.reject(tenantId, body.clientId, binding, 'unavailable');
        if (observed.state === 'created') return this.admissions!.createdOrder(tenantId, body);
        throw this.admissions!.rejectionError({ rejection: 'unavailable' });
      }
      throw new ConflictException('La livraison est momentanément indisponible. Vous pouvez choisir le retrait au restaurant.');
    }

    // LE CRÉNEAU EST VÉRIFIÉ ICI, PAS SEULEMENT PROPOSÉ.
    //
    // `SlotsService.compute` calculait déjà la capacité restante, les
    // fermetures exceptionnelles et le délai de préparation — et rien ne les
    // relisait à l'écriture. Le tunnel grisait les créneaux pleins, ce qui
    // arrête un client honnête et personne d'autre : un appel direct posait
    // vingt commandes à la minute sur un créneau affiché « complet », ou un
    // jour de fermeture. La cuisine recevait des commandes qu'elle avait
    // explicitement déclaré ne pas pouvoir honorer.
    //
    // Le cas du client resté dix minutes sur l'étape paiement se referme du
    // même coup : son créneau est revérifié au moment où il valide, pas au
    // moment où il l'a choisi.
    try {
      await this.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);
    } catch (error) {
      if (binding && (error instanceof BadRequestException || error instanceof ConflictException)) {
        const observed = await this.admissions!.reject(tenantId, body.clientId, binding, 'slot_unavailable');
        if (observed.state === 'created') return this.admissions!.createdOrder(tenantId, body);
        throw this.admissions!.rejectionError({ rejection: 'slot_unavailable' });
      }
      if (binding) await this.admissions!.releaseValidation(tenantId, body.clientId, binding);
      throw error;
    }

    let proof;
    try {
      proof = await this.publicOrderGate.authorize({
        tenantId,
        tenantSlug: slug,
        turnstileToken: body.turnstileToken,
      });
    } catch (error) {
      // Siteverify/quota a échoué AVANT toute création : ce validateur ne
      // continuera jamais. Un nouveau jeton peut reprendre la même tentative.
      if (binding) await this.admissions!.releaseValidation(tenantId, body.clientId, binding);
      throw error;
    }

    // Le jeton anti-robot n'entre jamais dans le document. Canal et type sont
    // des faits de route, impossibles a choisir dans le corps public strict.
    let admissionStage: 'slot_unavailable' | 'invalid_order' = 'slot_unavailable';
    let creationStarted = false;
    try {
      return await this.publicOrderGate.serializeSlot(
        { tenantId, slot: body.pickup.slot },
        async () => {
          // Siteverify peut prendre plusieurs secondes. Une autre replique a
          // pu prendre la derniere place entre-temps : seconde lecture SOUS
          // verrou distribue, juste avant l'ecriture.
          if (this.admissions) await this.admissions.materializeSlot(tenantId, body.pickup.slot);
          if (binding) {
            const observed = await this.admissions!.begin(tenantId, body);
            if (observed.state === 'created') { await this.publicOrderGate.release(proof); return this.admissions!.createdOrder(tenantId, body); }
            if (observed.state === 'rejected') throw this.admissions!.rejectionError({ rejection: observed.reason });
          }
          const raced = binding ? null : await legacyReplay();
          if (raced) {
            await this.publicOrderGate.release(proof);
            return raced;
          }
          await this.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);
          admissionStage = 'invalid_order';
          creationStarted = true;

          const outcome = await this.orders.createWithOutcome(
            tenantId,
            trustedOrder,
            'online:turnstile',
            null,
            binding,
          );
          if (!outcome.created) await this.publicOrderGate.release(proof);
          return outcome.order;
        },
      );
    } catch (err) {
      if (binding) {
        if (err instanceof BadRequestException || err instanceof ConflictException || err instanceof NotFoundException || err instanceof ForbiddenException) {
          const observed = await this.admissions!.reject(tenantId, body.clientId, binding, err instanceof ForbiddenException ? 'unavailable' : admissionStage);
          if (observed.state === 'created') return this.admissions!.createdOrder(tenantId, body);
          if (observed.state === 'rejected') {
            await this.publicOrderGate.release(proof);
            throw this.admissions!.rejectionError({ rejection: observed.reason });
          }
        }
        if (!creationStarted) {
          await this.admissions!.releaseValidation(tenantId, body.clientId, binding);
          await this.publicOrderGate.release(proof);
        }
        // Erreur I/O : aucune compensation de quota gagnant sur une supposition.
        throw err;
      }
      // Un timeout du writer legacy peut avoir gagné son CAS durable. Ne
      // restituer le quota qu'avant l'écriture ou après un rejet prouvé.
      const terminal = err instanceof ConflictException && typeof err.getResponse() === 'object'
        && (err.getResponse() as { code?: unknown }).code === 'ORDER_ATTEMPT_REJECTED';
      if (!creationStarted || terminal) await this.publicOrderGate.release(proof);
      throw err;
    }
  }

  /**
   * Suivi client — exige `?t=<trackingToken>` (remis à la création).
   * Sans jeton valide : 404, jamais 403 (voir `OrdersService.publicTracking`).
   */
  @Public()
  @Get('public/orders/:id')
  tracking(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.orders.publicTracking(id, query.t);
  }
}
