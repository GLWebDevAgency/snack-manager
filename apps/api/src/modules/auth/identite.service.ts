import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthMe, AuthMeUpdate, JwtPayload, StaffRole, UserRole } from '@sm/contracts';
import type { Staff, User } from '@sm/db';

/**
 * CE QU'ON A LE DROIT DE LIRE SUR UN COMPTE — liste BLANCHE, et c'est vital.
 *
 * Elle vaut aussi pour l'ÉCRITURE : `PATCH /auth/me` relit le document par
 * cette même projection pour composer sa réponse. Un `findByIdAndUpdate` qui
 * renverrait le document entier ferait sortir l'empreinte par la porte de
 * derrière, alors même que la lecture, elle, resterait irréprochable.
 *
 * Le document `users` porte `passwordHash` : l'empreinte Argon2id du mot de
 * passe du gérant. Elle ne doit jamais quitter le serveur, ni dans cette
 * réponse ni dans un journal.
 *
 * Une projection PAR RETRAIT (`{ passwordHash: 0 }`) rendrait tout le reste —
 * y compris le prochain champ ajouté au schéma, secret ou non, sans que
 * personne ne repasse ici. Une liste blanche fait l'inverse : un champ nouveau
 * reste invisible tant que quelqu'un ne l'a pas nommé. C'est la même règle que
 * `TENANT_ME_FIELDS` côté établissement, pour la même raison.
 *
 * `_id` est rendu par Mongo sans être nommé — c'est l'identifiant demandé.
 */
export const IDENTITE_COMPTE_FIELDS = {
  name: 1,
  email: 1,
  role: 1,
  tenantId: 1,
} as const;

/**
 * Et sur un membre d'équipe — deux champs, pas un de plus.
 *
 * `pinHash` est le secret de la tablette, `hourlyCostCents` la rémunération du
 * salarié : le schéma les décrit tous deux comme des champs qui ne partent
 * JAMAIS dans une réponse par défaut. Ni l'un ni l'autre n'est nommé ici, et
 * la liste blanche garantit qu'aucun ajout futur ne s'y invitera tout seul.
 */
export const IDENTITE_EQUIPE_FIELDS = {
  name: 1,
  role: 1,
} as const;

type CompteLu = {
  _id: unknown;
  name?: string;
  email?: string;
  role: UserRole;
  tenantId?: unknown;
};

type MembreLu = {
  _id: unknown;
  name: string;
  role: StaffRole;
};

/**
 * L'identité derrière le jeton courant.
 *
 * Le service ne REVÉRIFIE rien : le garde global (`AuthGuard` →
 * `SessionAccessService.assertAllows`) relit la session à chaque requête et
 * refuse déjà, avant d'arriver ici, un compte supprimé, un salarié désactivé,
 * une tablette dépairée, un rôle ou une version de session qui ont changé
 * depuis l'émission du jeton, et un établissement suspendu. Redoubler ces
 * contrôles ferait diverger deux règles au premier changement de l'une.
 *
 * Reste le cas que le garde ne peut pas couvrir : la suppression qui tombe
 * ENTRE sa lecture et la nôtre. On ne fabrique alors aucune identité — un 401
 * dit la vérité, et l'écran repart vers la connexion.
 */
@Injectable()
export class IdentiteService {
  constructor(
    @InjectModel('User') private readonly users: Model<User>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
  ) {}

  async moi(session: JwtPayload): Promise<AuthMe> {
    // `kind` n'a que deux valeurs possibles, et le garde a refusé tout le
    // reste : le jeton qui arrive ici est forcément l'un des deux.
    return session.kind === 'staff' ? this.membreDEquipe(session) : this.compte(session);
  }

