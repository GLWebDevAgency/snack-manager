import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EMPTY_SOCIAL_LINKS,
  PLATFORM_SETTINGS_ID,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  type JwtPayload,
  type PlatformSettings,
  type PlatformSettingsUpdate,
  type PlatformSocialLinks,
  type SocialNetwork,
} from '@sm/contracts';
import type { PlatformSettingsDoc } from '@sm/db';
import { AdminService } from './admin.service';

/**
 * ═══ LES RÉGLAGES DE NOTRE PROPRE VITRINE ═══
 *
 * Ce service porte les réglages de la PLATEFORME — ceux de Snack Manager,
 * pas ceux d'un restaurant. Premier locataire : les comptes de réseaux sociaux
 * affichés sur notre page d'accueil.
 *
 * Trois choses le distinguent du reste du CRM.
 *
 * 1. IL N'Y A PAS DE TENANT. Rien ici n'appartient à un client, rien ici n'est
 *    cloisonné par établissement. Le cloisonnement se fait par le RÔLE
 *    (`sm_admin`, posé sur le contrôleur d'écriture) : ce sont nos réglages,
 *    et un gérant de restaurant n'a aucune raison de pouvoir les modifier.
 *
 * 2. LA LECTURE EST PUBLIQUE, L'ÉCRITURE NE L'EST PAS. La vitrine est une page
 *    d'accueil : elle n'a pas de session et ne peut donc pas porter de jeton.
 *    D'où deux méthodes de lecture distinctes — `settings()` pour le CRM, qui
 *    rend la date de dernière modification, et `publicSocial()` pour la
 *    vitrine, qui ne rend QUE les quatre liens. La séparation n'est pas
 *    cosmétique : une seule méthode partagée finirait par rendre au public le
 *    champ interne qu'on lui aura ajouté un jour sans y penser.
 *
 * 3. CE QUI EST ÉCRIT EST PUBLIÉ. Aucune relecture, aucune validation d'un
 *    tiers ne s'intercale entre cet écran et notre page d'accueil. C'est
 *    pourquoi la validation est sévère (elle vit dans le contrat, déjà testée)
 *    et pourquoi chaque modification laisse une ligne de journal.
 */
@Injectable()
export class PlatformService {
  constructor(
    @InjectModel('PlatformSettings') private readonly settings: Model<PlatformSettingsDoc>,
    private readonly admin: AdminService,
  ) {}

  // ─── Lecture ───

  /**
   * Les réglages tels que le CRM les affiche.
   *
   * Le document n'existe PAS tant que personne n'a rien enregistré : c'est
   * l'état normal d'une plateforme neuve, pas une anomalie. On rend alors les
   * quatre liens à `null` et `updatedAt` à `null` — jamais une erreur, qui
   * ferait croire à une panne le jour de la mise en ligne.
   */
  async platformSettings(): Promise<PlatformSettings> {
    const raw = await this.settings
      .findById(PLATFORM_SETTINGS_ID)
      .lean<{ social?: unknown; updatedAt?: Date } | null>();

    return {
      social: toSocialLinks(raw?.social),
      updatedAt: raw?.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
    };
  }

  /**
   * CE QUE LA VITRINE A LE DROIT DE LIRE — et rien d'autre.
   *
   * Quatre liens, toujours les quatre clés, `null` valant « pas de compte ».
   * Ni date de modification, ni auteur du changement, ni identifiant de
   * document : cette route répond sans authentification, tout ce qu'elle rend
   * est public par construction. Une date de dernière modification n'a l'air
   * de rien et raconte pourtant notre activité interne à qui la relève.
   *
   * Le contrat garantit qu'on ne rend jamais un objet PARTIEL : sans les
   * quatre clés, la vitrine ne pourrait pas distinguer « pas encore chargé »
   * de « pas de compte », et c'est cette différence qui décide de l'affichage.
   */
  async publicSocial(): Promise<PlatformSocialLinks> {
    const { social } = await this.platformSettings();
    return social;
  }

  // ─── Écriture ───

  /**
   * Enregistre une modification des liens, rubrique par rubrique.
   *
   * ═══ POURQUOI UN `$set` CLÉ PAR CLÉ ═══
   *
   * `{ $set: { 'social.instagram': … } }` et surtout PAS
   * `{ $set: { social: objet } }`. Poser l'objet entier écraserait les trois
   * réseaux que la requête ne mentionne pas — or le contrat distingue
   * précisément « clé absente = ne pas toucher » de « clé à null = effacer ».
   * Un `$set` global détruirait cette distinction et transformerait chaque
   * modification d'un champ en remise à zéro des trois autres.
   *
   * ═══ POURQUOI UN UPSERT, JAMAIS UN `create()` ═══
   *
   * Le document n'existe pas au premier enregistrement. `create()` marcherait
   * une fois puis lèverait une erreur de clé dupliquée à chaque modification
   * suivante — c'est-à-dire en production, pas au développement.
   *
   * ═══ MUTATION D'ABORD, JOURNAL ENSUITE ═══
   *
   * Même ordre que dans `AdminService` : journaliser avant d'écrire
   * produirait, sur une écriture ratée, une ligne affirmant une publication
   * qui n'a pas eu lieu. Un registre qui ment est pire qu'un registre
   * incomplet.
   */
  async updateSettings(
    actor: JwtPayload,
    body: PlatformSettingsUpdate,
  ): Promise<PlatformSettings> {
    const wanted = body.social ?? {};

    const $set: Record<string, string | null> = {};
    const touched: SocialNetwork[] = [];
    for (const network of SOCIAL_NETWORKS) {
      // `in` et non une valeur falsy : `null` est une valeur DEMANDÉE
      // (effacer), `undefined` est une clé absente (ne pas toucher).
      if (!(network in wanted)) continue;
      $set[`social.${network}`] = wanted[network] ?? null;
      touched.push(network);
    }

    // Une requête qui ne demande rien n'écrit rien — et ne journalise rien.
    // Sans ce retour, ouvrir l'écran puis cliquer « Enregistrer » sans avoir
    // rien touché laisserait une ligne « réseaux modifiés » dans un registre
    // qui doit dire ce qui a CHANGÉ.
    if (Object.keys($set).length === 0) return this.platformSettings();

    // `findOneAndUpdate` plutôt qu'un `findById` suivi d'un `updateOne` : il
    // rend l'état d'AVANT et applique la modification en une seule opération
    // atomique. Lire puis écrire en deux temps laissait le `from` du journal
    // à la merci d'une écriture intercalée — la valeur tracée comme
    // « ancienne » pouvait n'avoir jamais été publiée.
    const previous = await this.settings
      .findOneAndUpdate({ _id: PLATFORM_SETTINGS_ID }, { $set }, { upsert: true, returnDocument: 'before' })
      .lean<{ social?: unknown } | null>();

    const before = toSocialLinks(previous?.social);
    await this.journalChanges(actor, before, applied(before, $set, touched));
    return this.platformSettings();
  }

