import { Controller, Get, Param, Post } from '@nestjs/common';
// Les retours sont ANNOTÉS avec les contrats publiés : si un service dérive de
// la forme promise au web, c'est cette signature qui casse — pas la fiche
// client un lundi matin.
import type {
  CrmQueueSignal,
  CrmTenantHealth,
  CrmTenantInsights,
  JwtPayload,
} from '@sm/contracts';
import { CurrentUser, Roles } from '../../common/auth';
import { HealthService } from './health.service';
import { InsightsService } from './insights.service';
import { SignalsService } from './signals.service';

/**
 * PILOTAGE CLIENT — « tout ce qu'il faut savoir sur un restaurant pour
 * l'accompagner ».
 *
 * Trois routes, trois moments de la journée d'un chargé de compte :
 *
 *  - `/crm/signals` ouvre la matinée — la file de travail, tous clients
 *    confondus, triée par gravité : qui rappeler aujourd'hui ;
 *  - `/crm/tenants/:id/health` s'ouvre juste avant de décrocher — activité,
 *    score de santé et sa composition, adoption des modules, parc, appro ;
 *  - `/crm/tenants/:id/insights` porte la conversation elle-même — le conseil
 *    chiffré, seul contenu de cette surface que le restaurateur a un intérêt
 *    direct à entendre.
 *
 * ─── CLOISONNEMENT ───
 *
 * `@Roles('sm_admin')` posé sur la CLASSE, comme sur `CrmController` et
 * `AdminController` : toutes les routes en héritent, y compris celles qu'on
 * ajoutera demain. Ces routes lisent les données de TOUS les restaurants —
 * `/crm/signals` balaie le parc entier. Un gérant (`owner`) qui les appelle
 * avec son jeton reçoit un 403 ; c'est la seule garde qui compte, celle du web
 * n'est qu'un confort de navigation. Elles ne doivent même pas être devinables
 * depuis un back-office restaurant.
 *
 * Aucun `@TenantId()` ici, et c'est délibéré : le CRM est TRANS-TENANT et
 * l'équipe SM porte un jeton sans `tenantId`. Le restaurant analysé vient de
 * l'URL, jamais du jeton — c'est l'exact inverse de la règle qui s'applique aux
 * routes d'un restaurateur.
 *
 * ─── RESPECT DES CLIENTS DE NOS CLIENTS ───
 *
 * Aucune de ces routes ne rend le nom ou le téléphone d'un consommateur final.
 * Elles ne portent que des agrégats : comptages, sommes, dates, pourcentages.
 * Le fichier client d'un restaurateur lui appartient — le détenir nous rendrait
 * responsables de sa protection sans qu'aucun geste d'accompagnement ne
 * l'exige.
 *
 * Troisième contrôleur du préfixe `/crm`, et pas une fusion : `CrmController`
 * OBSERVE le pipeline commercial, `AdminController` AGIT sur les comptes,
 * celui-ci ANALYSE l'exploitation. Même écran pour l'équipe, trois
 * responsabilités.
 */
@Roles('sm_admin')
@Controller('crm')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly insights: InsightsService,
    private readonly signalsQueue: SignalsService,
  ) {}

  /**
   * LA FILE DE TRAVAIL — ce qui mérite un appel cette semaine, tous clients
   * confondus, trié par gravité puis par ancienneté.
   *
   * Sans pagination volontairement : une file de travail qu'on feuillette
   * n'est plus une file de travail. Sa longueur est bornée par la taille du
   * parc, et si elle devient illisible, c'est le parc qui va mal — pas la
   * route.
   *
   * Servie par `SignalsService` et non plus par `HealthService` : la file
   * croise désormais des sources que la fiche de santé n'ouvre pas — la
   * facturation (impayés réels, et non plus le seul statut de compte) et
   * l'approvisionnement (ruptures, suivi de stock). Le JUGEMENT partagé, lui,
   * reste celui de `HealthService` (`buildModules`, `toFleetUnit`,
   * `windowBounds`) : les deux surfaces ne peuvent pas se contredire sur ce
   * qu'est un module utilisé ou une semaine.
   */
  @Get('signals')
  signals(): Promise<CrmQueueSignal[]> {
    return this.signalsQueue.queue();
  }

  /**
   * « Traité » : sort le signal de la file pour quelques jours — il revient
   * si sa cause persiste. L'auteur du geste reste sur la trace.
   */
  @Post('signals/:id/dismiss')
  dismissSignal(@CurrentUser() actor: JwtPayload, @Param('id') id: string) {
    // Le jeton ne porte pas l'e-mail : `sub` suffit à la trace, le journal
    // admin sait déjà résoudre un auteur par son identifiant.
    return this.signalsQueue.dismiss(id, String(actor.sub)).then(() => ({ ok: true as const }));
  }

  /**
   * FICHE DE SANTÉ d'un restaurant : activité 7/30 j comparée à la période
   * précédente, score composite et sa composition, adoption des modules, parc
   * d'appareils, approvisionnement.
   *
   * L'auteur (`@CurrentUser()`) est transmis parce que la consultation est
   * JOURNALISÉE : ouvrir le dossier d'un client est un accès à ses données, pas
   * un geste neutre — même règle que la fiche « compte ».
   */
  @Get('tenants/:id/health')
  tenantHealth(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<CrmTenantHealth> {
    return this.health.tenantHealth(actor, id);
  }

  /**
   * LE CONSEIL CHIFFRÉ : coût matière comparé à la médiane anonymisée du
   * réseau, créneaux creux, produits à marge faible ou en recul, manque à
   * gagner estimé sur les ruptures.
   *
   * La réponse peut sortir sans aucune recommandation, et c'est un
   * comportement voulu : quand la donnée manque, on ne dit rien.
   */
  @Get('tenants/:id/insights')
  tenantInsights(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<CrmTenantInsights> {
    return this.insights.tenantInsights(actor, id);
  }
}
