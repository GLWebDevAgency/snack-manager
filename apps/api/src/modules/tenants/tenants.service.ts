import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  aLaCapacite,
  brandColorDe,
  capacitesEffectives,
  DEFAULT_TENANT_ACCOUNT_STATUS,
  logoUrlDe,
  publicOrderingState,
  textePosableSur,
  type Brand,
  type Capacite,
  type JwtPayload,
  type TenantAccountStatus,
  type TenantHoursUpdate,
  type TenantIdentityUpdate,
  type TenantSettingsUpdate,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { AuditService } from '../audit/audit.module';
import { marqueObservee } from '../../common/marque-observee';
import { horairesPublics } from './horaires-publics';
import { masqueAEnregistrer } from './marque';
import { OriginesImages } from './origines-images';
import { TenantCapacitySettingsStore, touchesCalendarSettings } from './tenant-capacity-settings.store';

/**
 * Ce que `GET /tenants/me` a le droit de rendre — et, depuis, ce que rendent
 * AUSSI les quatre routes qui écrivent (`vueMe` ci-dessous).
 *
 * EXPORTÉE pour être testable : cette liste décide de ce qu'une tablette de
 * comptoir peut lire sur son propre restaurant, et un champ de trop y est une
 * fuite silencieuse.
 */
export const TENANT_ME_FIELDS = {
  slug: 1,
  name: 1,
  logoUrl: 1,
  brandColor: 1,
  brand: 1,
  address: 1,
  phones: 1,
  hours: 1,
  closures: 1,
  settings: 1,
  /*
   * CE QUE LA BARRE DE NAVIGATION DOIT SAVOIR — l'étendue du service, rien d'autre.
   *
   * Le back-office affichait la même barre à tout le monde faute d'avoir la
   * donnée : une session de comptoir voyait « Encaissement en ligne » et
   * récoltait un 403, un restaurant sans le module de commande en ligne voyait
   * les écrans qui en dépendent, et un compte suspendu n'était signalé nulle
   * part alors qu'un seul écran lui reste ouvert.
   *
   * Ces champs-là sont anodins pour une tablette de comptoir parce qu'ils ne
   * disent que l'ÉTENDUE du service — ce que le restaurant a le droit
   * d'utiliser, ce que ses écrans doivent donc montrer. Un équipier le déduit
   * déjà de ce qu'il a sous les doigts. Aucun ne dit combien on facture, à
   * qui, ni pourquoi.
   *
   * Leurs voisins immédiats, eux, le disent — et c'est précisément pour eux
   * que cette liste est BLANCHE :
   *  · `founderUntil` / `founderDiscountCents` : la remise négociée ;
   *  · `billingCycle` : l'engagement signé ;
   *  · `billing.*` : raison sociale, SIRET, TVA, adresse de facturation ;
   *  · `stripe` / `encaissement` : nos identifiants de paiement ;
   *  · `account.reason`, `account.churnCause`, `account.suspendedAt`,
   *    `account.trialEndsAt` : le MOTIF et le calendrier d'un litige
   *    commercial. « Impayé de juillet » n'a rien à faire sur l'écran d'un
   *    équipier de cuisine — c'est un des champs qui fuyaient.
   *
   * D'où le chemin POINTÉ `account.status` plutôt que `account` : ouvrir le
   * sous-document entier pour son seul statut rouvrirait la fuite qu'on vient
   * de fermer, et la rouvrirait DE NOUVEAU, en silence, à chaque champ ajouté
   * demain à `account`.
   */
  /** La formule souscrite — `null` pour un client qui n'achète que des services. */
  plan: 1,
  /** Le module de commande en ligne : une SOUSCRIPTION, pas la pause du soir. */
  onlineOrdering: 1,
  onlineDelivery: 1,
  standaloneLoyalty: 1,
  websiteUrl: 1,
  /**
   * Les exceptions accordées ou retirées hors formule.
   *
   * Elles ne SORTENT PAS telles quelles — `derivesDuMasque` les consomme pour
   * calculer `capacites` et les efface de la réponse. Elles portent un motif et
   * un auteur, c'est-à-dire une conversation commerciale (« geste de reprise »,
   * « retiré le temps du litige ») : rien qui ait sa place sur la tablette du
   * comptoir. Elles sont projetées ici parce que le CALCUL en a besoin, pas
   * parce que le front doit les lire.
   */
  derogationsCapacite: 1,
  /** L'état du compte, et lui seul (cf. `derivesDuMasque` pour sa forme). */
  'account.status': 1,
} as const;

