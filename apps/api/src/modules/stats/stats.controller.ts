import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  StatsExportOrdersQuerySchema,
  StatsPeriodQuerySchema,
  StatsTopProductsQuerySchema,
  type StatsExportOrdersQuery,
  type StatsPeriodQuery,
  type StatsTopProductsQuery,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Roles, TenantId } from '../../common/auth';
import { StatsService } from './stats.service';

/**
 * Statistiques du restaurant — réservées au gérant.
 * Toutes les agrégations sont exécutées côté MongoDB ($match/$group),
 * jamais par filtrage client. tenantId : toujours issu du JWT.
 */
@Roles('owner', 'gerant')
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string, @Query(zod(StatsPeriodQuerySchema)) q: StatsPeriodQuery) {
    return this.stats.overview(tenantId, q.period);
  }

  @Get('timeseries')
  timeseries(
    @TenantId() tenantId: string,
    @Query(zod(StatsPeriodQuerySchema)) q: StatsPeriodQuery,
  ) {
    return this.stats.timeseries(tenantId, q.period);
  }

  @Get('top-products')
  topProducts(
    @TenantId() tenantId: string,
    @Query(zod(StatsTopProductsQuerySchema)) q: StatsTopProductsQuery,
  ) {
    return this.stats.topProducts(tenantId, q.period, q.limit);
  }

  @Get('channels')
  channels(@TenantId() tenantId: string, @Query(zod(StatsPeriodQuerySchema)) q: StatsPeriodQuery) {
    return this.stats.channels(tenantId, q.period);
  }

  @Get('heatmap')
  heatmap(@TenantId() tenantId: string) {
    return this.stats.heatmap(tenantId);
  }

  @Get('prep-times')
  prepTimes(@TenantId() tenantId: string, @Query(zod(StatsPeriodQuerySchema)) q: StatsPeriodQuery) {
    return this.stats.prepTimes(tenantId, q.period);
  }

  /** Bandeau « À faire maintenant » du dashboard. */
  @Get('summary-live')
  summaryLive(@TenantId() tenantId: string) {
    return this.stats.summaryLive(tenantId);
  }

  /*
   * LES DEUX EXPORTS SONT LES SEULES ROUTES QUI BALAIENT TOUTE UNE COLLECTION.
   *
   * L'export des commandes est borné à 20 000 lignes ; celui de la carte ne
   * l'était par rien, et aucun des deux n'était limité en débit. Un onglet
   * gardé ouvert sur un rafraîchissement automatique suffisait à faire relire
   * l'intégralité des commandes d'un restaurant en boucle.
   *
   * Quatre par minute : on exporte pour ouvrir un tableur, pas pour alimenter
   * un flux. Les écrans de statistiques, eux, ne sont pas limités — ils lisent
   * des agrégats, pas des collections.
   */
  // ─── Exports CSV (Excel FR : BOM UTF-8 + séparateur « ; ») ───

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Get('export/orders.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="commandes.csv"')
  exportOrders(
    @TenantId() tenantId: string,
    @Query(zod(StatsExportOrdersQuerySchema)) q: StatsExportOrdersQuery,
  ) {
    return this.stats.exportOrdersCsv(tenantId, q);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Get('export/menu.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="menu.csv"')
  exportMenu(@TenantId() tenantId: string) {
    return this.stats.exportMenuCsv(tenantId);
  }
}