  /**
   * Écrit la ligne de journal — seulement si quelque chose a réellement bougé.
   *
   * Ré-enregistrer le même lien n'est pas un changement : le tracer noierait
   * les vraies modifications sous des lignes identiques, et un journal qu'on
   * cesse de lire ne protège plus personne (même raison qui fait regrouper les
   * consultations de fiche dans `AdminService`).
   *
   * La phrase (`reason`) se lit avec des yeux, `meta` se relit avec une
   * machine : l'ancienne et la nouvelle valeur de chaque réseau touché, pour
   * qu'on puisse répondre à « ce lien pointait où, avant ? » sans deviner.
   */
  private async journalChanges(
    actor: JwtPayload,
    before: PlatformSocialLinks,
    after: PlatformSocialLinks,
  ): Promise<void> {
    const changes = SOCIAL_NETWORKS.filter((n) => before[n] !== after[n]).map((network) => ({
      network,
      from: before[network],
      to: after[network],
    }));
    if (changes.length === 0) return;

    await this.admin.recordPlatformAction(actor, {
      action: 'platform.social_change',
      reason: summarize(changes),
      meta: { changes },
    });
  }
}

// ─── Conversions ───

/**
 * Les quatre liens, toujours les quatre clés, dans l'ordre de la vitrine.
 *
 * Une chaîne vide est ramenée à `null` À LA LECTURE aussi, et pas seulement à
 * l'écriture. Le contrat l'interdit déjà en entrée, mais la base peut porter
 * un `''` venu d'ailleurs — une reprise de données, un enregistrement
 * antérieur à cette règle. `''` est une valeur PRÉSENTE : la vitrine
 * afficherait un pictogramme cliquable menant nulle part, ce qui est
 * exactement le défaut que tout ce module cherche à éviter.
 */
/**
 * L'état d'après DU POINT DE VUE DE CETTE REQUÊTE : l'état d'avant, où seuls
 * les réseaux que CETTE requête a écrits portent leur nouvelle valeur.
 *
 * Ce n'est pas une optimisation, c'est ce qui rend le journal exact. Relire le
 * document entier après l'écriture y ramène aussi ce qu'une requête VOISINE
 * vient d'écrire : deux enregistrements simultanés produisaient alors deux
 * lignes affirmant chacune les modifications de l'autre — « Facebook publié »
 * au nom de quelqu'un qui n'a pas touché à Facebook. Constaté à l'exécution,
 * quatre écritures concurrentes donnant quatre lignes identiques mentionnant
 * les quatre réseaux. Un registre qui attribue un geste à la mauvaise personne
 * est pire qu'une absence de registre : on le croit.
 */
function applied(
  before: PlatformSocialLinks,
  $set: Record<string, string | null>,
  touched: readonly SocialNetwork[],
): PlatformSocialLinks {
  const after = { ...before };
  for (const network of touched) {
    const value = $set[`social.${network}`];
    after[network] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  return after;
}

function toSocialLinks(raw: unknown): PlatformSocialLinks {
  const stored = (raw ?? {}) as Record<string, unknown>;
  const links = { ...EMPTY_SOCIAL_LINKS };
  for (const network of SOCIAL_NETWORKS) {
    const value = stored[network];
    links[network] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  return links;
}

type SocialChange = { network: SocialNetwork; from: string | null; to: string | null };

/**
 * « Instagram publié, LinkedIn retiré. »
 *
 * Le journal doit se lire sans ouvrir `meta` : les trois verbes disent ce que
 * le visiteur de la vitrine VOIT changer — un pictogramme apparaît, disparaît,
 * ou mène ailleurs — plutôt que « champ mis à jour », qui ne renseigne
 * personne.
 */
function summarize(changes: readonly SocialChange[]): string {
  const verb = (change: SocialChange): string => {
    if (change.to === null) return 'retiré';
    if (change.from === null) return 'publié';
    return 'modifié';
  };
  return changes.map((c) => `${SOCIAL_NETWORK_LABELS[c.network]} ${verb(c)}`).join(', ');
}