/**
 * Les champs plats, RECALCULÉS depuis le masque à la lecture (spec §8.3).
 *
 * `logoUrl` et `brandColor` restent dans tous les contrats — c'est le contrat
 * « logo + accent » des outils du personnel — mais ils ne sont plus une
 * source : ils dérivent de `brand`, comme partout ailleurs (`publicBySlug`,
 * `toIdentity`, le tableau de menu). Les rendre tels qu'ils dorment en base
 * faisait mentir la lecture dès la première reprise : le masque disait safran,
 * la colonne disait laiton, et l'admin peignait le laiton.
 *
 * `account` est RÉDUIT ici au seul statut, pour deux raisons qui tiennent
 * ensemble. D'abord la forme : un tenant créé avant le champ n'a pas d'`account`
 * en base, et Mongoose matérialise alors le sous-document de défaut EN ENTIER
 * — `since`, `reason`, `suspendedAt` reparaissent, vides, chez ces tenants-là
 * seulement. Rien de secret n'y transite (il n'y a rien à transiter), mais la
 * réponse changerait de forme d'un restaurant à l'autre, et le front devrait
 * deviner laquelle il lit. Ensuite la garde : la projection promet un seul
 * champ, cette réduction le tient quoi qu'il arrive en amont. Le statut absent
 * retombe sur `DEFAULT_TENANT_ACCOUNT_STATUS` — `trial`, le plus permissif :
 * un champ jamais écrit ne doit pas fermer un restaurant en plein service.
 *
 * C'est le statut STOCKÉ, et non `statutEffectif` (@sm/contracts) : celui-là
 * exige `account.trialEndsAt`, que la liste blanche ci-dessus tient
 * délibérément hors de cette réponse — c'est le calendrier d'un litige
 * commercial, il n'a rien à faire sur la tablette du comptoir. La perte est
 * nulle : le seul lecteur de ce champ côté restaurateur est `isAccessBlocked`,
 * qui répond faux à `trial` comme à `active`. Ce que le gérant lit de sa
 * facturation vient, lui, de `GET /me/billing`, qui dérive bien l'effectif.
 *
 * `capacites` est CALCULÉ ici, et c'est le seul endroit du produit où la
 * question « qu'a payé ce restaurant ? » se pose pour le front. Le navigateur
 * reçoit la LISTE de ce qu'il peut ouvrir — jamais la formule, jamais le
 * catalogue, jamais les dérogations. Trois raisons, et la dernière suffirait :
 *
 *  · un front qui rejouerait le catalogue en aurait sa propre copie, et les
 *    deux divergeraient au premier changement d'offre — la moitié des écrans
 *    verrouillés d'un côté, ouverts de l'autre, sans qu'aucun test ne rougisse ;
 *  · la formule est une donnée COMMERCIALE. Une tablette de comptoir n'a pas
 *    à savoir combien son patron paie, et c'est déjà la règle de cette
 *    projection (`billing`, `founderUntil`, `account.reason` en sont exclus) ;
 *  · les dérogations portent un motif écrit par l'équipe SM — une phrase de
 *    négociation, jamais destinée à l'écran d'un équipier.
 *
 * `plan` et `onlineOrdering` restent rendus tels quels : ils l'étaient déjà, la
 * facturation vue par le gérant s'en sert, et les retirer casserait l'écran
 * d'abonnement sans rien gagner — ce sont des faits de son propre contrat,
 * qu'il lit chez nous comme sur sa facture. Ce que la règle d'or interdit,
 * c'est d'en DÉDUIRE un droit ; c'est ce que `capacites` rend inutile.
 *
 * EXPORTÉE pour être testable : c'est la forme que voient `GET /tenants/me` ET
 * `PATCH /tenants/me/marque`, et les deux doivent rester la même.
 */
