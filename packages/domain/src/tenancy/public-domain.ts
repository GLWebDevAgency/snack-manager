import { InvalidDomainName } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';

/**
 * Nom de domaine public d'un restaurant (« commander.classfood.fr »).
 *
 * Value object : une instance existante est forcément un nom valide, en
 * minuscules, sans schéma ni chemin. On refuse volontairement les domaines
 * apex (« classfood.fr ») : un apex ne peut pas porter de CNAME selon la
 * RFC 1034, et un restaurateur qui pointerait son domaine racine chez nous
 * casserait sa messagerie. On exige donc un sous-domaine.
 */
export class PublicDomain {
  private constructor(readonly value: string) {}

  static create(input: string): Result<PublicDomain, InvalidDomainName> {
    const cleaned = input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '');

    if (!cleaned) {
      return err(new InvalidDomainName('Le domaine est vide'));
    }
    if (cleaned.length > 253) {
      return err(new InvalidDomainName('Le domaine dépasse 253 caractères'));
    }

    const labels = cleaned.split('.');
    if (labels.length < 3) {
      return err(
        new InvalidDomainName(
          `« ${cleaned} » est un domaine racine. Utilisez un sous-domaine, par exemple « commander.${cleaned} » — un domaine racine ne peut pas porter de CNAME.`,
        ),
      );
    }

    const label = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
    for (const l of labels) {
      if (!label.test(l)) {
        return err(new InvalidDomainName(`Segment invalide dans « ${cleaned} » : « ${l} »`));
      }
    }

