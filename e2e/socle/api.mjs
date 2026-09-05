/**
 * CLIENT HTTP DU PARC RÉEL.
 *
 * Les scénarios « démo » n'en ont aucun usage : ils tournent entièrement dans
 * le navigateur. Ce module ne sert qu'aux deux scénarios qui exigent une vraie
 * API — la suspension d'un établissement et le changement de prix visible côté
 * client — parce que ces mécaniques-là n'existent pas dans une fixture.
 *
 * ─── CE QUE CE MODULE NE FAIT JAMAIS ───
 *
 * Il n'écrit aucun identifiant, aucun jeton, aucun corps de requête dans la
 * sortie. Un journal d'exécution GitHub est public : un mot de passe qui y
 * passe est un mot de passe à changer. Les erreurs remontent le statut et le
 * chemin, jamais l'en-tête d'autorisation.
 */

import { enrichir } from './attentes.mjs';

/** Erreur d'API — porte le statut, qui est souvent l'assertion elle-même. */
export class ErreurApi extends Error {
  constructor(statut, chemin, message) {
    super(`${statut} sur ${chemin} — ${message}`);
    this.statut = statut;
    this.chemin = chemin;
  }
}

/** Client minimal : connexion, lecture, écriture, et rien d'autre. */
export function client(base) {
  let jeton = null;

  async function appel(methode, chemin, corps) {
    const reponse = await fetch(base + chemin, {
      method: methode,
      headers: {
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    let charge = null;
    try {
      charge = await reponse.json();
    } catch {
      /* réponse vide ou non-JSON : le statut suffit */
    }
    return { statut: reponse.status, charge };
  }

  /** Appelle et lève si le statut n'est pas 2xx — pour les gestes qui doivent réussir. */
  async function exiger(methode, chemin, corps) {
    const { statut, charge } = await appel(methode, chemin, corps);
    if (statut < 200 || statut >= 300) {
      throw new ErreurApi(statut, chemin, charge?.message ?? 'sans message');
    }
    return charge;
  }

  return {
    /** Statut brut — c'est LUI qu'on vérifie sur les refus attendus. */
    brut: appel,
    get: (chemin) => exiger('GET', chemin),
    post: (chemin, corps) => exiger('POST', chemin, corps),
    patch: (chemin, corps) => exiger('PATCH', chemin, corps),
    del: (chemin) => exiger('DELETE', chemin),

    /** Ouvre une session. Le jeton reste dans la fermeture, il n'en sort pas. */
    async connexion({ email, motDePasse }) {
      const { statut, charge } = await appel('POST', '/auth/login', {
        email,
        password: motDePasse,
      });
      if (statut !== 200 || !charge?.token) {
        throw new ErreurApi(statut, '/auth/login', `connexion refusée pour ${email}`);
      }
      jeton = charge.token;
      return charge.user;
    },

    /** Repart anonyme — pour vérifier ce que voit un visiteur sans session. */
    anonyme() {
      jeton = null;
    },
  };
}

/**
 * Joue un scénario qui écrit dans le parc, puis le remet en état — TOUJOURS.
 *
 * `try { … } finally { … }` ne suffit pas : si la remise en état échoue à son
 * tour, son erreur REMPLACE celle du scénario, et on perd la seule information
 * qui disait pourquoi le test avait échoué. Cette fonction garde les deux, et
 * les affiche ensemble : « voici ce qui est cassé, ET voici ce qui reste à
 * réparer à la main dans le parc ».
 */
export async function avecRemiseEnEtat(corps, remise) {
  let panne = null;
  try {
    await corps();
  } catch (erreur) {
    panne = erreur;
  }

  try {
    await remise();
  } catch (erreur) {
    if (!panne) throw erreur;
    enrichir(panne, `⚠️  ET LA REMISE EN ÉTAT A ÉCHOUÉ — ${erreur.message}`);
  }

  if (panne) throw panne;
}

/** Prix en centimes tel qu'il s'écrit à l'écran : « 8,40 € ». */
export const euros = (centimes) =>
  `${(centimes / 100).toFixed(2).replace('.', ',')} €`;

/** Le produit portant ce nom dans la carte publique — avec son identifiant. */
export function produitDeLaCarte(site, nom) {
  const trouve = site.menu.categories
    .flatMap((categorie) => categorie.products)
    .find((produit) => produit.name === nom);
  if (!trouve) {
    throw new Error(`Aucun produit « ${nom} » dans la carte publique — le scénario vise un produit qui n’existe plus.`);
  }
  return trouve;
}