export function derivesDuMasque(
  doc: unknown,
): Record<string, unknown> & {
  brand: Brand;
  logoUrl: string | null;
  brandColor: string;
  account: { status: TenantAccountStatus };
  capacites: readonly Capacite[];
} {
  // Même ramener-à-l'objet-nu que `lireMarque` : un sous-document HYDRATÉ
  // porte des clés de prototype qu'un `...` recopierait.
  const brut = doc as { toObject?: () => unknown } | null | undefined;
  const nu = (brut && typeof brut.toObject === 'function' ? brut.toObject() : brut) as Record<
    string,
    unknown
  >;
  const brand = marqueObservee(nu);
  const compte = nu.account as { status?: TenantAccountStatus } | null | undefined;
  const capacites = capacitesEffectives(nu);
  // Les dérogations sont RETIRÉES de la réponse après avoir servi au calcul :
  // elles n'ont pas été projetées pour être lues, mais pour être consommées.
  const { derogationsCapacite: _derogations, ...visible } = nu;
  return {
    ...visible,
    brand,
    logoUrl: logoUrlDe(brand),
    brandColor: brandColorDe(brand),
    account: { status: compte?.status ?? DEFAULT_TENANT_ACCOUNT_STATUS },
    capacites,
  };
}

/**
 * Le fragment `$set` d'un changement d'accent depuis `/admin/settings`.
 *
 * Écrire `brandColor` seul suffisait tant que `brand` valait `null` — le repli
 * le relisait. Une fois `backfill:brand` passé, c'est `brand.palette.accent`
 * qui est rendu : le gérant changeait sa couleur, l'API répondait 200, et la
 * page revenait à l'ancienne. Les deux s'écrivent donc ensemble.
 *
 * `onAccent` est recalculé dans la foulée : garder l'ancien ferait du texte
 * blanc sur un jaune neuf. `textePosableSur` tranche par contraste réel — la
 * même fonction que le résolveur, jamais un second seuil de luminance.
 */
export function identiteAvecAccent(
  brand: unknown,
  brandColor: string,
): Record<string, unknown> {
  const $set: Record<string, unknown> = { brandColor };
  if (brand == null) return $set;
  const accent = brandColor.trim().toLowerCase();
  $set['brand.palette.accent'] = accent;
  $set['brand.palette.onAccent'] = textePosableSur(accent);
  return $set;
}

/**
 * Le fragment `$set` d'un dépôt ou d'un retrait de logo depuis le back-office.
 *
 * Le pendant exact de `identiteAvecAccent`, pour la même raison : `logoUrl`
 * est devenu un DÉRIVÉ du masque à la lecture (`logoUrlDe`). Tant que `brand`
 * vaut `null`, écrire la colonne plate suffit. Une fois `backfill:brand`
 * passé, c'est `brand.logo` qui est rendu : le gérant déposait un nouveau
 * logo, l'API répondait 200, et aucune surface ne le montrait. Pire au
 * retrait — l'objet disparaissait de R2 pendant que le masque continuait de
 * pointer dessus, donc une image cassée partout.
 *
 * L'emplacement du masque n'est touché QUE s'il porte encore le logo legacy
 * (vide, ou l'URL qu'on remplace) : une déclinaison posée exprès dans
 * l'éditeur de marque ne doit pas s'effacer parce qu'on a changé le logo du
 * back-office. C'est `avecLogoHerite` qui remplit cet emplacement, et c'est
 * le même qu'on entretient ici.
 */
export function identiteAvecLogo(
  brand: unknown,
  ancienLogoUrl: string | null,
  nouveauLogoUrl: string | null,
): Record<string, unknown> {
  const $set: Record<string, unknown> = { logoUrl: nouveauLogoUrl };
  const marque = brand as { logo?: { mark?: { dark?: string | null } } } | null | undefined;
  if (marque == null) return $set;
  const pose = marque.logo?.mark?.dark ?? null;
  if (pose !== null && pose !== ancienLogoUrl) return $set;
  $set['brand.logo.mark.dark'] = nouveauLogoUrl;
  return $set;
}

/**
 * Les clés de `settings.*` qui partent dans le `$set` — rien de plus.
 *
 * Le corps est VALIDÉ en amont par `TenantSettingsUpdateSchema`
 * (`@Body(zod(...))` sur la route) : le schéma décide des VALEURS, cette liste
 * décide des CHAMPS ÉCRITS. Les deux restent nécessaires, et pour des raisons
 * différentes — sans le schéma, une capacité négative fermait la commande en
 * ligne sans un mot ; sans la liste, n'importe quelle clé du corps atterrirait
 * dans le document.
 *
 * EXPORTÉE pour être testable, et le test `tenants.test.ts` verrouille les
 * deux bouts : une clé validée mais absente d'ici serait acceptée puis jetée
 * en silence, et une clé d'ici absente du schéma MONGOOSE subirait le même
 * sort en base. C'est exactement ce qui est arrivé à `dailyGoalCents`, resté
 * six semaines dans cette liste sans exister en base : la route répondait 200,
 * le gérant croyait avoir enregistré, et rien ne persistait.
 */