    return ok(new PublicDomain(cleaned));
  }

  /** Sous-domaine que nous hébergeons nous-mêmes (pas de CNAME à poser). */
  isManagedBy(rootDomain: string): boolean {
    return this.value.endsWith(`.${rootDomain}`);
  }

  equals(other: PublicDomain): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ÉTIQUETTES RÉSERVÉES — SOURCE UNIQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Une étiquette réservée ne peut être NI un `TenantSlug`, NI — c'est la même
 * règle vue de l'autre bout — un sous-domaine que `apps/web/src/proxy.ts`
 * résoudrait comme un restaurant. Le proxy importe CETTE liste : il n'en tient
 * plus une seconde.
 *
 * ─── POURQUOI UNE SEULE LISTE, ET PAS DEUX ───
 *
 * Deux listes coexistaient, et leur divergence était une panne programmée. Le
 * proxy connaissait {www, app, api, admin, kds, pos, static} ; ce fichier
 * {www, api, admin, app, mail, ftp, cdn, static, assets, status, docs, blog,
 * support, sm, embed}. AUCUNE des deux ne connaissait « hq ».
 *
 * Le jour où le joker `*.snackmanager.fr` pointe sur le service web — c'est
 * prévu, et il ne consomme qu'un seul créneau de domaine —
 * `hq.snackmanager.fr`, l'adresse du CRM interne (`docs/specs/crm-sm.md`, la
 * pilule d'URL de la maquette la porte en toutes lettres), serait lue comme le
 * slug d'un restaurant nommé « hq ». La suite est mécanique : `/sm` tombe hors
 * de la liste blanche du proxy → 308 vers `/` → réécriture vers `/r/hq` → 404.
 * LE CRM INTERNE DEVIENT INATTEIGNABLE, sans qu'une seule ligne de code ait
 * changé — seule une entrée DNS aura bougé. Même mécanique pour
 * `tv.snackmanager.fr`.
 *
 * Une liste unique ne supprime pas l'oubli, mais elle le rend RÉPARABLE en un
 * seul endroit, et surtout elle empêche le pire cas : deux listes qui se
 * contredisent sur la même étiquette.
 *
 * ─── CE QUE RÉSERVER VEUT DIRE, ET CE QUE ÇA NE VEUT PAS DIRE ───
 *
 * Réserver une étiquette ferme DEUX portes et deux seulement :
 *   · aucun restaurant ne peut porter ce slug (`TenantSlug.create` refuse) ;
 *   · `<étiquette>.snackmanager.fr` est à NOUS — le proxy la sert comme la
 *     plateforme, pas comme un restaurant.
 *
 * Ça ne dit RIEN du domaine personnalisé d'un restaurateur :
 * `caisse.laclassfood.fr` reste parfaitement légitime s'il l'a enregistré chez
 * nous, parce que ce domaine-là est résolu par l'API, pas deviné.
 *
 * ─── LES FAMILLES, ET LA RAISON DE CHACUNE ───
 */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  /*
   * 1 · NOS SURFACES D'EXPLOITATION.
   *
   * Chacune est une route réelle de l'application (`app/admin`, `app/sm`,
   * `app/board`, `app/embed`, `app/api`) ou une surface prévue qui aura son
   * sous-domaine de rôle. C'est la famille qui manquait, et celle qui coûte le
   * plus cher : une seule d'entre elles captée comme slug rend une surface
   * interne inatteignable.
   *
   * Les doublons français/anglais sont volontaires — nous parlons de « caisse »
   * et de « cuisine » aux restaurateurs, de `pos` et `kds` dans le code, et les
   * deux finiront par être tapés dans une barre d'adresse.
   */
  'app',
  'admin',
  'sm', // notre console interne, servie sous `/sm`
  'hq', // CRM interne — `hq.snackmanager.fr` (docs/specs/crm-sm.md)
  'board', // écran de salle
  'tv', // le même écran de salle, nommé comme on le nomme en salle
  'kds',
  'cuisine', // KDS, en français
  'pos',
  'caisse', // POS, en français
  'embed',
  'api',
  'ws', // temps réel (socket.io) — voisin de `api`, même raison

  /*
   * 2 · LES PRÉFIXES DE CHEMIN DE L'APPLICATION.
   *
   * `/r/<slug>`, `/t/<id>`, `/embed/<slug>`, `/w.js`, `/photos/…` : la liste
   * blanche du proxy compare le chemin demandé à ces préfixes. Un restaurant
   * dont le slug serait l'un d'eux produirait des adresses ambiguës (`/r/r`,
   * `/photos` qui désigne à la fois un restaurant et un dossier d'images).
   *
   * `r`, `t` et `w` font moins de trois caractères : `TenantSlug` les refuse
   * déjà par sa borne de longueur. Ils sont ici quand même, parce que le proxy,
   * lui, accepte les étiquettes d'un seul caractère — et c'est le proxy qui
   * lira cette liste.
   */
  'r',
  't',
  'w',
  'photos',
  /*
   * `demo` : `app/r/demo` est une route STATIQUE, et une route statique
   * l'emporte sur `[slug]` dans Next. Un restaurant qui obtiendrait ce slug
   * verrait donc sa carte remplacée par notre démonstration, en silence.
   * `snackmanager.fr/r/demo` reste l'adresse de la démonstration.
   */
  'demo',

  /*
   * 3 · INFRASTRUCTURE, DNS ET MESSAGERIE.
   *
   * Ces étiquettes ont une signification établie hors de notre application. Les
   * laisser devenir des restaurants, c'est accepter qu'un jour `mail` ou `ns1`
   * désigne une carte de tacos — et se priver de les utiliser nous-mêmes.
   */
  'www',
  'mail',
  'webmail',
  'smtp',
  'imap',
  'pop',
  'mx',
  'ns',
  'ns1',
  'ns2',
  'ftp',
  'cdn',
  'static',
  'assets',
  'media',
  'files',

  /*
   * 4 · ENVIRONNEMENTS ET OUTILLAGE.
   *
   * Recette, prévisualisation, bac à sable : ces adresses servent NOTRE
   * plateforme, souvent avant qu'elle ne soit publique. Un restaurant qui
   * s'appellerait « staging » les rendrait indistinguables.
   */
  'dev',
  'staging',
  'recette',
  'preview',
  'test',
  'sandbox',
  'beta',
  'local',

  /*
   * 5 · CONTENU ET INSTITUTIONNEL.
   *
   * Notre vitrine, notre blog et notre support. `blog` et `docs` étaient déjà
   * là ; les variantes françaises suivent la même logique que « caisse ».
   */
  'blog',
  'docs',
  'support',
  'aide',
  'help',
  'status',
  'contact',
  'legal',

  /*
   * 6 · CE QUI SERT À TROMPER.
   *
   * `login.snackmanager.fr` ou `paiement.snackmanager.fr` servis depuis un
   * compte restaurant que n'importe qui peut créer, c'est une page
   * d'hameçonnage hébergée par nous, sous notre certificat, sur notre domaine.
   * Le coût de les réserver est nul ; le coût de ne pas le faire se compte en
   * réputation de domaine.
   */
  'login',
  'connexion',
  'compte',
  'account',
  'secure',
  'verify',
  'billing',
  'facturation',
  'paiement',
  'checkout',
]);

/**
 * Identifiant court d'un restaurant, utilisé comme sous-domaine et dans les URL.
 * Contraintes plus strictes qu'un domaine : c'est nous qui le générons.
 */
export class TenantSlug {
  private constructor(readonly value: string) {}

  static create(input: string): Result<TenantSlug, InvalidDomainName> {
    const cleaned = input
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (cleaned.length < 3) {
      return err(new InvalidDomainName('Identifiant trop court (3 caractères minimum)'));
    }
    if (cleaned.length > 63) {
      return err(new InvalidDomainName('Identifiant trop long (63 caractères maximum)'));
    }
    if (RESERVED_LABELS.has(cleaned)) {
      return err(new InvalidDomainName(`« ${cleaned} » est un identifiant réservé`));
    }

    return ok(new TenantSlug(cleaned));
  }

  /** Adresse servie par défaut, sans aucune action du restaurateur. */
  defaultDomain(rootDomain: string): string {
    return `${this.value}.${rootDomain}`;
  }

  equals(other: TenantSlug): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
