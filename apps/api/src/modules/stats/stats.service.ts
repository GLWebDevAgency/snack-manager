import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import type {
  StatsChannelBucket,
  StatsExportOrdersQuery,
  StatsHeatmapCell,
  StatsOverview,
  StatsPeriod,
  StatsPrepTimes,
  StatsSummaryLive,
  StatsTimeseries,
  StatsTimeseriesBucket,
  StatsTopProduct,
} from '@sm/contracts';
import type { Category, Order, Product, Review } from '@sm/db';
import { excelCsvCell, excelCsvNumber } from './excel-csv';

const TZ = 'Europe/Paris';
/** CA = commandes prêtes + livrées ; les annulées (et en cours) sont exclues. */
const REVENUE_STATUSES = ['ready', 'delivered'];
const DAY_MS = 86_400_000;
/** BOM UTF-8 : Excel FR ouvre le CSV avec les bons accents. */
const BOM = '\ufeff';
const WEEKDAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// ─── Utilitaires fuseau Europe/Paris (aucune dépendance, DST-safe) ───

const ymdFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const wallFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Composants calendaires (Paris) d'un instant. */
function parisYmd(d: Date): { y: number; m: number; d: number } {
  const [y, m, day] = ymdFmt.format(d).split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: day ?? 1 };
}

