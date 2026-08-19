import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  BillingHistoryQuerySchema,
  InvoiceCancelSchema,
  InvoiceIssueSchema,
  InvoicePaySchema,
  type BillingHistoryQuery,
  type InvoiceCancel,
  type InvoiceIssue,
  type InvoicePay,
  type JwtPayload,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Roles } from '../../common/auth';
import { BillingService } from './billing.service';

/**
 * FACTURATION — « qui paie, qui doit, et depuis quand ».
 *
 * Quatrième contrôleur du préfixe `/crm`, et pas une fusion : `CrmController`
 * OBSERVE le pipeline commercial, `HealthController` ANALYSE l'exploitation,
 * `AdminController` AGIT sur les comptes, celui-ci tient les COMPTES au sens
 * propre. Même écran pour l'équipe, quatre responsabilités.
 *
 * ─── CLOISONNEMENT ───
 *
 * `@Roles('sm_admin')` posé sur la CLASSE, comme sur les trois autres : toutes
 * les routes en héritent, y compris celles qu'on ajoutera demain. Un gérant de
 * restaurant (`owner`) qui les appelle avec son jeton reçoit un 403 — c'est la
 * seule garde qui compte. `GET /crm/billing/overdue` balaie le parc ENTIER :
 * elle ne doit même pas être devinable depuis un back-office restaurant.
 *
 * Aucun `@TenantId()` : le CRM est TRANS-TENANT et l'équipe SM porte un jeton
 * sans `tenantId`. Le restaurant facturé vient de l'URL, jamais du jeton.
 *
 * ─── FORME DES ROUTES ───
 *
 * `@HttpCode(200)` sur les trois POST, comme sur `AdminController`. Émettre une
 * facture crée pourtant bien une ressource — mais ce que l'équipe veut lire en
 * retour, c'est la pièce telle qu'elle est désormais, pas une adresse : le 201
 * imposerait un `Location` que personne n'irait chercher.
 *
 * L'auteur (`@CurrentUser()`) est passé à chaque appel : chaque geste est
 * journalisé au même endroit que les suspensions, et le journal n'accepte pas
 * d'action anonyme.
 */
@Roles('sm_admin')
@Controller('crm')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * LA FILE DE RECOUVREMENT — tous les impayés du parc, du plus ancien au plus
   * récent.
   *
   * Déclarée AVANT les routes `tenants/:id/…` par habitude de lecture ; les
   * chemins ne se recouvrent pas, il n'y a donc aucun risque de capture.
   */
  @Get('billing/overdue')
  overdue() {
    return this.billing.overdue();
  }

  /**
   * FICHE FACTURATION d'un client : abonnement en cours, prochaine échéance,
   * historique, TOTAL DÛ et ancienneté de la plus vieille impayée.
   *
   * `?limit=` ne tronque QUE l'historique affiché : le total dû est calculé
   * à part, sur l'intégralité des factures non réglées.
   *
   * La consultation est journalisée — ouvrir le dossier financier d'un client
   * est un accès à ses données, pas un geste neutre.
   */
  @Get('tenants/:id/billing')
  tenantBilling(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Query(zod(BillingHistoryQuerySchema)) query: BillingHistoryQuery,
  ) {
    return this.billing.tenantBilling(actor, id, query);
  }

  /**
   * ÉMETTRE une facture. Corps vide = l'abonnement du mois courant au tarif de
   * la formule en cours.
   */
  @HttpCode(200)
  @Post('tenants/:id/invoices')
  issue(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body(zod(InvoiceIssueSchema)) body: InvoiceIssue,
  ) {
    return this.billing.issue(actor, id, body);
  }

  /** ENCAISSER : moyen obligatoire, date facultative (défaut : maintenant). */
  @HttpCode(200)
  @Post('tenants/:id/invoices/:invoiceId/pay')
  pay(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
    @Body(zod(InvoicePaySchema)) body: InvoicePay,
  ) {
    return this.billing.pay(actor, id, invoiceId, body);
  }

  /**
   * ANNULER avec un motif. Il n'existe aucune route de suppression, et c'est
   * délibéré : une facture est une pièce comptable.
   */
  @HttpCode(200)
  @Post('tenants/:id/invoices/:invoiceId/cancel')
  cancel(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
    @Body(zod(InvoiceCancelSchema)) body: InvoiceCancel,
  ) {
    return this.billing.cancel(actor, id, invoiceId, body);
  }
}
