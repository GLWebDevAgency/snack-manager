import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import type { JwtPayload } from '@sm/contracts';
import type { Order, Product, Tenant } from '@sm/db';
import { lineCostCents, type SupplyDb } from '@sm/supply';
import { SUPPLY_DB } from '../../supply-db.module';
import { AdminService } from './admin.service';

/**
 * LE CONSEIL CHIFFRÉ — notre différenciateur.
 *
 * Un back-office qui liste des chiffres, tout le monde sait en faire. Ce qui
 * change la conversation avec un restaurateur, c'est de lui dire « votre coût
 * matière est à 34 %, la médiane du réseau est à 29 %, et voici les trois
 * produits qui vous coûtent ces cinq points ». C'est le rôle de ce service.
 *
 * ─── TROIS RÈGLES, TENUES DANS LE CODE ───
 *
 * 1. AUCUNE RECOMMANDATION INVENTÉE. Chaque conseil renvoyé s'appuie sur une
 *    donnée réellement présente. Quand elle manque — pas de recette saisie, pas
 *    assez de restaurants dans le panel, trop peu de ventes pour qu'un
 *    pourcentage veuille dire quelque chose — on ne dit RIEN. Un conseil faux
 *    coûte plus cher qu'un écran vide : il se paie en crédibilité, une seule
 *    fois, définitivement.
 *
 * 2. RESPECT DES CLIENTS DE NOS CLIENTS. On agrège des PRODUITS, des HEURES et
 *    des MONTANTS. Aucune requête ne lit `pickup.customerName`,
 *    `pickup.customerPhone` ni l'auteur d'un avis : le fichier client d'un
 *    restaurateur lui appartient. Les créneaux creux se calculent sur des
 *    comptages horaires, jamais sur des habitudes individuelles.
 *
 * 3. LE RÉSEAU EST ANONYME. La comparaison ne renvoie qu'une médiane et la
 *    TAILLE du panel — jamais le nom, le rang ni le chiffre d'un autre
 *    restaurant. Un client ne doit rien pouvoir déduire de son voisin, et nous
 *    n'avons aucune raison de le lui offrir.
 */

const DAY_MS = 86_400_000;
const TZ = 'Europe/Paris';
/** CA = commandes prêtes + remises — convention partagée avec Stats et CRM. */
const REVENUE_STATUSES = ['ready', 'delivered'];
/** Toutes les analyses portent sur la même fenêtre de 30 jours glissants. */
export const WINDOW_DAYS = 30;

// ─── Seuils (chacun justifié, aucun tiré au hasard) ───

/**
 * En dessous de 60 % du chiffre d'affaires couvert par une recette connue, le
 * coût matière calculé ne décrit plus le restaurant : il décrit le tiers de la
 * carte qui a été saisi. On préfère ne rien afficher.
 */
export const MIN_COST_COVERAGE_PCT = 60;

/**
 * Une « médiane du réseau » calculée sur deux restaurants, c'est la moyenne de
 * deux restaurants. Il en faut au moins trois pour que le mot ait un sens — et
 * pour qu'aucun client ne puisse déduire le chiffre d'un autre.
 */
export const MIN_NETWORK_PANEL = 3;

/**
 * Marge matière plancher.
 *
 * Le coût matière visé en restauration rapide tient dans 28-32 % du prix de
 * vente, soit 68-72 % de marge. En dessous de 55 %, le produit ne paie plus sa
 * part des charges du service : c'est là qu'il faut regarder la recette, le
 * prix, ou les deux.
 */
export const LOW_MARGIN_PCT = 55;

/** Une marge qui perd 5 points en quinze jours a bougé pour une raison. */
export const MARGIN_DROP_POINTS = 5;

/**
 * En dessous de 10 unités vendues sur une demi-fenêtre, la marge d'un produit
 * bouge au gré d'une remise isolée. On ne bâtit pas un conseil là-dessus.
 */
export const MARGIN_MIN_QTY = 10;

/** Un creux, c'est une heure qui fait moins de la moitié de la moyenne du service. */
export const QUIET_SLOT_RATIO = 0.5;

/**
 * Ce qui compte comme une HEURE DE SERVICE : au moins un dixième de l'heure de
 * pointe.
 *
 * Le seuil n'est pas cosmétique, il est structurant. Sur les données réelles de
 * Class'Food, cinq commandes traînent à minuit et deux à 10 h — fins de service
 * et essais. Prendre « toute heure avec au moins une commande » étirerait
 * l'amplitude de 0 h à 23 h, ferait entrer vingt heures de fermeture dans la
 * moyenne et désignerait 3 h du matin comme un créneau creux à travailler.
 * Avec ce filtre, l'amplitude retenue redevient celle du vrai service :
 * 11 h-13 h le midi, 18 h-21 h le soir.
 */