  /**
   * POSER SON PROPRE NOM — `PATCH /auth/me`.
   *
   * `users.name` n'avait qu'UN seul auteur : la conversion d'un lead, depuis
   * un champ facultatif de la modale du CRM. Aucune route ne le mettait à
   * jour, si bien qu'un nom laissé vide à la signature l'était pour toujours —
   * et se lisait comme un tiret en pied des deux barres.
   *
   * ─── CE QUE CETTE ROUTE DEVIENDRA (ET NE FAIT PAS ENCORE) ───
   *
   * Le chantier « plusieurs comptes par restaurant » ajoutera des rôles plus
   * fins. Cette route ne changera PAS de nature : elle restera « je pose mon
   * propre nom », sujet pris au jeton. Ce qui viendra à côté, c'est un
   * renommage d'AUTRUI — un identifiant dans le chemin, une permission qui le
   * garde, et sa place naturelle est l'écran Équipe, là où vivent déjà les
   * membres. La réponse, elle, s'enrichira des permissions (cf. `AuthMe`), que
   * l'écran lira pour peindre sa barre. Rien de tout cela n'est écrit
   * aujourd'hui : aucune table, aucun rôle, aucun champ inventé d'avance.
   *
   * ─── UNE SESSION OUVERTE AU CODE N'ÉCRIT RIEN ICI ───
   *
   * Un porteur de code n'a pas de compte dans `users` : son nom vit dans
   * `staff`, et `StaffController` porte `@Roles('owner', 'gerant')` — le nom
   * d'un équipier est posé par celui qui l'embauche, sur l'écran Équipe. Le
   * laisser se renommer depuis la tablette du comptoir donnerait à qui connaît
   * quatre chiffres le pouvoir de réécrire le nom qui signe le journal des
   * gestes sensibles et les pointages. Le refus est donc net, et le message
   * dit où le nom se change vraiment.
   */
  async poserMonNom(session: JwtPayload, body: AuthMeUpdate): Promise<AuthMe> {
    if (session.kind === 'staff') {
      throw new ForbiddenException(
        'Une session ouverte au code ne change pas son nom : il se pose sur l’écran Équipe.',
      );
    }

    const compte = await this.users
      .findByIdAndUpdate(
        session.sub,
        { $set: { name: body.nom } },
        // La MÊME liste blanche qu'à la lecture, et `new` pour rendre ce qui
        // vient d'être écrit plutôt que ce qui l'était avant.
        { new: true, projection: IDENTITE_COMPTE_FIELDS },
      )
      .lean<CompteLu | null>();

    // Le compte a disparu entre le garde et cette écriture : rien n'a été
    // écrit, et il n'y a personne à nommer.
    if (!compte) throw new UnauthorizedException();

    return this.depuisLeCompte(compte);
  }

  /** Session e-mail + mot de passe : propriétaire ou équipe Snack Manager. */
  private async compte(session: JwtPayload): Promise<AuthMe> {
    const compte = await this.users
      .findById(session.sub, IDENTITE_COMPTE_FIELDS)
      .lean<CompteLu | null>();

    if (!compte) throw new UnauthorizedException();

    return this.depuisLeCompte(compte);
  }

  /**
   * La réponse composée CHAMP PAR CHAMP depuis le document projeté.
   *
   * Partagée par la lecture et l'écriture : deux copies de ce mapping
   * divergeraient au premier champ ajouté à `AuthMe`, et c'est la réponse
   * d'écriture — la moins relue des deux — qui garderait l'ancienne forme.
   */
  private depuisLeCompte(compte: CompteLu): AuthMe {
    return {
      id: String(compte._id),
      nom: (compte.name ?? '').trim(),
      role: compte.role,
      genre: 'user',
      email: compte.email ?? null,
      // `null` pour `sm_admin` : l'équipe Snack Manager n'a pas de restaurant.
      // La valeur vient du DOCUMENT, que le garde vient de comparer au jeton.
      tenantId: compte.tenantId ? String(compte.tenantId) : null,
    };
  }

  /** Session ouverte au code sur une tablette appairée. */
  private async membreDEquipe(session: JwtPayload): Promise<AuthMe> {
    // Lecture PORTÉE PAR LE JETON, comme partout ailleurs dans le logiciel :
    // le `tenantId` ne vient jamais du client, et un identifiant emprunté à un
    // autre restaurant ne rend donc rien plutôt que le nom de son porteur.
    const membre = await this.staff
      .findOne({ _id: session.sub, tenantId: session.tenantId }, IDENTITE_EQUIPE_FIELDS)
      .lean<MembreLu | null>();

    if (!membre) throw new UnauthorizedException();

    return {
      id: String(membre._id),
      nom: membre.name.trim(),
      role: membre.role,
      genre: 'staff',
      // Un code à quatre chiffres n'a pas d'adresse e-mail — `null` le dit,
      // là où une chaîne vide laisserait croire à un champ non renseigné.
      email: null,
      tenantId: session.tenantId,
    };
  }
}