export const REGLAGES_MODIFIABLES = [
  'slotIntervalMin',
  'slotCapacity',
  'onlineOrderingPaused',
  'pauseMessage',
  'printTicketOn',
  'printStickerOn',
  'dailyGoalCents',
] as const;

@Injectable()
export class TenantsService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly origines: OriginesImages,
    private readonly audit: AuditService,
  ) {}

  /** L'établissement de la session (`GET /tenants/me`) — cf. `vueMe`. */
  async byId(tenantId: string) {
    return this.vueMe(tenantId, {});
  }

  /**
   * LA VUE DE LA SESSION — une seule forme, en lecture comme en écriture.
   *
   * Cette route sert TOUT l'équipage, y compris une session ouverte au code
   * sur la tablette du comptoir. Elle rendait le tenant complet : un équipier
   * de cuisine lisait le SIRET, le numéro de TVA, l'identité de facturation,
   * l'identifiant du compte Stripe du restaurant, le motif de sa suspension,
   * et jusqu'au montant de sa remise fondateur.
   *
   * La lecture a été projetée la première, puis `updateMarque` ; les TROIS
   * autres écritures, non — `findByIdAndUpdate(…, { new: true })` sans
   * projection. Changer un horaire, un téléphone ou l'objectif du jour rendait
   * donc exactement ce qu'on venait de fermer en lecture. Une projection posée
   * sur la seule lecture ne protège rien : c'est la RÉPONSE qui fuit, pas la
   * route. Les cinq chemins passent donc par ici.
   *
   * Deux gestes, et les deux comptent :
   *  - la projection `TENANT_ME_FIELDS`, écrite en liste BLANCHE et non en
   *    retrait des champs sensibles — un champ ajouté demain au schéma ne
   *    partira pas sur une tablette parce que personne n'aura pensé à
   *    l'exclure ;
   *  - `derivesDuMasque`, pour que `logoUrl` et `brandColor` soient DÉRIVÉS du
   *    masque des deux côtés. Sans lui, l'éditeur enregistrait un accent et
   *    relisait l'ancien dans la réponse de son propre enregistrement.
   *
   * Le `$set` vide n'est pas une écriture : un PATCH sans rien de reconnu se
   * contente de relire — ce que faisait déjà l'ancien code, mais projeté.
   */
  private async vueMe(tenantId: string, $set: Record<string, unknown>) {
    const doc =
      Object.keys($set).length === 0
        ? await this.tenants.findById(tenantId, TENANT_ME_FIELDS)
        : touchesCalendarSettings($set)
          ? await new TenantCapacitySettingsStore(this.tenants).update(tenantId, $set, TENANT_ME_FIELDS)
        : await this.tenants.findByIdAndUpdate(
            tenantId,
            { $set },
            {
              new: true,
              projection: TENANT_ME_FIELDS,
              /*
               * LES GARDES DU SCHÉMA NE S'EXÉCUTENT PAS TOUTES SEULES.
               *
               * Mongoose n'applique NI `required` NI `enum` sur une requête de
               * mise à jour, seulement sur `save()`. Les enums de `BrandSub`
               * (mode, shape, motion, type.pair, preset) — écrits ici par
               * `updateMarque` et `updateIdentity` — ne se déclenchaient donc
               * jamais : la base laissait passer ce que Zod n'avait pas vu, et
               * le schéma faisait croire le contraire à quiconque le lisait.
               * `context: 'query'` donne aux validateurs le `this` de la
               * requête, seule forme correcte hors document hydraté.
               */
              runValidators: true,
              context: 'query',
            },
          );
    if (!doc) throw new NotFoundException('Tenant introuvable');
    return derivesDuMasque(doc);
  }

  async bySlug(slug: string) {
    const t = await this.tenants.findOne({ slug });
    if (!t) throw new NotFoundException('Établissement introuvable');
    return t;
  }

  /** Vue publique (page de commande client) — pas de données internes. */
  async publicBySlug(slug: string) {
    const t = await this.bySlug(slug);
    // Une suspension de compte — ou une commande en ligne non souscrite — se
    // présente au public comme une pause de service : la page reste belle, le
    // contrat commercial reste privé. Une capacité manquante ne casse jamais
    // une vitrine en plein service.
    const gate = publicOrderingState(
      t.account,
      {
        paused: t.settings?.onlineOrderingPaused ?? false,
        message: t.settings?.pauseMessage ?? null,
      },
      aLaCapacite(t, 'online'),
    );
    // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
    const brand = marqueObservee(t);
    return {
      slug: t.slug,
      name: t.name,
      brand,
      logoUrl: logoUrlDe(brand),
      brandColor: brandColorDe(brand),
      address: t.address,
      phones: t.phones,
      // La forme neutre, la même que la vitrine et l'écran de salle : cette
      // route rendait le tableau de sous-documents Mongoose tel quel.
      hours: horairesPublics(t.hours),
      onlineOrderingPaused: gate.paused,
      pauseMessage: gate.message,
      slotIntervalMin: t.settings?.slotIntervalMin ?? 10,
    };
  }

  /**
   * Les réglages du service. Le corps est VALIDÉ en amont
   * (`TenantSettingsUpdateSchema`) : `REGLAGES_MODIFIABLES` ne décide que des
   * champs ÉCRITS, le schéma décide des VALEURS.
   */
  async updateSettings(tenantId: string, patch: TenantSettingsUpdate, actor?: JwtPayload) {
    const $set: Record<string, unknown> = {};
    for (const k of REGLAGES_MODIFIABLES) {
      if (k in patch) $set[`settings.${k}`] = (patch as Record<string, unknown>)[k];
    }
    const vue = await this.vueMe(tenantId, $set);
    // JOURNALISÉ parce que ces réglages décident si le restaurant PREND des
    // commandes : `onlineOrderingPaused` ferme la vente en ligne, la capacité
    // et l'intervalle de créneau décident combien de clients peuvent
    // commander. Un PATCH qui n'a rien reconnu ne relit que la fiche — pas
    // d'écriture, donc pas de ligne.
    if (Object.keys($set).length > 0) {
      await this.audit.log({
        tenantId,
        actor,
        action: 'tenant.settings',
        // Les CLÉS touchées, pas seulement le résultat : « la pause a été
        // levée à 11h58 » ne se relit pas dans un état final.
        meta: { reglages: Object.keys(patch), ...patch },
      });
    }
    return vue;
  }

  /**
   * Identité de l'enseigne — champs RACINE du tenant, par opposition aux
   * réglages (`settings.*`). Seules les clés présentes s'écrivent : un PATCH
   * qui corrige l'adresse ne doit pas pouvoir vider les téléphones.
   */
  async updateIdentity(tenantId: string, patch: TenantIdentityUpdate, actor?: JwtPayload) {
    const $set: Record<string, unknown> = {};
    if (patch.name !== undefined) $set.name = patch.name;
    if (patch.address !== undefined) $set.address = patch.address;
    if (patch.websiteUrl !== undefined) $set.websiteUrl = patch.websiteUrl;
    if (patch.phones !== undefined) $set.phones = patch.phones;
    if (patch.brandColor !== undefined) {
      /*
       * LE SÉLECTEUR DE COULEUR DOIT SURVIVRE À LA REPRISE.
       *
       * `brandColor` est devenu un DÉRIVÉ du masque à la lecture
       * (`brandColorDe`). Tant que `brand` est null, l'écrire seul suffit —
       * le repli le relit. Mais dès que `backfill:brand` a posé un masque,
       * c'est `brand.palette.accent` qui est rendu : le gérant changeait sa
       * couleur dans `/admin/settings`, l'API répondait 200, et la page se
       * rechargeait sur l'ancienne. Le champ plat et le masque s'écrivent
       * donc ensemble, ou le champ plat devient un mensonge.
       */
      const tenant = await this.tenants.findById(tenantId, { brand: 1 });
      Object.assign($set, identiteAvecAccent(tenant?.brand ?? null, patch.brandColor));
    }
    const vue = await this.vueMe(tenantId, $set);
    if (Object.keys($set).length > 0) {
      // Le nom, l'adresse et les téléphones partent sur la vitrine, les
      // tickets et les tablettes : c'est ce que le client voit et compose.
      await this.audit.log({ tenantId, actor, action: 'tenant.identity', meta: { ...patch } });
    }
    return vue;
  }

  /**
   * Le masque d'identité posé par le restaurateur.
   *
   * Le tenant est LU avant d'être écrit : un masque dont les quatre
   * emplacements de logo sont vides hérite du logo legacy — sinon la première
   * pose du masque effacerait le logo affiché depuis toujours, avant même que
   * le restaurateur en pose un nouveau. L'origine des images est exigée AVANT
   * (une adresse arbitraire serait servie à tous ses clients) et le contraste
   * rejoué APRÈS, sur le masque tel qu'il sera vraiment enregistré — les trois
   * gestes sont dans `masqueAEnregistrer`, partagée avec la route du CRM.
   *
   * La réponse passe par `vueMe` comme les trois autres écritures : projetée,
   * et ses champs plats dérivés du masque qu'on vient d'enregistrer.
   */
  async updateMarque(tenantId: string, brand: Brand, actor?: JwtPayload) {
    // Le masque complet distingue la première pose legacy d'un retrait de
    // logo explicite. Il conserve aussi les accroches des anciens éditeurs.
    const tenant = await this.tenants.findById(tenantId, { logoUrl: 1, brand: 1 });
    if (!tenant) throw new NotFoundException('Tenant introuvable');
    const vue = await this.vueMe(tenantId, {
      brand: masqueAEnregistrer(brand, tenant.logoUrl, this.origines.hotes, tenant.brand),
    });
    /*
     * LE MÊME GESTE DES DEUX CÔTÉS DOIT LAISSER LA MÊME TRACE.
     *
     * Le CRM journalisait déjà le masque posé depuis la fiche client
     * (`tenant.brand_change`, journal d'administration) ; la route du
     * restaurateur, qui écrit exactement le même document, n'écrivait rien.
     * Deux registres, un seul geste, une seule moitié tracée : c'est le trou
     * que ce chantier ferme.
     *
     * Le masque ENTIER n'entre pas dans `meta` — c'est une arborescence de
     * palettes, de typographies et de logos, illisible dans un registre. On
     * garde ce qui se relit : l'accent et le mode, qui sont ce qu'un client
     * remarque.
     */
    await this.audit.log({
      tenantId,
      actor,
      action: 'tenant.brand',
      meta: { accent: vue.brand.palette.accent, mode: vue.brand.mode },
    });
    return vue;
  }

  /**
   * Horaires hebdomadaires et fermetures exceptionnelles (vue Horaires).
   *
   * Le corps est VALIDÉ en amont par `TenantHoursUpdateSchema`
   * (`@Body(zod(...))` sur la route) : heure murale, ordre des bornes, jour ISO
   * sans doublon, motif de fermeture borné. Ce qui arrive ici a donc la forme
   * que `SlotsService` et la vitrine savent lire — ces deux tableaux sont
   * PUBLICS une fois écrits.
   *
   * `hours` est remplacé EN ENTIER (l'écran envoie les sept jours) ; `closures`
   * n'est touché que s'il est transmis — enregistrer les horaires ne doit pas
   * effacer les congés d'été.
   */
  async updateHours(tenantId: string, patch: TenantHoursUpdate, actor?: JwtPayload) {
    const $set: Record<string, unknown> = { hours: patch.hours };
    if (patch.closures !== undefined) $set.closures = patch.closures;
    const vue = await this.vueMe(tenantId, $set);
    // Les horaires décident des créneaux de retrait et de l'ouverture de la
    // commande en ligne : un jour fermé par erreur, c'est une journée de
    // chiffre d'affaires perdue et personne pour dire qui l'a fermé.
    await this.audit.log({
      tenantId,
      actor,
      action: 'tenant.hours',
      // Le détail des sept jours ne se relit pas dans un registre ; ce qui se
      // relit, c'est COMBIEN de jours servent et quelles fermetures sont posées.
      meta: {
        joursServis: patch.hours.filter((j) => j.lunch !== null || j.dinner !== null).length,
        fermetures: patch.closures?.length ?? null,
      },
    });
    return vue;
  }
}