export const SERVICE_HOUR_MIN_SHARE = 0.1;

/** Il faut une amplitude de service réelle pour parler de creux. */
export const MIN_SERVICE_HOURS = 4;
/** Et assez de commandes pour que la répartition horaire ne soit pas du bruit. */
export const MIN_ORDERS_FOR_SLOTS = 30;

// ─── Types de sortie ───

export type CrmInsightUnit = 'pourcent' | 'points' | 'centimes' | 'commandes' | 'produits';
export type CrmInsightSeverity = 'info' | 'attention' | 'urgent';

/**
 * Une recommandation : un intitulé court, une explication d'une phrase, un
 * chiffre. Les trois sont obligatoires — un conseil sans chiffre n'est pas un
 * conseil, c'est une impression.
 */
export type CrmInsight = {
  /** Clé stable, pour que le web puisse cibler un conseil sans lire le texte. */
  key: string;
  title: string;
  detail: string;
  value: number;
  unit: CrmInsightUnit;
  severity: CrmInsightSeverity;
};

export type CrmFoodCostBenchmark = {
  /** `false` = donnée insuffisante ; aucun conseil n'en est tiré. */
  available: boolean;
  /** Coût matière du restaurant, en % du CA des lignes couvertes. */
  tenantPct: number | null;
  /** Médiane du réseau, anonymisée. `null` si le panel est trop petit. */
  networkMedianPct: number | null;
  /** Taille du panel — le seul chiffre qu'on dit du réseau. */
  panel: number;
  /** Écart en POINTS de pourcentage (positif = ce client coûte plus cher). */
  deltaPoints: number | null;
  costCents: number;
  revenueCents: number;
  /** Part du CA couverte par une recette saisie. */
  coveragePct: number;
};

export type CrmQuietSlot = {
  hour: number;
  label: string;
  orders: number;
  /** Moyenne du restaurant sur sa propre amplitude de service. */
  averageOrders: number;
  /** De combien de % cette heure est en dessous de cette moyenne. */
  gapPct: number;
};

export type CrmProductMargin = {
  productId: string;
  name: string;
  qty: number;
  revenueCents: number;
  costCents: number;
  /** Marge matière sur toute la fenêtre — la base de « marge faible ». */
  marginPct: number;
  /** Marge de la quinzaine récente — `null` si le volume était trop faible. */
  recentMarginPct: number | null;
  /** Marge de la quinzaine précédente, mêmes conditions de volume. */
  previousMarginPct: number | null;
  /** Points de marge perdus d'une quinzaine à l'autre (positif = recul). */
  marginDropPoints: number | null;
};

export type CrmStockoutLoss = {
  productId: string;
  name: string;
  /** Unités vendues par jour de service, avant la coupure. */
  qtyPerDay: number;
  /** Manque à gagner estimé par jour de rupture, en CENTIMES. */
  lossPerDayCents: number;
  /** Ce qui a coupé le produit : rupture d'ingrédient, ou coupure au comptoir. */
  cause: 'ingredient' | 'manuel';
};

export type CrmTenantInsights = {
  tenantId: string;
  name: string;
  windowDays: number;
  /** Jours où le restaurant a réellement servi sur la fenêtre. */
  serviceDays: number;
  foodCost: CrmFoodCostBenchmark;
  quietSlots: CrmQuietSlot[];
  lowMarginProducts: CrmProductMargin[];
  fallingMarginProducts: CrmProductMargin[];
  stockoutLosses: {
    products: CrmStockoutLoss[];
    totalPerDayCents: number;
  };
  /** Ce qu'on dit au restaurateur. Vide si la donnée ne permet rien. */
  recommendations: CrmInsight[];
  computedAt: string;
};

// ─── Fonctions pures ───

const pct1 = (n: number) => Math.round(n * 10) / 10;

