import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ENCAISSEMENT_ETAT_LABELS,
  EncaissementCompteSchema,
  etatDuCompte,
  peutEncaisserEnLigne,
  raisonIndisponibilite,
  type EncaissementCompte,
  type EncaissementFiche,
  type EncaissementLien,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import {
  STRIPE_CONNECT_CLIENT,
  type StripeCompte,
  type StripeConnectClient,
} from './stripe-connect.client';

/**
 * ENCAISSEMENT MARCHAND — le sous-domaine qui décide OÙ va l'argent.
 *
 * ─── POURQUOI UN MODULE À PART ───
 *
 * Le raccordement d'un compte marchand n'a rien à voir avec le cycle de vie
 * d'une commande : il a son propre vocabulaire (dossier déposé, vérification,
 * restriction), son propre rythme (des jours, pas des minutes) et sa propre
 * source de vérité (Stripe). Le loger dans le module de commande aurait mêlé
 * deux horloges et deux langages ; ici, `ordering` ne lui demande qu'UNE chose,
 * par une interface étroite : `compteActifDe(tenantId)`.
 *
 * ─── LA RÈGLE QUI TIENT TOUT LE FICHIER ───
 *
 * **L'argent ne transite JAMAIS par la plateforme.** Le paiement est créé sur
 * le compte du restaurant (charges directes) ou il n'a pas lieu. Encaisser
 * pour le compte d'autrui est un service de paiement réservé aux
 * établissements agréés : sans compte connecté actif, on dégrade vers le
 * comptoir — on ne se rabat pas sur la clé de la plateforme.
 *
 * D'où `compteActifDe` qui rend `null` plutôt qu'un identifiant de repli :
 * il n'existe aucun repli légal, et un repli silencieux serait un délit
 * silencieux.
 *
 * ─── ET AUCUNE COMMISSION ───
 *
 * Aucune `application_fee` n'est posée nulle part. Techniquement Stripe le
 * permettrait ; commercialement, « zéro commission sur vos ventes » est
 * l'argument qui sépare Snack Manager des caisses qui se paient sur chaque
 * encaissement. Le logiciel se facture au mois.
 */

/** Réglages injectables — l'URL de retour dépend de l'environnement. */
export interface EncaissementConfig {
  /** Page du back-office où Stripe renvoie le restaurateur. */
  retourUrl: string;
}

export const ENCAISSEMENT_CONFIG = Symbol('ENCAISSEMENT_CONFIG');

type RawTenant = Tenant & { _id: unknown };

