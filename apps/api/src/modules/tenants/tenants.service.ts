import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  brandColorDe,
  logoUrlDe,
  marqueEffective,
  publicOrderingState,
  textePosableSur,
  type Brand,
  type TenantIdentityUpdate,
  type TenantSettingsUpdate,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { horairesPublics } from './horaires-publics';
import { masqueAEnregistrer } from './marque';

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
  plan: 1,
  settings: 1,
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
 * EXPORTÉE pour être testable : c'est la forme que voient `GET /tenants/me` ET
 * `PATCH /tenants/me/marque`, et les deux doivent rester la même.
 */
export function derivesDuMasque(
  doc: unknown,
): Record<string, unknown> & { brand: Brand; logoUrl: string | null; brandColor: string } {
  // Même ramener-à-l'objet-nu que `marqueEffective` : un sous-document
  // HYDRATÉ porte des clés de prototype qu'un `...` recopierait.
  const brut = doc as { toObject?: () => unknown } | null | undefined;
  const nu = (brut && typeof brut.toObject === 'function' ? brut.toObject() : brut) as Record<
    string,
    unknown
  >;
  const brand = marqueEffective(nu);
  return { ...nu, brand, logoUrl: logoUrlDe(brand), brandColor: brandColorDe(brand) };
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
  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

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
    // Une suspension de compte se présente au public comme une pause de
    // service — la page reste belle, le litige commercial reste privé.
    const gate = publicOrderingState(t.account, {
      paused: t.settings?.onlineOrderingPaused ?? false,
      message: t.settings?.pauseMessage ?? null,
    });
    // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
    const brand = marqueEffective(t);
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
  async updateSettings(tenantId: string, patch: TenantSettingsUpdate) {
    const $set: Record<string, unknown> = {};
    for (const k of REGLAGES_MODIFIABLES) {
      if (k in patch) $set[`settings.${k}`] = (patch as Record<string, unknown>)[k];
    }
    return this.vueMe(tenantId, $set);
  }

  /**
   * Identité de l'enseigne — champs RACINE du tenant, par opposition aux
   * réglages (`settings.*`). Seules les clés présentes s'écrivent : un PATCH
   * qui corrige l'adresse ne doit pas pouvoir vider les téléphones.
   */
  async updateIdentity(tenantId: string, patch: TenantIdentityUpdate) {
    const $set: Record<string, unknown> = {};
    if (patch.name !== undefined) $set.name = patch.name;
    if (patch.address !== undefined) $set.address = patch.address;
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
    return this.vueMe(tenantId, $set);
  }

  /**
   * Le masque d'identité posé par le restaurateur.
   *
   * Le tenant est LU avant d'être écrit : un masque dont les quatre
   * emplacements de logo sont vides hérite du logo legacy — sinon la première
   * pose du masque effacerait le logo affiché depuis toujours, avant même que
   * le restaurateur en pose un nouveau. Le contraste est rejoué ENSUITE, sur
   * le masque tel qu'il sera vraiment enregistré (`masqueAEnregistrer`).
   *
   * La réponse passe par `vueMe` comme les trois autres écritures : projetée,
   * et ses champs plats dérivés du masque qu'on vient d'enregistrer.
   */
  async updateMarque(tenantId: string, brand: Brand) {
    // Seul le logo legacy sert ici (l'héritage de `masqueAEnregistrer`) : on
    // ne lit que lui, comme `updateIdentity` ne lit que `brand`. Une lecture
    // non projetée dans un fichier qui érige la projection en doctrine se
    // paierait sur la première fiche client volumineuse.
    const tenant = await this.tenants.findById(tenantId, { logoUrl: 1 });
    if (!tenant) throw new NotFoundException('Tenant introuvable');
    return this.vueMe(tenantId, { brand: masqueAEnregistrer(brand, tenant.logoUrl) });
  }

  /**
   * Horaires hebdomadaires (vue Horaires du back-office).
   *
   * ATTENTION — la route qui appelle cette méthode prend encore un corps NU
   * (`tenants.controller.ts`, `@Body()` sans pipe) : `hours` et `closures`
   * arrivent en `unknown[]`, et ces tableaux repartent vers le PUBLIC
   * (`publicBySlug`, `tenantPublicDe`, `SlotsService`). `runValidators` sur
   * l'écriture est le seul rempart en attendant le schéma Zod
   * (`TenantHoursUpdateSchema`) qui doit rendre le refus en 400 plutôt qu'en
   * erreur d'écriture.
   */
  async updateHours(tenantId: string, hours: unknown[], closures?: unknown[]) {
    const $set: Record<string, unknown> = { hours };
    if (closures) $set.closures = closures;
    return this.vueMe(tenantId, $set);
  }
}