/** Montant en centimes → « 1 234 € ». */
export const eurosLabel = (cents: number): string =>
  `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;

/**
 * Médiane d'une série. Sur un nombre pair de valeurs, la moyenne des deux
 * valeurs centrales — la définition ordinaire, et celle qui rend la médiane du
 * réseau insensible à un restaurant très atypique.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return pct1(value);
}

/** Marge matière en % du prix de vente — `null` si rien n'a été vendu. */
export function marginPct(revenueCents: number, costCents: number): number | null {
  if (revenueCents <= 0) return null;
  return pct1(((revenueCents - costCents) / revenueCents) * 100);
}

/**
 * CRÉNEAUX CREUX — les heures où ce restaurant fait nettement moins que sa
 * propre moyenne.
 *
 * Le creux ne se juge que sur les HEURES DE SERVICE du restaurant, déduites des
 * faits (cf. `SERVICE_HOUR_MIN_SHARE`) : signaler que personne ne commande à
 * 4 h du matin n'apprend rien à personne, et noyer les vrais creux sous vingt
 * heures de fermeture rendrait la liste inutilisable.
 *
 * On compare les heures de service ENTRE ELLES, sans reboucher les trous : un
 * restaurant qui ferme entre 15 h et 18 h ne doit pas voir son après-midi de
 * fermeture comptée comme un creux à travailler — c'est un choix
 * d'exploitation, pas un problème commercial.
 *
 * La référence est la MOYENNE DU RESTAURANT, jamais celle du réseau : un snack
 * de quartier et une enseigne de gare n'ont pas la même courbe, et se voir
 * comparer ses heures ne dirait rien à ni l'un ni l'autre.
 */
export function findQuietSlots(
  hourly: ReadonlyMap<number, number>,
  totalOrders: number,
): CrmQuietSlot[] {
  const counts = [...hourly.values()];
  if (counts.length === 0 || totalOrders < MIN_ORDERS_FOR_SLOTS) return [];

  const peak = Math.max(...counts);
  const service = [...hourly.entries()]
    .filter(([, n]) => n >= peak * SERVICE_HOUR_MIN_SHARE && n > 0)
    .map(([hour, orders]) => ({ hour, orders }))
    .sort((a, b) => a.hour - b.hour);
  if (service.length < MIN_SERVICE_HOURS) return [];

  const average = service.reduce((sum, s) => sum + s.orders, 0) / service.length;
  if (average <= 0) return [];

  return service
    .filter((s) => s.orders < average * QUIET_SLOT_RATIO)
    .sort((a, b) => a.orders - b.orders)
    .slice(0, 3)
    .map((s) => ({
      hour: s.hour,
      label: `${s.hour}h–${s.hour + 1}h`,
      orders: s.orders,
      averageOrders: Math.round(average * 10) / 10,
      gapPct: pct1(((average - s.orders) / average) * 100),
    }));
}

/**
 * PERTES ESTIMÉES SUR RUPTURES — « produits coupés × ventes moyennes ».
 *
 * La moyenne est rapportée aux JOURS RÉELLEMENT SERVIS sur la fenêtre, et non
 * aux trente jours calendaires : diviser par 30 les ventes d'un restaurant
 * fermé le dimanche sous-estime la perte d'un septième, tous les jours de la
 * semaine.
 *
 * Le chiffre est un ORDRE DE GRANDEUR, et il est nommé comme tel — une partie
 * des clients reporte son achat sur un autre produit. Il répond à « est-ce que
 * ça vaut le coup d'aller chercher cet ingrédient ce matin ? », pas à autre
 * chose.
 */
export function buildStockoutLosses(
  cut: ReadonlyMap<string, { name: string; cause: 'ingredient' | 'manuel' }>,
  margins: readonly CrmProductMargin[],
  serviceDays: number,
): { products: CrmStockoutLoss[]; totalPerDayCents: number } {
  if (cut.size === 0 || serviceDays <= 0) return { products: [], totalPerDayCents: 0 };

  const byProduct = new Map(margins.map((m) => [m.productId, m]));
  const products: CrmStockoutLoss[] = [];
  for (const [productId, info] of cut) {
    const sales = byProduct.get(productId);
    // Un produit coupé qui ne s'est jamais vendu ne représente aucune perte :
    // on n'invente pas un manque à gagner pour lui faire dire quelque chose.
    if (!sales || sales.revenueCents <= 0) continue;
    products.push({
      productId,
      name: info.name || sales.name,
      cause: info.cause,
      qtyPerDay: Math.round((sales.qty / serviceDays) * 10) / 10,
      lossPerDayCents: Math.round(sales.revenueCents / serviceDays),
    });
  }
  products.sort((a, b) => b.lossPerDayCents - a.lossPerDayCents);
  return {
    products,
    totalPerDayCents: products.reduce((sum, p) => sum + p.lossPerDayCents, 0),
  };
}

/**
 * Rédige les recommandations à partir des faits déjà établis.
 *
 * Fonction pure, et volontairement bavarde en commentaires : c'est le seul
 * endroit du service où l'on décide de PARLER à un restaurateur, et chaque
 * condition d'entrée est une promesse de ne pas dire n'importe quoi.
 */
export function buildRecommendations(facts: {
  foodCost: CrmFoodCostBenchmark;
  quietSlots: readonly CrmQuietSlot[];
  lowMarginProducts: readonly CrmProductMargin[];
  fallingMarginProducts: readonly CrmProductMargin[];
  stockoutLosses: { products: readonly CrmStockoutLoss[]; totalPerDayCents: number };
}): CrmInsight[] {
  const out: CrmInsight[] = [];

  // ─ Coût matière vs réseau ─
  // Trois conditions, toutes nécessaires : le ratio du client existe, la
  // médiane existe (panel suffisant), et l'écart est DÉFAVORABLE. Un client
  // meilleur que le réseau n'a pas besoin d'un conseil, il a besoin d'un
  // compliment — et ce n'est pas ce que cette liste sert à porter.
  const { foodCost } = facts;
  if (
    foodCost.available &&
    foodCost.tenantPct !== null &&
    foodCost.networkMedianPct !== null &&
    foodCost.deltaPoints !== null &&
    foodCost.deltaPoints > 0
  ) {
    out.push({
      key: 'food_cost_above_network',
      title: 'Coût matière au-dessus du réseau',
      detail: `Le coût matière est à ${foodCost.tenantPct} % du chiffre d’affaires, contre ${foodCost.networkMedianPct} % pour la médiane de ${foodCost.panel} restaurants du réseau.`,
      value: pct1(foodCost.deltaPoints),
      unit: 'points',
      severity: foodCost.deltaPoints >= 5 ? 'urgent' : 'attention',
    });
  }

  // ─ Produits à marge faible ─
  const worst = facts.lowMarginProducts[0];
  if (worst) {
    out.push({
      key: 'low_margin_products',
      title: 'Produits à marge faible',
      detail: `${facts.lowMarginProducts.length} produit(s) vendus sous ${LOW_MARGIN_PCT} % de marge matière, dont « ${worst.name} » à ${worst.marginPct} %.`,
      value: worst.marginPct,
      unit: 'pourcent',
      severity: 'attention',
    });
  }

  // ─ Marges en recul ─
  const falling = facts.fallingMarginProducts[0];
  if (falling && falling.marginDropPoints !== null) {
    out.push({
      key: 'falling_margin_products',
      title: 'Marges en recul',
      detail: `« ${falling.name} » a perdu ${falling.marginDropPoints} points de marge en quinze jours (${falling.previousMarginPct} % → ${falling.recentMarginPct} %).`,
      value: falling.marginDropPoints,
      unit: 'points',
      severity: 'attention',
    });
  }

  // ─ Créneaux creux ─
  const quiet = facts.quietSlots[0];
  if (quiet) {
    out.push({
      key: 'quiet_slots',
      title: 'Créneau creux',
      detail: `Le créneau ${quiet.label} fait ${quiet.gapPct} % de moins que la moyenne des heures de service de ce restaurant (${quiet.orders} commandes contre ${quiet.averageOrders} en moyenne).`,
      value: quiet.gapPct,
      unit: 'pourcent',
      severity: 'info',
    });
  }

  // ─ Pertes sur ruptures ─
  const top = facts.stockoutLosses.products[0];
  if (top && facts.stockoutLosses.totalPerDayCents > 0) {
    out.push({
      key: 'stockout_losses',
      title: 'Manque à gagner sur ruptures',
      detail: `${facts.stockoutLosses.products.length} produit(s) actuellement coupés, dont « ${top.name} », représentaient ${eurosLabel(facts.stockoutLosses.totalPerDayCents)} de ventes par jour de service.`,
      value: facts.stockoutLosses.totalPerDayCents,
      unit: 'centimes',
      severity: 'urgent',
    });
  }

  return out;
}

// ─── Index du contexte supply ───

/** Coût matière connu, par restaurant → produit → variante. */
export type CostIndex = Map<string, Map<string, Map<string, number>>>;
/** Coût d'un choix d'option, par restaurant → « produit|groupe|choix ». */
export type OptionIndex = Map<string, Map<string, number>>;

/**
 * Les trois index tirés des recettes, rendus ENSEMBLE et jamais stockés sur le
 * service.
 *
 * Un service Nest est un singleton : mémoriser un index sur `this` ferait que
 * deux requêtes simultanées sur deux restaurants différents se marcheraient
 * dessus — et le coût matière de l'un s'afficherait sur la fiche de l'autre.
 * Tout ce qui est calculé ici traverse la pile en paramètre.
 */
export type SupplyIndex = {
  costs: CostIndex;
  options: OptionIndex;
  /** Produits coupés par la rupture d'un de leurs ingrédients. */
  cutByIngredient: Map<string, Set<string>>;
  /** `false` si PostgreSQL est injoignable — aucun conseil chiffré alors. */
  available: boolean;
};

// ─── Lignes d'agrégat ───

/** Une ligne de vente agrégée : restaurant × produit × variante × demi-fenêtre. */
type SalesRow = {
  _id: {
    tenantId: unknown;
    productId: unknown;
    variantKey: string | null;
    /** `true` = quinzaine la plus récente. */
    recent: boolean;
  };
  name: string;
  qty: number;
  revenueCents: number;
};

/** Un choix d'option réellement retenu par les clients — il coûte, il compte. */
type OptionRow = {
  _id: {
    tenantId: unknown;
    productId: unknown;
    groupKey: string;
    choiceKey: string;
    recent: boolean;
  };
  qty: number;
};

type ServiceShapeRow = {
  hours: { _id: number; orders: number }[];
  days: { n: number }[];
};

const variantOf = (key: string | null | undefined) => key ?? 'base';
const optionKey = (productRef: string, groupKey: string, choiceKey: string) =>
  `${productRef}|${groupKey}|${choiceKey}`;

/** Coût d'une variante, avec repli sur la recette de base — règle de `SupplyService.bom`. */
function unitCost(
  costs: CostIndex,
  tenantId: string,
  productId: string,
  variantKey: string | null,
): number | undefined {
  const variants = costs.get(tenantId)?.get(productId);
  if (!variants) return undefined;
  return variants.get(variantOf(variantKey)) ?? variants.get('base');
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @Inject(SUPPLY_DB) private readonly db: SupplyDb,
    private readonly admin: AdminService,
  ) {}

  /**
   * LE CONSEIL CHIFFRÉ pour un restaurant.
   *
   * La consultation est journalisée : c'est le dossier d'un client qu'on
   * ouvre, au même titre que sa fiche compte ou sa fiche de santé.
   */
  async tenantInsights(
    actor: JwtPayload,
    tenantId: string,
    now: Date = new Date(),
  ): Promise<CrmTenantInsights> {
    const tenant = await this.requireTenant(tenantId);
    const id = String(tenant._id);
    await this.admin.recordDetailView(actor, id);

    const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    // Milieu de fenêtre : la quinzaine récente contre la quinzaine précédente.
    // Deux moitiés strictement égales, sinon la « chute de marge » mesurerait
    // la longueur des périodes autant que la marge.
    const mid = new Date(now.getTime() - (WINDOW_DAYS / 2) * DAY_MS);

    const supply = await this.supplyIndex();
    const [sales, options, shape, manualCuts] = await Promise.all([
      this.salesRows(since, mid),
      this.optionRows(since, mid),
      this.serviceShape(id, since, now),
      this.manuallyCutProducts(id),
    ]);

    const foodCost = benchmarkFoodCost(id, sales, options, supply);
    const margins = productMargins(id, sales, options, supply);
    const serviceDays = shape.days[0]?.n ?? 0;

    const lowMarginProducts = margins
      .filter((p) => p.marginPct < LOW_MARGIN_PCT)
      .sort((a, b) => a.marginPct - b.marginPct)
      .slice(0, 5);

    const fallingMarginProducts = margins
      .filter((p) => (p.marginDropPoints ?? 0) >= MARGIN_DROP_POINTS)
      .sort((a, b) => (b.marginDropPoints ?? 0) - (a.marginDropPoints ?? 0))
      .slice(0, 5);

    const facts = {
      foodCost,
      quietSlots: findQuietSlots(
        new Map(shape.hours.map((h) => [h._id, h.orders])),
        shape.hours.reduce((sum, h) => sum + h.orders, 0),
      ),
      lowMarginProducts,
      fallingMarginProducts,
      stockoutLosses: buildStockoutLosses(
        mergeCuts(manualCuts, supply.cutByIngredient.get(id)),
        margins,
        serviceDays,
      ),
    };

    return {
      tenantId: id,
      name: String(tenant.name ?? ''),
      windowDays: WINDOW_DAYS,
      serviceDays,
      ...facts,
      recommendations: buildRecommendations(facts),
      computedAt: now.toISOString(),
    };
  }

  // ─── Lectures MongoDB ───

  /**
   * Ventes agrégées par restaurant × produit × variante × demi-fenêtre.
   *
   * TRANS-TENANT à dessein : la médiane du réseau se calcule sur les mêmes
   * lignes que le ratio du client, avec la même formule. Deux passes séparées
   * finiraient par diverger — et l'écart affiché mesurerait alors la
   * différence entre deux requêtes, pas entre deux restaurants.
   *
   * Le volume est borné par (restaurants × produits × variantes × 2). À
   * l'échelle d'un parc de fast-foods indépendants, cela tient largement en
   * mémoire ; le jour où le parc se compte en centaines, c'est cette agrégation
   * qu'il faudra pré-calculer, pas la logique qui l'utilise.
   *
   * Aucun champ de commande autre que les lignes et la date n'est projeté : ni
   * nom, ni téléphone, ni jeton de suivi ne quitte MongoDB.
   */
  private salesRows(since: Date, mid: Date): Promise<SalesRow[]> {
    const pipeline: PipelineStage[] = [
      { $match: { status: { $in: REVENUE_STATUSES }, createdAt: { $gte: since } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: {
            tenantId: '$tenantId',
            productId: '$lines.productId',
            variantKey: '$lines.variantKey',
            recent: { $gte: ['$createdAt', mid] },
          },
          name: { $first: '$lines.name' },
          qty: { $sum: '$lines.qty' },
          revenueCents: { $sum: '$lines.lineTotal' },
        },
      },
    ];
    return this.orders.aggregate<SalesRow>(pipeline);
  }

  /** Choix d'options réellement retenus : ils consomment des ingrédients. */
  private optionRows(since: Date, mid: Date): Promise<OptionRow[]> {
    const pipeline: PipelineStage[] = [
      { $match: { status: { $in: REVENUE_STATUSES }, createdAt: { $gte: since } } },
      { $unwind: '$lines' },
      { $unwind: '$lines.options' },
      {
        $group: {
          _id: {
            tenantId: '$tenantId',
            productId: '$lines.productId',
            groupKey: '$lines.options.groupKey',
            choiceKey: '$lines.options.choiceKey',
            recent: { $gte: ['$createdAt', mid] },
          },
          qty: { $sum: '$lines.qty' },
        },
      },
    ];
    return this.orders.aggregate<OptionRow>(pipeline);
  }

  /**
   * Forme du service : commandes par heure (Paris) et nombre de jours
   * réellement servis. Les deux sortent de la MÊME passe — c'est le même
   * balayage de commandes, et deux requêtes donneraient deux photos décalées.
   *
   * L'heure est calculée par MongoDB avec le fuseau `Europe/Paris` : un
   * décalage d'heure d'été suffirait à déplacer un creux d'un cran et à envoyer
   * l'équipe conseiller un créneau qui n'existe pas.
   */
  private async serviceShape(tenantId: string, since: Date, now: Date): Promise<ServiceShapeRow> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          tenantId: toObjectId(tenantId),
          status: { $ne: 'cancelled' },
          createdAt: { $gte: since, $lte: now },
        },
      },
      {
        $project: {
          hour: { $hour: { date: '$createdAt', timezone: TZ } },
          day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: TZ } },
        },
      },
      {
        $facet: {
          hours: [{ $group: { _id: '$hour', orders: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          days: [{ $group: { _id: '$day' } }, { $count: 'n' }],
        },
      },
    ];
    const rows = await this.orders.aggregate<ServiceShapeRow>(pipeline);
    return rows[0] ?? { hours: [], days: [] };
  }

  /** Produits coupés à la main depuis le comptoir. */
  private async manuallyCutProducts(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.products
      .find({ tenantId: toObjectId(tenantId), outOfStock: true, active: true }, { name: 1 })
      .lean();
    return new Map(rows.map((p) => [String(p._id), String(p.name ?? '')]));
  }

  // ─── Lectures PostgreSQL (contexte supply) ───

  /**
   * Index des coûts matière, reconstruit à chaque appel et rendu au demandeur.
   *
   * Même formule que `SupplyService.bom` : le coût d'une ligne de recette est
   * `lineCostCents(qty, unité, coût unitaire de l'ingrédient)`, et le coût
   * d'une variante est la somme de ses lignes. Le calcul n'est pas ré-inventé,
   * il est ré-appliqué — le jour où la conversion d'unités change, elle change
   * pour les deux.
   *
   * Les produits coupés par un ingrédient en rupture sortent de la même passe :
   * ils se lisent sur les recettes, pas sur le drapeau `outOfStock` du produit,
   * de sorte que la fiche reste juste même si une cascade n'a pas été rejouée.
   */
  private async supplyIndex(): Promise<SupplyIndex> {
    const costs: CostIndex = new Map();
    const options: OptionIndex = new Map();
    const cutByIngredient = new Map<string, Set<string>>();

    try {
      const [recipes, optionLines] = await Promise.all([
        this.db.query.recipes.findMany({ with: { lines: { with: { ingredient: true } } } }),
        this.db.query.optionIngredients.findMany({ with: { ingredient: true } }),
      ]);

      for (const recipe of recipes) {
        let cost = 0;
        let cut = false;
        for (const line of recipe.lines) {
          cost += lineCostCents(Number(line.qty), line.unit, line.ingredient.costPerUnitCents);
          if (line.ingredient.isOut) cut = true;
        }
        const byProduct = costs.get(recipe.tenantRef) ?? new Map<string, Map<string, number>>();
        const byVariant = byProduct.get(recipe.productRef) ?? new Map<string, number>();
        byVariant.set(variantOf(recipe.variantKey), cost);
        byProduct.set(recipe.productRef, byVariant);
        costs.set(recipe.tenantRef, byProduct);

        if (cut) {
          const set = cutByIngredient.get(recipe.tenantRef) ?? new Set<string>();
          set.add(recipe.productRef);
          cutByIngredient.set(recipe.tenantRef, set);
        }
      }

      for (const option of optionLines) {
        const byKey = options.get(option.tenantRef) ?? new Map<string, number>();
        const key = optionKey(option.productRef, option.groupKey, option.choiceKey);
        const cost = lineCostCents(
          Number(option.qty),
          option.unit,
          option.ingredient.costPerUnitCents,
        );
        // Un choix peut consommer plusieurs ingrédients : on cumule.
        byKey.set(key, (byKey.get(key) ?? 0) + cost);
        options.set(option.tenantRef, byKey);
      }
      return { costs, options, cutByIngredient, available: true };
    } catch (error) {
      // Sans coût matière il n'y a pas de conseil chiffré — et c'est très bien
      // ainsi : la réponse sort vide plutôt que fausse.
      this.logger.warn(
        `Coût matière indisponible (contexte supply) — conseils servis sans food cost : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { costs, options, cutByIngredient, available: false };
    }
  }

  private async requireTenant(tenantId: string): Promise<Tenant & { _id: unknown }> {
    // Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou,
    // Mongoose lève une CastError et l'équipe reçoit un 500 au lieu d'un 404.
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const raw = await this.tenants.findById(new Types.ObjectId(tenantId), { name: 1 }).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as Tenant & { _id: unknown };
  }
}

// ─── Calculs (purs, hors du service pour être testables sans base) ───

/**
 * FOOD COST DU RESTAURANT COMPARÉ À LA MÉDIANE DU RÉSEAU.
 *
 * Le ratio porte sur les seules lignes dont la recette est connue : le coût
 * matière et le chiffre d'affaires couvrent alors exactement le même périmètre.
 * Additionner au dénominateur le CA d'un produit sans recette ferait
 * mécaniquement baisser le coût matière de tous les restaurants dont la carte
 * est mal saisie — et ce sont précisément ceux-là qu'on afficherait en tête du
 * classement.
 *
 * `coveragePct` dit quelle part du CA est couverte ; en dessous de
 * `MIN_COST_COVERAGE_PCT`, le restaurant sort du panel ET son propre ratio
 * n'est pas publié.
 *
 * Le restaurant fait partie de la médiane, comme dans toute médiane de marché.
 * Ce qu'on n'expose jamais, c'est un chiffre individuel d'un autre restaurant.
 */
export function benchmarkFoodCost(
  tenantId: string,
  sales: readonly SalesRow[],
  options: readonly OptionRow[],
  supply: SupplyIndex,
): CrmFoodCostBenchmark {
  type Totals = { cost: number; revenue: number; revenueAll: number };
  const byTenant = new Map<string, Totals>();
  const totals = (id: string): Totals => {
    const found = byTenant.get(id) ?? { cost: 0, revenue: 0, revenueAll: 0 };
    byTenant.set(id, found);
    return found;
  };

  for (const row of sales) {
    const id = String(row._id.tenantId);
    const t = totals(id);
    t.revenueAll += row.revenueCents;
    const unit = unitCost(supply.costs, id, String(row._id.productId), row._id.variantKey);
    if (unit === undefined) continue;
    t.cost += unit * row.qty;
    t.revenue += row.revenueCents;
  }

  for (const row of options) {
    const id = String(row._id.tenantId);
    const cost = supply.options
      .get(id)
      ?.get(optionKey(String(row._id.productId), row._id.groupKey, row._id.choiceKey));
    if (cost === undefined) continue;
    totals(id).cost += cost * row.qty;
  }

  const ratios: number[] = [];
  for (const [, t] of byTenant) {
    if (t.revenue <= 0 || t.revenueAll <= 0) continue;
    if ((t.revenue / t.revenueAll) * 100 < MIN_COST_COVERAGE_PCT) continue;
    ratios.push((t.cost / t.revenue) * 100);
  }

  const own = byTenant.get(tenantId) ?? { cost: 0, revenue: 0, revenueAll: 0 };
  const coveragePct = own.revenueAll > 0 ? pct1((own.revenue / own.revenueAll) * 100) : 0;
  const available = own.revenue > 0 && coveragePct >= MIN_COST_COVERAGE_PCT;
  const tenantPct = available ? pct1((own.cost / own.revenue) * 100) : null;
  const networkMedianPct = ratios.length >= MIN_NETWORK_PANEL ? median(ratios) : null;

  return {
    available,
    tenantPct,
    networkMedianPct,
    panel: ratios.length,
    deltaPoints:
      tenantPct !== null && networkMedianPct !== null ? pct1(tenantPct - networkMedianPct) : null,
    costCents: Math.round(own.cost),
    revenueCents: own.revenue,
    coveragePct,
  };
}

/**
 * MARGE PAR PRODUIT, et sa dérive entre les deux quinzaines.
 *
 * « En chute » ne se déduit pas d'un historique de coûts : le coût matière est
 * un instantané, il n'est pas versionné. Ce qui bouge réellement d'une
 * quinzaine à l'autre, c'est le PRIX ENCAISSÉ — remises accordées, bascule du
 * mix vers les variantes les moins chères, suppléments offerts. C'est donc la
 * marge RÉALISÉE qu'on compare, sur deux périodes de même durée et au-dessus
 * d'un volume plancher.
 */
export function productMargins(
  tenantId: string,
  sales: readonly SalesRow[],
  options: readonly OptionRow[],
  supply: SupplyIndex,
): CrmProductMargin[] {
  type Half = { qty: number; revenue: number; cost: number };
  type Acc = { name: string; recent: Half; older: Half };
  const empty = (): Half => ({ qty: 0, revenue: 0, cost: 0 });
  const byProduct = new Map<string, Acc>();

  for (const row of sales) {
    if (String(row._id.tenantId) !== tenantId) continue;
    const productId = String(row._id.productId);
    const unit = unitCost(supply.costs, tenantId, productId, row._id.variantKey);
    // Produit sans recette : aucune marge calculable. On ne le note pas « 100 %
    // de marge », on ne le note pas du tout.
    if (unit === undefined) continue;

    const acc = byProduct.get(productId) ?? { name: row.name, recent: empty(), older: empty() };
    const half = row._id.recent ? acc.recent : acc.older;
    half.qty += row.qty;
    half.revenue += row.revenueCents;
    half.cost += unit * row.qty;
    byProduct.set(productId, acc);
  }

  const tenantOptions = supply.options.get(tenantId);
  for (const row of options) {
    if (String(row._id.tenantId) !== tenantId) continue;
    const productId = String(row._id.productId);
    const acc = byProduct.get(productId);
    const cost = tenantOptions?.get(optionKey(productId, row._id.groupKey, row._id.choiceKey));
    if (!acc || cost === undefined) continue;
    const half = row._id.recent ? acc.recent : acc.older;
    half.cost += cost * row.qty;
  }

  const out: CrmProductMargin[] = [];
  for (const [productId, acc] of byProduct) {
    const qty = acc.recent.qty + acc.older.qty;
    const revenue = acc.recent.revenue + acc.older.revenue;
    const cost = acc.recent.cost + acc.older.cost;
    const overall = marginPct(revenue, cost);
    if (overall === null) continue;

    // La dérive n'est calculée que si LES DEUX quinzaines pèsent assez : une
    // marge « en chute » mesurée sur trois ventes n'est pas une chute.
    const enough = acc.recent.qty >= MARGIN_MIN_QTY && acc.older.qty >= MARGIN_MIN_QTY;
    const recentPct = enough ? marginPct(acc.recent.revenue, acc.recent.cost) : null;
    const olderPct = enough ? marginPct(acc.older.revenue, acc.older.cost) : null;

    out.push({
      productId,
      name: acc.name,
      qty,
      revenueCents: revenue,
      costCents: Math.round(cost),
      marginPct: overall,
      recentMarginPct: recentPct,
      previousMarginPct: olderPct,
      marginDropPoints:
        recentPct !== null && olderPct !== null ? pct1(olderPct - recentPct) : null,
    });
  }
  return out;
}

/**
 * Réunit les deux causes de coupure. La coupure manuelle l'emporte sur la
 * cascade : c'est celle qu'un humain a décidée, et c'est celle qu'il faut lui
 * rappeler s'il a oublié de rouvrir le produit.
 */
export function mergeCuts(
  manual: ReadonlyMap<string, string>,
  byIngredient: ReadonlySet<string> | undefined,
): Map<string, { name: string; cause: 'ingredient' | 'manuel' }> {
  const out = new Map<string, { name: string; cause: 'ingredient' | 'manuel' }>();
  for (const [productId, name] of manual) out.set(productId, { name, cause: 'manuel' });
  for (const productId of byIngredient ?? []) {
    // Le nom vit dans Mongo ; ici on n'a que la référence. Il est complété à
    // l'assemblage, depuis le libellé dénormalisé des lignes de commande.
    if (!out.has(productId)) out.set(productId, { name: '', cause: 'ingredient' });
  }
  return out;
}

/** Un `:id` mal formé vaut un 404, jamais une CastError en 500. */
function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Établissement introuvable');
  return new Types.ObjectId(id);
}
