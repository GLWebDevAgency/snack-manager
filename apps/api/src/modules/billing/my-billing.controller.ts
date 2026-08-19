import { Controller, Get, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import {
  BillingHistoryQuerySchema,
  invoicePdfFilename,
  type BillingHistoryQuery,
} from '@sm/contracts';
import { Public, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { TenantSessionGuard } from './tenant-session.guard';
import { MyBillingService } from './my-billing.service';
import { renderInvoicePdf } from './invoice-pdf';

/**
 * « MON ABONNEMENT » — la surface du RESTAURATEUR sur sa propre facturation.
 *
 * Symétrique de `crm/billing.controller.ts` et strictement disjointe : là-bas
 * l'équipe Snack Manager consulte n'importe quel client par son identifiant
 * d'URL ; ici le gérant ne consulte QUE le sien, et il n'existe aucun moyen de
 * désigner un autre établissement — pas de `:tenantId`, pas de paramètre de
 * requête, rien à forger. Le tenant vient du jeton, un point c'est tout.
 *
 * ─── `@Public()` N'EST PAS UNE OUVERTURE, C'EST UN DÉPLACEMENT ───
 *
 * Il désarme le garde GLOBAL, que `TenantSessionGuard` remplace immédiatement —
 * même secret, même vérification de signature, et un contrôle de rôle PLUS
 * strict (le compte `owner` du gérant, jamais une session de tablette).
 *
 * La seule chose qui change est la lecture du statut de compte : un
 * établissement SUSPENDU garde cet écran. C'est la règle « on ferme ce qui
 * encaisse, on laisse ouvert ce qui affiche » poussée à sa conclusion — un
 * restaurateur suspendu pour impayé a besoin, précisément, du numéro de pièce
 * et du montant pour régulariser. Lui fermer cette porte-là, c'est le suspendre
 * définitivement.
 *
 * Toute route ajoutée à ce contrôleur hérite de ce choix : n'y mettre QUE de la
 * lecture de facturation. Un geste qui modifie l'établissement n'a rien à faire
 * ici — il doit repasser par le garde global, qui saura le refuser.
 */
@Public()
@UseGuards(TenantSessionGuard)
@Controller('billing')
export class MyBillingController {
  constructor(private readonly billing: MyBillingService) {}

  /**
   * MON ABONNEMENT ET MES FACTURES.
   *
   * `?limit=` ne tronque que l'historique affiché : la prochaine échéance et le
   * total restant dû sont calculés sur l'intégralité des pièces non réglées.
   */
  @Get('me')
  mine(
    @TenantId() tenantId: string,
    @Query(zod(BillingHistoryQuerySchema)) query: BillingHistoryQuery,
  ) {
    return this.billing.mine(tenantId, query);
  }

  /**
   * UNE FACTURE EN PDF, avec les mentions obligatoires du droit français.
   *
   * `:id` ne suffit jamais à ouvrir la pièce : la requête porte AUSSI le tenant
   * du jeton. Une facture d'un autre restaurant répond 404 — pas 403 : le
   * gérant n'a pas à apprendre qu'elle existe.
   */
  @Get('me/invoices/:id/pdf')
  async pdf(@TenantId() tenantId: string, @Param('id') id: string): Promise<StreamableFile> {
    const document = await this.billing.document(tenantId, id);
    const buffer = renderInvoicePdf(document);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      // `inline` et non `attachment` : le navigateur l'ouvre dans son lecteur,
      // le gérant vérifie que c'est la bonne pièce, puis l'enregistre s'il veut.
      // Un téléchargement aveugle obligerait à ouvrir le fichier pour le savoir.
      disposition: `inline; filename="${invoicePdfFilename(document.number)}"`,
      length: buffer.length,
    });
  }
}
