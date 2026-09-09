import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { aLaCapacite, publicOrderingState, type CreateOrder, type CreatePublicOrder, type CustomerOrdersQuery } from '@sm/contracts';
import { OrdersService } from './orders.service';
import { TenantsService } from '../tenants/tenants.service';
import { SlotsService } from '../ordering/slots.service';
import { PublicOrderGate } from './public-order-gate';
import { publicDeliverySettingsOf } from '../delivery/delivery-order';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { publicRecoveryBinding } from './order-recovery';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { enforceOrderRecoveryQuota, enforceOrderRecoverySourceQuota } from './public-order-recovery.controller';

import { validCustomerOrderOwner, type CustomerOrderOwner, type CustomerOrderCommitAuthority } from './customer-order-owner';
import { recoveryNotFound } from './order-recovery';
import { customerOrderCreated } from './customer-order-projection';
import { CustomerOrderHistoryService } from './customer-order-history.service';

export type CustomerCheckoutInput = {
  slug: string; body: CreatePublicOrder; owner: CustomerOrderOwner; sourceKey: string; beforeCommit: CustomerOrderCommitAuthority;
};

export type OnlineOrderDependencies = {
  orders: OrdersService; tenants: TenantsService; slots: SlotsService; publicOrderGate: PublicOrderGate;
  admissions?: PublicOrderAdmissionService; recoveryQuota?: SharedPublicQuota;
};

/** One checkout use case for prices, promotions, capacity, anti-abuse and payment state.
 * Route adapters supply authority; this function never accepts a browser-selected owner. */
export async function executeOnlineCheckout(deps: OnlineOrderDependencies, slug: string, body: CreatePublicOrder, request?: Request,
  customer?: Pick<CustomerCheckoutInput, 'owner' | 'beforeCommit' | 'sourceKey'>) {
    if (body.recoveryProof) {
      if (!deps.recoveryQuota) throw new ServiceUnavailableException('La reprise de commande est indisponible');
      if (customer) await enforceOrderRecoverySourceQuota(deps.recoveryQuota, slug, body.clientId, customer.sourceKey);
      else await enforceOrderRecoveryQuota(deps.recoveryQuota, slug, body.clientId, request ?? { headers: {}, socket: {} } as Request);
    }
    const tenant = await deps.tenants.bySlug(slug);
    const tenantId = String(tenant._id);
    if (customer && (customer.owner.tenantRef !== tenantId || !body.recoveryProof)) throw recoveryNotFound();
    const fulfillment = body.fulfillment ?? 'pickup';
    // Identité métier identique à l'écriture, sans les preuves anti-robot.
    const { turnstileToken: _proof, recoveryProof: _recoveryProof, fulfillment: _fulfillment, ...trusted } = body;
    const trustedOrder: CreateOrder = {
      ...trusted,
      payment: { method: fulfillment === 'delivery' ? 'online' : body.payment.method },
      channel: 'online', type: fulfillment,
    };
    const legacyReplay = async () => {
      if (!deps.admissions) return deps.orders.findPublicReplay(tenantId, body.clientId);
      const observed = await deps.admissions.observeInternal(tenantId, trustedOrder, 'legacy');
      if (observed.state === 'created') return observed.order;
      if (observed.state === 'rejected') throw deps.admissions.rejectionError({ rejection: observed.reason });
      return null;
    };
    let binding = publicRecoveryBinding(tenantId, body, customer?.owner);
    if (binding) {
      if (!deps.admissions) throw new ServiceUnavailableException('La reprise de commande est indisponible');
      const observed = await deps.admissions.begin(tenantId, body, customer?.owner);
      if (observed.state === 'created') return deps.admissions.createdOrder(tenantId, body, customer?.owner);
      if (observed.state === 'rejected') throw deps.admissions.rejectionError({ rejection: observed.reason });
      const owned = await deps.admissions.claimValidation(tenantId, body.clientId, binding);
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
        const observed = await deps.admissions!.reject(tenantId, body.clientId, binding, 'unavailable');
        if (observed.state === 'created') return deps.admissions!.createdOrder(tenantId, body, customer?.owner);
        throw deps.admissions!.rejectionError({ rejection: 'unavailable' });
      }
      return gate;
    }

    // Un POST dont la reponse s'est perdue garde la meme cle. La commande
    // existe deja : ne pas redemander une preuve Turnstile a usage unique, ni
    // recompter le quota ou la capacite du creneau.
    if (fulfillment === 'delivery' && !publicDeliverySettingsOf(tenant).available) {
      if (binding) {
        const observed = await deps.admissions!.reject(tenantId, body.clientId, binding, 'unavailable');
        if (observed.state === 'created') return deps.admissions!.createdOrder(tenantId, body, customer?.owner);
        throw deps.admissions!.rejectionError({ rejection: 'unavailable' });
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
      await deps.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);
    } catch (error) {
      if (binding && (error instanceof BadRequestException || error instanceof ConflictException)) {
        const observed = await deps.admissions!.reject(tenantId, body.clientId, binding, 'slot_unavailable');
        if (observed.state === 'created') return deps.admissions!.createdOrder(tenantId, body, customer?.owner);
        throw deps.admissions!.rejectionError({ rejection: 'slot_unavailable' });
      }
      if (binding) await deps.admissions!.releaseValidation(tenantId, body.clientId, binding);
      throw error;
    }

    let proof;
    try {
      proof = await deps.publicOrderGate.authorize({
        tenantId,
        tenantSlug: slug,
        turnstileToken: body.turnstileToken,
      });
    } catch (error) {
      // Siteverify/quota a échoué AVANT toute création : ce validateur ne
      // continuera jamais. Un nouveau jeton peut reprendre la même tentative.
      if (binding) await deps.admissions!.releaseValidation(tenantId, body.clientId, binding);
      throw error;
    }

    // Le jeton anti-robot n'entre jamais dans le document. Canal et type sont
    // des faits de route, impossibles a choisir dans le corps public strict.
    let admissionStage: 'slot_unavailable' | 'invalid_order' = 'slot_unavailable';
    let creationStarted = false;
    try {
      return await deps.publicOrderGate.serializeSlot(
        { tenantId, slot: body.pickup.slot },
        async () => {
          // Siteverify peut prendre plusieurs secondes. Une autre replique a
          // pu prendre la derniere place entre-temps : seconde lecture SOUS
          // verrou distribue, juste avant l'ecriture.
          if (deps.admissions) await deps.admissions.materializeSlot(tenantId, body.pickup.slot);
          if (binding) {
            const observed = await deps.admissions!.begin(tenantId, body, customer?.owner);
            if (observed.state === 'created') { await deps.publicOrderGate.release(proof); return deps.admissions!.createdOrder(tenantId, body, customer?.owner); }
            if (observed.state === 'rejected') throw deps.admissions!.rejectionError({ rejection: observed.reason });
          }
          const raced = binding ? null : await legacyReplay();
          if (raced) {
            await deps.publicOrderGate.release(proof);
            return raced;
          }
          await deps.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);
          admissionStage = 'invalid_order';
          creationStarted = true;

          const args = [tenantId, trustedOrder, 'online:turnstile', null, binding] as const;
          const outcome = customer
            ? await deps.orders.createWithOutcome(...args, 'legacy', customer.beforeCommit)
            : await deps.orders.createWithOutcome(...args);
          if (!outcome.created) await deps.publicOrderGate.release(proof);
          return outcome.order;
        },
      );
    } catch (err) {
      if (binding) {
        if (err instanceof BadRequestException || err instanceof ConflictException || err instanceof NotFoundException || err instanceof ForbiddenException) {
          const observed = await deps.admissions!.reject(tenantId, body.clientId, binding, err instanceof ForbiddenException ? 'unavailable' : admissionStage);
          if (observed.state === 'created') return deps.admissions!.createdOrder(tenantId, body, customer?.owner);
          if (observed.state === 'rejected') {
            await deps.publicOrderGate.release(proof);
            throw deps.admissions!.rejectionError({ rejection: observed.reason });
          }
        }
        if (!creationStarted) {
          await deps.admissions!.releaseValidation(tenantId, body.clientId, binding);
          await deps.publicOrderGate.release(proof);
        }
        // Erreur I/O : aucune compensation de quota gagnant sur une supposition.
        throw err;
      }
      // Un timeout du writer legacy peut avoir gagné son CAS durable. Ne
      // restituer le quota qu'avant l'écriture ou après un rejet prouvé.
      const terminal = err instanceof ConflictException && typeof err.getResponse() === 'object'
        && (err.getResponse() as { code?: unknown }).code === 'ORDER_ATTEMPT_REJECTED';
      if (!creationStarted || terminal) await deps.publicOrderGate.release(proof);
      throw err;
    }
}