/** Heure murale Paris d'un instant, exprimée en ms « UTC » (pour calcul d'offset). */
function parisWallMs(d: Date): number {
  const get = (t: string) => Number(wallFmt.formatToParts(d).find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** Instant UTC correspondant à une heure murale Paris donnée. */
function parisWallToUtc(y: number, m: number, d: number, h = 0, min = 0): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let ts = target;
  for (let i = 0; i < 2; i++) ts += target - parisWallMs(new Date(ts));
  return new Date(ts);
}

/** Minuit Paris du jour calendaire situé `minusDays` jours avant l'instant `d`. */
function parisDayStart(d: Date, minusDays = 0): Date {
  const { y, m, d: day } = parisYmd(d);
  const cal = new Date(Date.UTC(y, m - 1, day) - minusDays * DAY_MS);
  return parisWallToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate());
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Variation en % (1 décimale) — null si la référence est nulle. */
function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Centimes → euros français « 12,50 ». */
const euros = (cents: number) => excelCsvNumber((cents / 100).toFixed(2).replace('.', ','));

const CHANNEL_FR: Record<string, string> = { pos: 'Caisse', online: 'En ligne', phone: 'Téléphone' };
const TYPE_FR: Record<string, string> = { surplace: 'Sur place', emporter: 'À emporter', pickup: 'Retrait' };
const STATUS_FR: Record<string, string> = {
  new: 'Nouvelle',
  preparing: 'En préparation',
  ready: 'Prête',
  delivered: 'Remise',
  cancelled: 'Annulée',
};
const PAY_METHOD_FR: Record<string, string> = { online: 'En ligne', counter: 'Comptoir' };
const PAY_STATUS_FR: Record<string, string> = { pending: 'En attente', paid: 'Payé', refunded: 'Remboursé' };

@Injectable()
export class StatsService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Category') private readonly categories: Model<Category>,
    @InjectModel('Review') private readonly reviews: Model<Review>,
  ) {}

  private tid(tenantId: string): Types.ObjectId {
    return new Types.ObjectId(tenantId);
  }

  /** Fenêtre courante + fenêtre précédente équivalente (même durée écoulée). */
  private periodRange(period: StatsPeriod): {
    start: Date;
    end: Date;
    prevStart: Date;
    prevEnd: Date;
  } {
    const now = new Date();
    const days = period === '1d' ? 0 : period === '7d' ? 6 : 29;
    const start = parisDayStart(now, days);
    const prevStart = parisDayStart(now, days * 2 + 1);
    const elapsed = now.getTime() - start.getTime();
    return { start, end: now, prevStart, prevEnd: new Date(prevStart.getTime() + elapsed) };
  }

  /** $match commun : tenant + fenêtre + statuts générateurs de CA. */
  private revenueMatch(tenantId: string, start: Date, end: Date): Record<string, unknown> {
    return {
      tenantId: this.tid(tenantId),
      status: { $in: REVENUE_STATUSES },
      createdAt: { $gte: start, $lte: end },
    };
  }

  private async sumWindow(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<{ ca: number; orders: number }> {
    const rows = await this.orders.aggregate<{ ca: number; n: number }>([
      { $match: this.revenueMatch(tenantId, start, end) },
      { $group: { _id: null, ca: { $sum: '$totals.total' }, n: { $sum: 1 } } },
    ]);
    return { ca: rows[0]?.ca ?? 0, orders: rows[0]?.n ?? 0 };
  }

  // ─── GET /stats/overview ───

  async overview(tenantId: string, period: StatsPeriod): Promise<StatsOverview> {
    const { start, end, prevStart, prevEnd } = this.periodRange(period);
    const [cur, prev] = await Promise.all([
      this.sumWindow(tenantId, start, end),
      this.sumWindow(tenantId, prevStart, prevEnd),
    ]);
    const avg = cur.orders > 0 ? Math.round(cur.ca / cur.orders) : 0;
    const prevAvg = prev.orders > 0 ? Math.round(prev.ca / prev.orders) : 0;
    return {
      period,
      caCents: cur.ca,
      orders: cur.orders,
      avgBasketCents: avg,
      deltas: {
        caPct: deltaPct(cur.ca, prev.ca),
        ordersPct: deltaPct(cur.orders, prev.orders),
        avgBasketPct: deltaPct(avg, prevAvg),
      },
    };
  }

  // ─── GET /stats/timeseries ───

  async timeseries(tenantId: string, period: StatsPeriod): Promise<StatsTimeseries> {
    if (period === '1d') return { period, buckets: await this.timeseriesByHour(tenantId) };
    if (period === '7d') return { period, buckets: await this.timeseriesByDay(tenantId) };
    return { period, buckets: await this.timeseriesByWeek(tenantId) };
  }

  /** 1d : par heure de service (11h → 22h), aujourd'hui. */
  private async timeseriesByHour(tenantId: string): Promise<StatsTimeseriesBucket[]> {
    const now = new Date();
    const rows = await this.orders.aggregate<{ _id: string; ca: number; n: number }>([
      { $match: this.revenueMatch(tenantId, parisDayStart(now), now) },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%H', timezone: TZ } },
          ca: { $sum: '$totals.total' },
          n: { $sum: 1 },
        },
      },
    ]);
    /*
     * LA COURBE COUVRE CE QUE LE KPI COMPTE.
     *
     * Elle s'arrêtait à 11 h–22 h : tout ce qui tombait hors de cette plage
     * était agrégé par Mongo, puis JETÉ. Le chiffre d'affaires du jour, affiché
     * juste à côté et calculé sur la journée entière, ne correspondait donc pas
     * à la somme de la courbe — deux chiffres contradictoires, côte à côte, sans
     * que rien n'explique l'écart. Un service du soir qui déborde à 23 h, un
     * petit-déjeuner, une livraison de fin de nuit : autant de recettes
     * invisibles.
     *
     * Le reste du produit assume d'ailleurs des heures plus larges — la carte de
     * chaleur va jusqu'à 23 h.
     *
     * Les heures VIDES du début et de la fin sont retirées : afficher minuit à
     * 10 h à zéro chaque matin écraserait la courbe du service sur le tiers
     * droit du graphique. On garde toujours au moins la plage de référence,
     * pour qu'un écran ne se réduise pas à une barre unique.
     */
    const byHour = new Map(rows.map((r) => [r._id, r]));
    const toutes: StatsTimeseriesBucket[] = [];
    for (let h = 0; h <= 23; h++) {
      const row = byHour.get(pad(h));
      toutes.push({ label: `${h}h`, caCents: row?.ca ?? 0, orders: row?.n ?? 0 });
    }
    const premiere = toutes.findIndex((b) => b.orders > 0);
    if (premiere < 0) return toutes.slice(11, 23);
    const derniere = toutes.length - 1 - [...toutes].reverse().findIndex((b) => b.orders > 0);
    return toutes.slice(Math.min(premiere, 11), Math.max(derniere, 22) + 1);
  }

  /** 7d : par jour (Lun → Dim), 7 derniers jours glissants. */
  private async timeseriesByDay(tenantId: string): Promise<StatsTimeseriesBucket[]> {
    const now = new Date();
    const rows = await this.orders.aggregate<{ _id: string; ca: number; n: number }>([
      { $match: this.revenueMatch(tenantId, parisDayStart(now, 6), now) },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: TZ } },
          ca: { $sum: '$totals.total' },
          n: { $sum: 1 },
        },
      },
    ]);
    const byDay = new Map(rows.map((r) => [r._id, r]));
    const { y, m, d } = parisYmd(now);
    const todayCal = Date.UTC(y, m - 1, d);
    const buckets: StatsTimeseriesBucket[] = [];
    for (let k = 6; k >= 0; k--) {
      const cal = new Date(todayCal - k * DAY_MS);
      const key = `${cal.getUTCFullYear()}-${pad(cal.getUTCMonth() + 1)}-${pad(cal.getUTCDate())}`;
      const iso = cal.getUTCDay() === 0 ? 7 : cal.getUTCDay();
      const row = byDay.get(key);
      buckets.push({
        label: WEEKDAYS_FR[iso - 1] ?? '?',
        caCents: row?.ca ?? 0,
        orders: row?.n ?? 0,
      });
    }
    return buckets;
  }

  /** 30d : par semaine ISO (S-3 → cette semaine), lundi comme premier jour. */
  private async timeseriesByWeek(tenantId: string): Promise<StatsTimeseriesBucket[]> {
    const now = new Date();
    const { y, m, d } = parisYmd(now);
    const todayCal = Date.UTC(y, m - 1, d);
    const isoToday = new Date(todayCal).getUTCDay() === 0 ? 7 : new Date(todayCal).getUTCDay();
    const mondayCal = todayCal - (isoToday - 1) * DAY_MS;
    const weeks: { start: Date; label: string }[] = [];
    for (let j = 3; j >= 0; j--) {
      const cal = new Date(mondayCal - j * 7 * DAY_MS);
      weeks.push({
        start: parisWallToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate()),
        label: j === 0 ? 'Cette sem.' : `S-${j}`,
      });
    }
    const rangeStart = weeks[0]?.start ?? parisDayStart(now, 29);
    const rows = await this.orders.aggregate<{ _id: Date; ca: number; n: number }>([
      { $match: this.revenueMatch(tenantId, rangeStart, now) },
      {
        $group: {
          _id: {
            $dateTrunc: { date: '$createdAt', unit: 'week', timezone: TZ, startOfWeek: 'monday' },
          },
          ca: { $sum: '$totals.total' },
          n: { $sum: 1 },
        },
      },
    ]);
    const byWeek = new Map(rows.map((r) => [new Date(r._id).getTime(), r]));
    return weeks.map((w) => {
      const row = byWeek.get(w.start.getTime());
      return { label: w.label, caCents: row?.ca ?? 0, orders: row?.n ?? 0 };
    });
  }

  // ─── GET /stats/top-products ───

  async topProducts(
    tenantId: string,
    period: StatsPeriod,
    limit: number,
  ): Promise<StatsTopProduct[]> {
    const { start, end } = this.periodRange(period);
    const rows = await this.orders.aggregate<{ _id: string; qty: number; ca: number }>([
      { $match: this.revenueMatch(tenantId, start, end) },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.name',
          qty: { $sum: '$lines.qty' },
          ca: { $sum: '$lines.lineTotal' },
        },
      },
      { $sort: { qty: -1, ca: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => ({ name: r._id, qty: r.qty, caCents: r.ca }));
  }

  // ─── GET /stats/channels ───

  async channels(tenantId: string, period: StatsPeriod): Promise<StatsChannelBucket[]> {
    const { start, end } = this.periodRange(period);
    const rows = await this.orders.aggregate<{ _id: string; ca: number; n: number }>([
      { $match: this.revenueMatch(tenantId, start, end) },
      { $group: { _id: '$channel', ca: { $sum: '$totals.total' }, n: { $sum: 1 } } },
    ]);
    const byChannel = new Map(rows.map((r) => [r._id, r]));
    return (['pos', 'online', 'phone'] as const).map((channel) => {
      const row = byChannel.get(channel);
      return { channel, orders: row?.n ?? 0, caCents: row?.ca ?? 0 };
    });
  }

  // ─── GET /stats/heatmap ───

  /** Affluence 7 jours × heures 11-23 sur les 30 derniers jours (annulées exclues). */
  async heatmap(tenantId: string): Promise<StatsHeatmapCell[]> {
    const now = new Date();
    const rows = await this.orders.aggregate<{ _id: { day: number; hour: number }; n: number }>([
      {
        $match: {
          tenantId: this.tid(tenantId),
          status: { $ne: 'cancelled' },
          createdAt: { $gte: parisDayStart(now, 29), $lte: now },
        },
      },
      {
        $project: {
          day: { $isoDayOfWeek: { date: '$createdAt', timezone: TZ } },
          hour: { $hour: { date: '$createdAt', timezone: TZ } },
        },
      },
      { $match: { hour: { $gte: 11, $lte: 23 } } },
      { $group: { _id: { day: '$day', hour: '$hour' }, n: { $sum: 1 } } },
    ]);
    const byCell = new Map(rows.map((r) => [`${r._id.day}:${r._id.hour}`, r.n]));
    const cells: StatsHeatmapCell[] = [];
    for (let day = 1; day <= 7; day++) {
      for (let hour = 11; hour <= 23; hour++) {
        cells.push({ day, hour, orders: byCell.get(`${day}:${hour}`) ?? 0 });
      }
    }
    return cells;
  }

  // ─── GET /stats/prep-times ───

  /** Délai new → ready (statusHistory), moyenne et P90 — calcul 100 % serveur. */
  async prepTimes(tenantId: string, period: StatsPeriod): Promise<StatsPrepTimes> {
    const { start, end } = this.periodRange(period);
    const historyAt = (status: string) => ({
      $first: {
        $map: {
          input: {
            $filter: { input: '$statusHistory', as: 'h', cond: { $eq: ['$$h.status', status] } },
          },
          as: 'h',
          in: '$$h.at',
        },
      },
    });
    const pipeline: PipelineStage[] = [
      { $match: this.revenueMatch(tenantId, start, end) },
      { $project: { newAt: historyAt('new'), readyAt: historyAt('ready') } },
      { $match: { newAt: { $ne: null }, readyAt: { $ne: null } } },
      { $project: { diffMin: { $divide: [{ $subtract: ['$readyAt', '$newAt'] }, 60_000] } } },
      { $match: { diffMin: { $gte: 0 } } },
      { $group: { _id: null, avg: { $avg: '$diffMin' }, diffs: { $push: '$diffMin' }, n: { $sum: 1 } } },
      {
        $project: {
          avg: 1,
          n: 1,
          p90: {
            $arrayElemAt: [
              { $sortArray: { input: '$diffs', sortBy: 1 } },
              {
                $max: [
                  0,
                  { $subtract: [{ $ceil: { $multiply: [{ $size: '$diffs' }, 0.9] } }, 1] },
                ],
              },
            ],
          },
        },
      },
    ];
    const rows = await this.orders.aggregate<{ avg: number; p90: number; n: number }>(pipeline);
    const row = rows[0];
    return {
      period,
      avgMinutes: row ? Math.round(row.avg * 10) / 10 : null,
      p90Minutes: row ? Math.round(row.p90 * 10) / 10 : null,
      orders: row?.n ?? 0,
    };
  }

  // ─── GET /stats/summary-live ───

  async summaryLive(tenantId: string): Promise<StatsSummaryLive> {
    const tid = this.tid(tenantId);
    const now = new Date();
    const [today, newCount, readyCount, reviewsPendingCount, productsOutCount] = await Promise.all([
      this.sumWindow(tenantId, parisDayStart(now), now),
      this.orders.countDocuments({ tenantId: tid, status: 'new' }),
      this.orders.countDocuments({ tenantId: tid, status: 'ready' }),
      this.reviews.countDocuments({ tenantId: tid, reply: null }),
      this.products.countDocuments({ tenantId: tid, outOfStock: true, active: true }),
    ]);
    return {
      caTodayCents: today.ca,
      ordersToday: today.orders,
      newCount,
      readyCount,
      reviewsPendingCount,
      productsOutCount,
    };
  }

  // ─── Exports CSV (BOM UTF-8, séparateur « ; », montants en euros virgule) ───

  async exportOrdersCsv(tenantId: string, q: StatsExportOrdersQuery): Promise<string> {
    const now = new Date();
    const parse = (s: string): { y: number; m: number; d: number } => {
      const [y, m, d] = s.split('-').map(Number);
      return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
    };
    const from = q.from ? parse(q.from) : parisYmd(parisDayStart(now, 29));
    const start = parisWallToUtc(from.y, from.m, from.d);
    // Borne haute : lendemain 00:00 Paris du jour `to` (jour inclus)
    let end = now;
    if (q.to) {
      const to = parse(q.to);
      const cal = new Date(Date.UTC(to.y, to.m - 1, to.d) + DAY_MS);
      end = parisWallToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate());
    }

    const rows = await this.orders
      .find({ tenantId: this.tid(tenantId), createdAt: { $gte: start, $lt: end } })
      .sort({ createdAt: 1 })
      .limit(20_000)
      .lean();

    const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'short' });
    const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, timeStyle: 'short' });
    const header = [
      'Numéro',
      'Date',
      'Heure',
      'Canal',
      'Type',
      'Statut',
      'Articles',
      'Sous-total (€)',
      'Remise (€)',
      'Total (€)',
      'Paiement',
      'Statut paiement',
      'Client',
    ];
    const lines = rows.map((o) => {
      const createdAt = (o as { createdAt?: Date }).createdAt ?? new Date();
      const totals = o.totals ?? { subtotal: 0, discount: null, total: 0 };
      const payment = o.payment ?? { method: 'counter', status: 'pending' };
      const articles = o.lines
        .map((l) => `${l.qty}× ${l.name}${l.variantName ? ` (${l.variantName})` : ''}`)
        .join(' · ');
      return [
        o.number,
        dateFmt.format(createdAt),
        timeFmt.format(createdAt),
        CHANNEL_FR[o.channel] ?? o.channel,
        TYPE_FR[o.type] ?? o.type,
        STATUS_FR[o.status] ?? o.status,
        articles,
        euros(totals.subtotal),
        totals.discount ? euros(totals.discount.amount ?? 0) : '',
        euros(totals.total),
        PAY_METHOD_FR[payment.method] ?? payment.method,
        PAY_STATUS_FR[payment.status] ?? payment.status,
        o.pickup?.customerName ?? '',
      ]
        .map(excelCsvCell)
        .join(';');
    });
    return BOM + `${[header.map(excelCsvCell).join(';'), ...lines].join('\r\n')}\r\n`;
  }

  async exportMenuCsv(tenantId: string): Promise<string> {
    const tid = this.tid(tenantId);
    const [cats, prods] = await Promise.all([
      this.categories.find({ tenantId: tid }).sort({ order: 1 }).lean(),
      /*
       * MÊME BORNE QUE L'EXPORT DES COMMANDES, ET POUR LA MÊME RAISON.
       *
       * Celui-ci n'en avait aucune : une carte anormalement grosse — un import
       * qui a doublé, une reprise ratée — ramenait tout en mémoire d'un coup.
       * 20 000 produits sont hors d'atteinte d'une carte réelle ; la borne
       * n'existe que pour qu'un accident ne devienne pas une panne.
       */
      this.products.find({ tenantId: tid }).sort({ order: 1 }).limit(20_000).lean(),
    ]);
    const catName = new Map(cats.map((c) => [String(c._id), c.name]));
    const header = ['Catégorie', 'Produit', 'Description', 'Variante', 'Prix (€)', 'Actif', 'Rupture'];
    const lines: string[] = [];
    const bool = (v: boolean) => (v ? 'Oui' : 'Non');
    for (const p of prods) {
      const cat = p.categoryId ? (catName.get(String(p.categoryId)) ?? 'Non rattaché') : 'Non rattaché';
      if (p.variants.length > 0) {
        for (const v of p.variants) {
          lines.push(
            [cat, p.name, p.description, v.name, euros(v.price), bool(p.active), bool(p.outOfStock)]
              .map(excelCsvCell)
              .join(';'),
          );
        }
      } else {
        lines.push(
          [cat, p.name, p.description, '', euros(p.price), bool(p.active), bool(p.outOfStock)]
            .map(excelCsvCell)
            .join(';'),
        );
      }
    }
    return BOM + `${[header.map(excelCsvCell).join(';'), ...lines].join('\r\n')}\r\n`;
  }
}
