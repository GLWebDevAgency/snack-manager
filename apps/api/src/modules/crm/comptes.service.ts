import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  comptesAutorises,
  courrielDejaPris,
  projeterCompte,
  refusQuotaComptes,
  ROLE_COMPTE_LABELS,
  type CompteCree,
  type CompteCreate,
  type CompteRestaurant,
  type CompteRole,
  type CompteRevoke,
  type ComptesRestaurant,
  type Formule,
  type JwtPayload,
} from '@sm/contracts';
import type { Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import { SECRET_HASHER } from '../../infrastructure/tokens';
import { SessionRevocationPublisher } from '../../common/session-revocation';
import { AdminService } from './admin.service';
import { generatePassword } from './conversion.service';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LES COMPTES D'UN RESTAURANT — ouverts, changés et fermés par LE SUPPORT.║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── POURQUOI CE SERVICE VIT DANS LE CRM, ET NON DANS LE BACK-OFFICE ───
 *
 * Le restaurateur ne crée pas ses comptes lui-même, et c'est une décision, pas
 * un raccourci de livraison. Elle a une conséquence heureuse : AUCUN COURRIEL
 * TRANSACTIONNEL n'est nécessaire. Le mot de passe est fabriqué par le serveur
 * et rendu UNE FOIS dans la réponse — exactement le chemin qu'emprunte déjà le
 * compte du propriétaire à la signature (`ConversionService.convert`) — puis
 * dicté au téléphone par la personne qui vient de le créer.
 *
 * L'alternative, l'invitation par e-mail, demanderait un expéditeur vérifié,
 * une file d'envoi, des jetons à durée de vie, une page publique de choix de
 * mot de passe et la surveillance des rebonds : cinq pièces neuves, chacune
 * capable de tomber en silence, pour remplacer un appel téléphonique que
 * l'équipe passe de toute façon.
 *
 * ─── CE QUE CE SERVICE NE FAIT PAS ───
 *
 * Il ne réinitialise pas de mot de passe : `ConversionService.resetOwnerPassword`
 * tient déjà ce geste pour le propriétaire, et l'étendre aux autres comptes est
 * un chantier distinct (le même geste, une cible de plus). Il ne crée pas de
 * propriétaire — voir `ROLES_ATTRIBUABLES` (@sm/contracts).
 *
 * Le cloisonnement (`@Roles('sm_admin')`) est posé sur `AdminController` : ce
 * service est TRANS-TENANT par construction. Chacune de ses écritures filtre
 * néanmoins sur `tenantId` en plus de l'identifiant de compte — un identifiant
 * deviné ne doit pas suffire à couper l'accès d'un autre restaurant, même
 * depuis un jeton d'équipe.
 */
@Injectable()
export class ComptesService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('User') private readonly users: Model<User>,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    private readonly admin: AdminService,
    /**
     * `@Optional()` comme sur `AdminService`, et pour la même raison : la
     * coupure des sessions ne dépend PAS de Redis. Un compte révoqué disparaît
     * de `users`, et `SessionAccessService` relit ce document à chaque requête
     * HTTP et à chaque revalidation de socket — l'événement accélère la
     * fermeture des sockets déjà ouvertes, il n'en est pas la seule garantie.
     */
    @Optional() private readonly revocations?: SessionRevocationPublisher,
  ) {}

  /**
   * LA LISTE, avec le plafond de la formule et ce qu'il en reste.
   *
   * Le quota est rendu par l'API et non recalculé par l'écran : il dépend de la
   * formule du client, et la règle d'or du produit interdit qu'une surface
   * connaisse le nom d'une formule. L'écran affiche « 2 comptes sur 2 », il ne
   * sait pas que « 2 » vient de Complet.
   */
  async list(tenantId: string): Promise<ComptesRestaurant> {
    const tenant = await this.requireTenant(tenantId);
    const comptes = await this.lire(tenant._id);
    return this.vue(tenant, comptes);
  }

  /**
   * OUVRIR UN COMPTE — le mot de passe est rendu une fois, ici.
   *
   * L'ordre des contrôles suit ce qu'un opérateur au téléphone a besoin
   * d'apprendre en premier : le quota (« ce client n'y a pas droit, il faut
   * changer d'offre ») avant l'adresse (« celle-ci est prise, donnez-m'en une
   * autre »). L'inverse ferait chercher une seconde adresse pour se voir
   * ensuite refuser le compte.
   */
  async create(actor: JwtPayload, tenantId: string, body: CompteCreate): Promise<CompteCree> {
    const tenant = await this.requireTenant(tenantId);
    const existants = await this.lire(tenant._id);

    const max = comptesAutorises(tenant.plan as Formule | null);
    if (existants.length >= max) throw new ConflictException(refusQuotaComptes(max));

    const email = body.email.toLowerCase();
    await this.refuserSiCourrielPris(email);

    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);

    let cree;
    try {
      cree = await this.users.create({
        email,
        passwordHash,
        role: body.role,
        tenantId: tenant._id,
        name: body.nom,
        // Une génération neuve dès la naissance : `0` est la valeur de
        // compatibilité des comptes d'avant la révocation de session, elle n'a
        // aucune raison d'être posée sur un compte créé aujourd'hui.
        sessionVersion: randomUUID(),
      });
    } catch (cause) {
      // ── LA COURSE ENTRE LA VÉRIFICATION ET L'ÉCRITURE ──
      // Deux créations simultanées sur la même adresse passent toutes deux le
      // contrôle ci-dessus ; l'index unique en refuse une. Sans cette reprise,
      // l'opérateur recevrait un 500 « E11000 duplicate key » là où il vient
      // de lire une phrase française pour le cas non concurrent.
      if (estDoublonDeCourriel(cause)) await this.refuserSiCourrielPris(email);
      throw cause;
    }

    const compte = projeterCompte(cree.toObject());
    await this.admin.recordCompteGesture(actor, tenantId, {
      action: 'tenant.compte_create',
      compteId: compte.id,
      summary: `Compte ${ROLE_COMPTE_LABELS[compte.role].toLowerCase()} ouvert pour ${compte.email}`,
      // L'adresse et le rôle, jamais le secret : le mot de passe n'existe qu'une
      // fois, dans la réponse ci-dessous, et le journal n'a pas à le relire.
      meta: { email: compte.email, nom: compte.nom, role: compte.role },
    });

    return { ...compte, password };
  }

  /**
   * CHANGER LE RÔLE D'UN COMPTE — et couper ses sessions dans la foulée.
   *
   * Les deux vont ensemble et ne se séparent pas : un jeton porte le rôle, et
   * `SessionAccessService` compare celui du jeton à celui du document. Sans le
   * changement de `sessionVersion`, l'ancien jeton serait déjà refusé (le rôle
   * ne correspond plus) — la génération neuve est ce qui rend le refus VRAI
   * même si la comparaison de rôle venait un jour à être assouplie, et elle
   * traite les deux sens du geste de la même façon.
   */
  async changeRole(
    actor: JwtPayload,
    tenantId: string,
    compteId: string,
    body: CompteRole,
  ): Promise<ComptesRestaurant> {
    const tenant = await this.requireTenant(tenantId);
    const cible = await this.requireCompte(tenant._id, compteId);
    const avant = projeterCompte(cible);

    this.refuserSiProprietaire(avant, 'change de rôle');
    if (avant.role === body.role) {
      // Le geste ne changerait rien, l'écran ne bougerait pas, et le journal
      // porterait une ligne qui ne raconte rien. Même refus que la dérogation
      // de capacité reposée à l'identique.
      throw new BadRequestException(
        `${avant.email} est déjà ${ROLE_COMPTE_LABELS[body.role].toLowerCase()} — ce changement ne changerait rien.`,
      );
    }

    await this.users.updateOne(
      { _id: cible._id, tenantId: tenant._id },
      { $set: { role: body.role, sessionVersion: randomUUID() } },
      { runValidators: true, context: 'query' },
    );
    await this.revocations?.user(String(tenant._id), avant.id);

    await this.admin.recordCompteGesture(actor, tenantId, {
      action: 'tenant.compte_role',
      compteId: avant.id,
      // Le MOTIF est la phrase du journal, comme sur la dérogation de capacité :
      // le retaper ailleurs donnerait deux versions du même geste.
      summary: body.motif,
      meta: {
        email: avant.email,
        nom: avant.nom,
        roleAvant: avant.role,
        role: body.role,
      },
    });

    return this.list(tenantId);
  }

  /**
   * RÉVOQUER UN COMPTE — le document est SUPPRIMÉ, pas désactivé.
   *
   * ─── POURQUOI SUPPRIMER PLUTÔT QUE DÉSACTIVER ───
   *
   * Un compte désactivé garderait son adresse, et l'adresse est unique dans
   * tout le parc (index unique sur `users.email`) : le cogérant qui part
   * emporterait son adresse pour toujours, et la personne qui le remplace ne
   * pourrait pas la reprendre. Une révocation qui laisse une empreinte de mot
   * de passe et une adresse bloquée derrière elle n'est pas une révocation,
   * c'est une mise en veille qu'on oublie de relire.
   *
   * CE QUI SURVIT À LA SUPPRESSION, et c'est le point : les REGISTRES. Le
   * journal d'administration porte l'adresse, le nom et le rôle du compte
   * supprimé ; le registre des gestes sensibles a DÉNORMALISÉ l'auteur de
   * chaque ligne au moment du geste (`AuditService.auteur`). « Qui a annulé
   * cette commande en mars » se relit donc à l'identique après le départ de la
   * personne — ce qui est exactement la propriété qu'un registre à valeur
   * probante ne doit pas perdre.
   *
   * ─── CE QUI COUPE LES SESSIONS ───
   *
   * Le document disparaît : `SessionAccessService.assertUserRecordAllows` ne le
   * retrouve plus et refuse la requête suivante — HTTP comme WebSocket, sans
   * aucun délai. L'événement Redis (`scope: 'user'`) ferme en plus les sockets
   * DÉJÀ ouvertes, qui n'émettent aucune requête et attendraient sinon la
   * revalidation périodique du gateway.
   */
  async revoke(
    actor: JwtPayload,
    tenantId: string,
    compteId: string,
    body: CompteRevoke,
  ): Promise<ComptesRestaurant> {
    const tenant = await this.requireTenant(tenantId);
    const cible = await this.requireCompte(tenant._id, compteId);
    const compte = projeterCompte(cible);

    this.refuserSiProprietaire(compte, 'se révoque');

    await this.users.deleteOne({ _id: cible._id, tenantId: tenant._id });
    await this.revocations?.user(String(tenant._id), compte.id);

    await this.admin.recordCompteGesture(actor, tenantId, {
      action: 'tenant.compte_revoke',
      compteId: compte.id,
      summary: body.motif,
      meta: { email: compte.email, nom: compte.nom, role: compte.role },
    });

    return this.list(tenantId);
  }

  // ─── Règles ───

  /**
   * LE PROPRIÉTAIRE NE SE TOUCHE PAS — ni rôle, ni révocation.
   *
   * C'est lui qui porte l'abonnement et le raccordement d'encaissement : un
   * restaurant sans propriétaire est un restaurant qu'on ne peut plus facturer,
   * et dont l'argent des commandes en ligne n'a plus de destinataire. Le geste
   * ne se rattraperait qu'en écrivant dans Mongo à la main — c'est-à-dire par
   * le chemin que tout ce module existe pour fermer.
   *
   * Ce n'est PAS un contrôle d'affichage : l'écran cache déjà ces boutons sur
   * la ligne du propriétaire. Une garde qui ne vit que dans un composant React
   * ne garde rien.
   */
  private refuserSiProprietaire(compte: CompteRestaurant, geste: string): void {
    if (!compte.proprietaire) return;
    throw new BadRequestException(
      `Le compte propriétaire ne ${geste} pas : c’est lui qui porte l’abonnement et ` +
        `l’encaissement de l’établissement. Pour en changer le mot de passe, utilisez ` +
        `« Mot de passe » ; pour changer de propriétaire, il faut passer par nous.`,
    );
  }

  /** L'adresse est-elle déjà prise dans le parc ? Si oui, on dit par qui. */
  private async refuserSiCourrielPris(email: string): Promise<void> {
    const pris = await this.users
      .findOne({ email }, { tenantId: 1 })
      .lean<{ tenantId?: unknown } | null>();
    if (!pris) return;

    // Un compte SANS établissement est l'un des nôtres (`sm_admin`). Le nommer
    // « Snack Manager » évite de laisser croire à un client fantôme.
    const chez = pris.tenantId ? await this.nomEtablissement(pris.tenantId) : 'Snack Manager';
    throw new ConflictException(courrielDejaPris(email, chez));
  }

  private async nomEtablissement(tenantId: unknown): Promise<string> {
    const tenant = await this.tenants
      .findById(tenantId, { name: 1 })
      .lean<{ name?: string } | null>();
    return (tenant?.name ?? '').trim() || 'un autre établissement';
  }

  // ─── Lectures ───

  /**
   * LES COMPTES DU RESTAURANT, projection Mongo COMPRISE.
   *
   * La projection est posée deux fois — ici sur la requête, et en sortie par
   * `projeterCompte`. Ce n'est pas de la redondance décorative : celle-ci évite
   * de faire VOYAGER l'empreinte du mot de passe entre Mongo et le processus,
   * celle-là garantit qu'aucune réponse ne la porte même si un appelant futur
   * oublie la première. Un test le prouve avec un double qui rend le document
   * entier — c'est-à-dire en supprimant délibérément la première des deux.
   */
  private async lire(tenantId: unknown): Promise<CompteRestaurant[]> {
    const docs = await this.users
      .find({ tenantId }, { email: 1, role: 1, name: 1, createdAt: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    return docs
      .map((doc) => projeterCompte(doc))
      // Le propriétaire en tête, quel que soit l'ordre de création : c'est la
      // ligne qu'on cherche des yeux, et la seule qui n'a pas de boutons.
      .sort((a, b) => Number(b.proprietaire) - Number(a.proprietaire));
  }

  private vue(tenant: RawTenant, comptes: CompteRestaurant[]): ComptesRestaurant {
    const max = comptesAutorises(tenant.plan as Formule | null);
    return { comptes, max, restants: Math.max(0, max - comptes.length) };
  }

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new NotFoundException('Établissement introuvable');
    }
    const raw = await this.tenants
      .findById(tenantId, { name: 1, plan: 1 })
      .lean<RawTenant | null>();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw;
  }

  /**
   * Le compte visé, DANS cet établissement.
   *
   * Le filtre porte les deux : un identifiant de compte deviné ne doit pas
   * suffire à révoquer le cogérant d'un autre restaurant, ni à atteindre un
   * compte d'équipe Snack Manager (`tenantId: null`, donc jamais retrouvé ici).
   * Réponse 404 et non 403 : l'équipe n'a pas à apprendre qu'un compte existe
   * ailleurs en tapant une URL.
   */
  private async requireCompte(tenantId: unknown, compteId: string): Promise<RawUser> {
    if (!Types.ObjectId.isValid(compteId)) throw new NotFoundException('Compte introuvable');
    const raw = await this.users
      .findOne(
        { _id: new Types.ObjectId(compteId), tenantId },
        { email: 1, role: 1, name: 1, createdAt: 1 },
      )
      .lean<RawUser | null>();
    if (!raw) throw new NotFoundException('Compte introuvable');
    return raw;
  }
}

type RawTenant = { _id: unknown; name?: string; plan?: string | null };
type RawUser = { _id: unknown; email?: string; role?: string; name?: string; createdAt?: Date };

/**
 * L'index unique de Mongo a parlé — code 11000, quelle que soit la couche qui
 * l'emballe. Lu défensivement : `MongoServerError` n'est pas exporté par
 * mongoose et le pilote enveloppe l'erreur différemment selon les versions.
 */
function estDoublonDeCourriel(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return code === 11000 || code === '11000';
}