@Injectable()
export class OnlineOrderCheckoutService {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(TenantsService) private readonly tenants: TenantsService,
    @Inject(SlotsService) private readonly slots: SlotsService,
    @Inject(PublicOrderGate) private readonly publicOrderGate: PublicOrderGate,
    @Optional() @Inject(PublicOrderAdmissionService) private readonly admissions?: PublicOrderAdmissionService,
    @Optional() @Inject(SharedPublicQuota) private readonly recoveryQuota?: SharedPublicQuota,
    @Optional() @Inject(CustomerOrderHistoryService) private readonly history?: CustomerOrderHistoryService,
  ) {}
  private dependencies(): OnlineOrderDependencies {
    return { orders: this.orders, tenants: this.tenants, slots: this.slots, publicOrderGate: this.publicOrderGate,
      admissions: this.admissions, recoveryQuota: this.recoveryQuota };
  }
  async createForCustomer(input: CustomerCheckoutInput) {
    if (!validCustomerOrderOwner(input.owner) || typeof input.beforeCommit !== 'function'
      || !/^customer:[A-Za-z0-9_-]{43}$/.test(input.sourceKey) || !input.body.recoveryProof) throw recoveryNotFound();
    const result = await executeOnlineCheckout(this.dependencies(), input.slug, input.body, undefined,
      { owner: Object.freeze({ ...input.owner }), sourceKey: input.sourceKey, beforeCommit: input.beforeCommit });
    if ('paused' in result) throw new ServiceUnavailableException('La commande est indisponible.');
    return customerOrderCreated(result);
  }
  listForCustomer(owner: CustomerOrderOwner, query: CustomerOrdersQuery) {
    if (!this.history) throw new ServiceUnavailableException('Les commandes sont indisponibles.');
    return this.history.listForCustomer(owner, query);
  }
  detailForCustomer(owner: CustomerOrderOwner, orderId: string) {
    if (!this.history) throw new ServiceUnavailableException('La commande est indisponible.');
    return this.history.detailForCustomer(owner, orderId);
  }
  createPublic(slug: string, body: CreatePublicOrder, request?: Request) {
    return executeOnlineCheckout(this.dependencies(), slug, body, request);
  }
}