/** Le compte stocké, relu défensivement : un document ancien ne doit rien ouvrir. */
function lireCompte(raw: RawTenant | null): EncaissementCompte | null {
  const brut = (raw as { encaissement?: unknown } | null)?.encaissement;
  if (!brut || typeof brut !== 'object') return null;
  const source = brut as Record<string, unknown>;
  const parse = EncaissementCompteSchema.safeParse({
    accountId: source.accountId,
    chargesEnabled: source.chargesEnabled,
    payoutsEnabled: source.payoutsEnabled,
    detailsSubmitted: source.detailsSubmitted,
    raccordeLe: iso(source.raccordeLe),
    synchroniseLe: iso(source.synchroniseLe),
  });
  // Un document illisible vaut « pas de compte » : fermé par défaut, jamais
  // ouvert par accident.
  return parse.success ? parse.data : null;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : new Date(0).toISOString();

@Injectable()
export class EncaissementService {
  private readonly logger = new Logger(EncaissementService.name);

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @Inject(STRIPE_CONNECT_CLIENT) private readonly stripe: StripeConnectClient,
    @Inject(ENCAISSEMENT_CONFIG) private readonly config: EncaissementConfig,
  ) {}

  /** La fiche de l'écran « Encaissement en ligne » du back-office restaurateur. */
  async ficheDe(tenantId: string): Promise<EncaissementFiche> {
    const tenant = await this.requireTenant(tenantId);
    const compte = lireCompte(tenant);
    const etat = etatDuCompte(compte);
    const disponible = await this.plateformeDisponible();

    return {
      etat,
      etatLabel: ENCAISSEMENT_ETAT_LABELS[etat],
      // La plateforme muette ferme l'encaissement quoi qu'en dise le compte :
      // sans clé, aucun paiement ne partirait de toute façon.
      peutEncaisser: disponible && peutEncaisserEnLigne(compte),
      raison: raisonIndisponibilite(etat),
      compte,
      disponible,
    };
  }

  /**
   * Le lien d'inscription — créé À CHAQUE clic, jamais mis en cache : les
   * liens Stripe expirent en quelques minutes, et un lien périmé afficherait
   * une page morte au restaurateur qui croirait le service cassé.
   */
  async demarrerRaccordement(tenantId: string): Promise<EncaissementLien> {
    if (!(await this.plateformeDisponible())) {
      throw new ServiceUnavailableException(
        'Le raccordement des comptes n’est pas encore ouvert — vos clients règlent au comptoir en attendant.',
      );
    }

    const tenant = await this.requireTenant(tenantId);
    const existant = lireCompte(tenant);
    const accountId = existant?.accountId ?? (await this.creerCompte(tenant));

    try {
      const lien = await this.stripe.creerLien(accountId, this.config.retourUrl, this.config.retourUrl);
      return { url: lien.url, expireLe: new Date(lien.expires_at * 1000).toISOString() };
    } catch (error) {
      // Compte révoqué, clé invalide, panne : un message lisible plutôt qu'un
      // 500 opaque devant lequel le gérant ne peut rien faire.
      this.logger.warn(`Lien de raccordement impossible (${accountId}) : ${String(error)}`);
      throw new ServiceUnavailableException(
        'Stripe n’a pas pu ouvrir la page d’inscription — réessayez dans un instant.',
      );
    }
  }

  /**
   * Recopie les drapeaux depuis Stripe — appelé par le webhook `account.updated`
   * et au retour du restaurateur sur l'écran.
   *
   * Ne lève JAMAIS sur un compte inconnu : un webhook qui échoue est rejoué
   * pendant trois jours par Stripe, et aucun rejeu ne fera apparaître un
   * restaurant que nous n'avons pas.
   */
  async synchroniser(accountId: string, now: Date = new Date()): Promise<void> {
    const tenant = (await this.tenants
      .findOne({ 'encaissement.accountId': accountId })
      .lean()) as RawTenant | null;
    if (!tenant) {
      this.logger.warn(`Compte ${accountId} inconnu du parc — synchronisation ignorée.`);
      return;
    }

    const existant = lireCompte(tenant);
    const compte = await this.lireChezStripe(accountId);
    if (!compte) {
      // Stripe ne répond pas, ou le restaurateur nous a débranchés : on FERME
      // l'encaissement plutôt que de laisser des drapeaux périmés ouverts.
      await this.fermer(tenant._id, accountId, now, existant?.raccordeLe);
      return;
    }
    await this.ecrireDrapeaux(tenant._id, compte, now, {
      raccordeLe: existant ? new Date(existant.raccordeLe) : now,
    });
  }

  /**
   * L'INTERFACE ÉTROITE consommée par le module de commande : sur quel compte
   * encaisser pour ce restaurant, ou `null` s'il ne peut pas encaisser.
   *
   * `null` ne veut pas dire « encaisse sur la plateforme » — il n'existe
   * aucun repli. L'appelant propose le paiement au comptoir.
   */
  async compteActifDe(tenantId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(tenantId)) return null;
    const tenant = (await this.tenants.findById(tenantId).lean()) as RawTenant | null;
    const compte = lireCompte(tenant);
    return peutEncaisserEnLigne(compte) ? (compte?.accountId ?? null) : null;
  }

  private async creerCompte(tenant: RawTenant): Promise<string> {
    const email = (tenant as { billing?: { email?: string } }).billing?.email ?? null;
    const compte = await this.stripe.creerCompte(email && email.trim() !== '' ? email : null);
    const now = new Date();

    /*
     * ÉCRITURE CONDITIONNELLE À L'ABSENCE, et pas un simple `updateOne`.
     *
     * Le gérant clique, la page rame, il rouvre l'écran sur son téléphone et
     * reclique : deux requêtes lisent toutes deux « pas de compte » et
     * créeraient deux comptes chez Stripe. La seconde écriture écraserait la
     * première, et si le restaurateur termine son inscription par le PREMIER
     * lien, l'événement de Stripe désignerait un compte que nous n'avons plus
     * — son écran resterait « inscription à terminer » pour toujours.
     *
     * Le filtre `encaissement: null` fait donc arbitrer la base : le perdant
     * relit le compte gagnant et poursuit avec lui.
     */
    const ecrit = await this.tenants.updateOne(
      { _id: tenant._id, encaissement: null },
      {
        $set: {
          encaissement: {
            accountId: compte.id,
            chargesEnabled: compte.charges_enabled === true,
            payoutsEnabled: compte.payouts_enabled === true,
            detailsSubmitted: compte.details_submitted === true,
            raccordeLe: now,
            synchroniseLe: now,
          },
        },
      },
    );

    if (ecrit.modifiedCount === 0) {
      // Une requête concurrente a gagné : on reprend SON compte. Le nôtre
      // reste orphelin chez Stripe, sans dossier ni encaissement — inerte.
      const relu = lireCompte(
        (await this.tenants.findById(tenant._id).lean()) as RawTenant | null,
      );
      if (relu) {
        this.logger.warn(
          `Raccordement concurrent : ${compte.id} abandonné au profit de ${relu.accountId}.`,
        );
        return relu.accountId;
      }
    }

    this.logger.log(`Compte d’encaissement ${compte.id} créé pour ${String(tenant._id)}`);
    return compte.id;
  }

  /**
   * Écrit le sous-document ENTIER, jamais par chemins pointés — et ce n'est
   * pas un choix de style.
   *
   * `tenant.encaissement` porte `default: null` : Mongoose matérialise ce
   * défaut à la création, si bien que tout client créé depuis ce champ porte
   * littéralement `encaissement: null` en base. Or MongoDB refuse de créer un
   * champ sous un élément qui n'est pas un document — un
   * `$set: { 'encaissement.accountId': … }` échoue alors en `PathNotViable`,
   * et le raccordement devient impossible pour tout nouveau client. Écrire
   * l'objet complet remplace le `null` au lieu d'essayer de le creuser.
   *
   * `raccordeLe` est préservé quand il existe : c'est la date d'engagement du
   * restaurateur, elle ne doit pas se réécrire à chaque synchronisation.
   */
  private async ecrireDrapeaux(
    tenantId: unknown,
    compte: StripeCompte,
    now: Date,
    options: { raccordeLe?: Date } = {},
  ): Promise<void> {
    await this.tenants.updateOne(
      { _id: tenantId },
      {
        $set: {
          encaissement: {
            accountId: compte.id,
            // `=== true` et non `?? false` : une réponse partielle de Stripe
            // doit FERMER l'encaissement, jamais l'ouvrir par défaut.
            chargesEnabled: compte.charges_enabled === true,
            payoutsEnabled: compte.payouts_enabled === true,
            detailsSubmitted: compte.details_submitted === true,
            raccordeLe: options.raccordeLe ?? now,
            synchroniseLe: now,
          },
        },
      },
    );
  }

  /**
   * LE RESTAURATEUR NOUS A DÉBRANCHÉS — le seul événement que Stripe émette
   * dans ce cas, et après lequel plus aucun `account.updated` n'arrive.
   *
   * Sans ce traitement, nos drapeaux resteraient « encaissement actif » pour
   * toujours : chaque client se verrait proposer un formulaire de carte qui
   * échouerait au dernier clic, et le gérant lirait « actif » sur un écran qui
   * ment. On ferme, on garde la trace du compte, et le raccordement peut
   * reprendre normalement.
   */
  async revoquer(accountId: string, now: Date = new Date()): Promise<void> {
    const tenant = (await this.tenants
      .findOne({ 'encaissement.accountId': accountId })
      .lean()) as RawTenant | null;
    if (!tenant) {
      this.logger.warn(`Compte ${accountId} inconnu du parc — révocation ignorée.`);
      return;
    }
    const existant = lireCompte(tenant);
    await this.fermer(tenant._id, accountId, now, existant?.raccordeLe);
    this.logger.log(`Compte ${accountId} débranché par le restaurateur — encaissement fermé.`);
  }

  /** Ferme l'encaissement en conservant l'identifiant : la reprise reste possible. */
  private async fermer(
    tenantId: unknown,
    accountId: string,
    now: Date,
    raccordeLe: string | undefined,
  ): Promise<void> {
    await this.ecrireDrapeaux(
      tenantId,
      { id: accountId, charges_enabled: false, payouts_enabled: false, details_submitted: false },
      now,
      { raccordeLe: raccordeLe ? new Date(raccordeLe) : now },
    );
  }

  /**
   * Lecture TOLÉRANTE : `null` quand Stripe refuse ou ne répond pas.
   *
   * Un compte révoqué fait lever `accounts.retrieve` en permission_error. Sans
   * cette capture, le webhook rendait 500 — donc Stripe rejouait trois jours
   * durant — et le bouton « vérifier » du gérant tombait en erreur : il ne
   * pouvait ni comprendre ni corriger son état.
   */
  private async lireChezStripe(accountId: string): Promise<StripeCompte | null> {
    try {
      return await this.stripe.lireCompte(accountId);
    } catch (error) {
      this.logger.warn(`Lecture du compte ${accountId} impossible : ${String(error)}`);
      return null;
    }
  }

  private async plateformeDisponible(): Promise<boolean> {
    const client = this.stripe as StripeConnectClient & { disponible?: () => Promise<boolean> };
    return client.disponible ? client.disponible() : true;
  }

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const tenant = (await this.tenants.findById(tenantId).lean()) as RawTenant | null;
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return tenant;
  }
}
