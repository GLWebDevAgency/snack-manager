"use client";

/**
 * QUI EST CONNECTÉ — la personne, lue une fois sur `GET /auth/me`.
 *
 * ─── CE QUE CE FICHIER RÉPARE ───
 *
 * Les deux coques affichaient une identité ÉCRITE EN DUR en pied de barre :
 * « Le Gérant » avec une pastille « M » côté restaurant, « Admin SM » et
 * « Fondateur » côté équipe, en version bureau comme en version mobile. Ce
 * n'était jamais la personne devant l'écran — et sur un poste partagé, un nom
 * faux au-dessus du bouton de déconnexion est pire qu'un nom absent : il dit à
 * l'équipier qu'il travaille sous le compte de quelqu'un d'autre, ou l'inverse.
 *
 * La cause était côté API : `GET /tenants/me` rend l'ÉTABLISSEMENT, et le
 * jeton porte `sub`, `role` et `kind` — jamais le nom. `GET /auth/me` comble
 * ce trou, et lui seul.
 *
 * ─── POURQUOI PARTAGÉ PAR LES DEUX COQUES ───
 *
 * `app/admin/session.ts` explique pourquoi il ne partage RIEN avec
 * `app/sm/crm.ts` : les deux surfaces ont leur propre emplacement de jeton, et
 * importer le client du CRM depuis `/admin` ferait entrer tout le back-office
 * interne dans le paquet du restaurateur. Aucune des deux raisons ne vaut ici :
 * ce module ne connaît que `lib/api`, que les deux coques importent déjà, et il
 * pèse trois fonctions. Le dupliquer ferait diverger l'état d'attente des deux
 * barres au premier ajustement.
 *
 * ─── L'ATTENTE ET L'ÉCHEC NE FABRIQUENT RIEN ───
 *
 * Toutes les fonctions rendent `null` quand on ne sait pas, et jamais une
 * valeur de repli. C'est délibéré : une initiale par défaut (« S », « M »…)
 * est exactement le mensonge qu'on retire. L'appelant décide de l'état neutre
 * qu'il affiche — un tiret discret, à la même place et de la même hauteur, de
 * sorte que la barre ne saute pas quand le nom arrive.
 */

import { useEffect, useState } from "react";
import type { AuthMe } from "@sm/contracts";
import { api } from "./api";

/** La seule route qui dise qui est connecté — et, en PATCH, qui l'écrive. */
export const CHEMIN_IDENTITE = "/auth/me";

/**
 * LES BARRES OUVERTES, PRÉVENUES D'UN NOM QUI VIENT DE CHANGER.
 *
 * `useIdentite` lit la route une fois, à l'ouverture de la coque. L'écran qui
 * pose le nom, lui, vit DANS cette coque : sans ce carnet d'abonnés, la
 * personne enregistrerait son nom et continuerait de lire un tiret au-dessus
 * du bouton de déconnexion jusqu'au prochain rechargement complet — le défaut
 * qu'on répare, réapparu à l'écran une seconde après avoir été corrigé.
 *
 * Un `Set` de `setState` plutôt qu'un contexte : la barre et le formulaire ne
 * partagent ni arbre ni cycle de vie (l'un est dans `layout`, l'autre dans une
 * page), et un contexte les forcerait à se remonter ensemble. Le carnet se
 * vide de lui-même au démontage.
 */
const abonnes = new Set<(moi: AuthMe) => void>();

/**
 * Poser son propre nom, et prévenir tout ce qui l'affiche.
 *
 * Le sujet vient du jeton : cette fonction n'a pas d'identifiant à passer, et
 * ne peut donc renommer personne d'autre. Elle laisse remonter l'échec — c'est
 * l'écran qui sait quoi en dire, et il n'y en a qu'un.
 */
export async function poserMonNom(nom: string): Promise<AuthMe> {
  const moi = await api.patch<AuthMe>(CHEMIN_IDENTITE, { nom });
  // Copie du carnet : un abonné qui se démonte pendant la boucle ne doit pas
  // faire tomber l'enregistrement qui vient d'aboutir.
  for (const prevenir of [...abonnes]) prevenir(moi);
  return moi;
}

/**
 * Le nom à afficher, ou `null` s'il n'y en a pas.
 *
 * `name` vaut `''` par défaut dans le schéma des comptes : un compte créé par
 * script peut n'avoir jamais reçu de nom. Une chaîne vide n'est pas un nom, et
 * l'afficher laisserait une ligne creuse sous la pastille.
 */
export function nomAffichable(identite: AuthMe | null | undefined): string | null {
  const nom = identite?.nom?.trim();
  return nom ? nom : null;
}

/**
 * L'initiale de la pastille — DÉRIVÉE DU NOM, sans repli.
 *
 * Le voisin `components/order/helpers.ts#initial` fait le même geste pour la
 * tuile de marque d'un restaurant et retombe sur « S » : là-bas le repli est
 * inoffensif (c'est un logo manquant), ici il inventerait une personne.
 *
 * La première LETTRE ou CHIFFRE, pas le premier caractère : un nom qui commence
 * par une ponctuation ou une espace insécable donnerait une pastille muette.
 */
export function initialeDe(identite: AuthMe | null | undefined): string | null {
  const nom = nomAffichable(identite);
  if (!nom) return null;
  const lettre = nom.replace(/[^\p{L}\p{N}]/gu, "").charAt(0);
  return lettre ? lettre.toLocaleUpperCase("fr-FR") : null;
}

/**
 * Le rôle en toutes lettres — le mot que la personne emploierait elle-même.
 *
 * Un rôle inconnu rend `null` plutôt que sa valeur brute : `sm_admin` sous un
 * nom propre ne veut rien dire pour qui le lit, et un rôle ajouté demain sans
 * passer ici doit se taire, pas s'afficher en jargon.
 */
export function libelleRole(role: string | null | undefined): string | null {
  return role ? (LIBELLES_ROLE[role] ?? null) : null;
}

const LIBELLES_ROLE: Record<string, string> = {
  owner: "Propriétaire",
  gerant: "Gérant",
  caisse: "Caisse",
  cuisine: "Cuisine",
  sm_admin: "Équipe Snack Manager",
};

/**
 * L'identité de la session, ou `null` tant qu'on ne la connaît pas.
 *
 * Même motif que les autres chargements des deux coques (`/tenants/me`,
 * `/crm/overview`) : un effet, un drapeau d'annulation, aucune dépendance à un
 * état global.
 *
 * L'ÉCHEC EST MUET, et c'est un choix. Un 401 sur cette route en accompagne
 * toujours un autre — la coque charge son établissement ou son aperçu HQ dans
 * le même souffle — et ces appels-là portent déjà la redirection vers la
 * connexion. Une seconde autorité de déconnexion ici ferait courir deux
 * redirections concurrentes pour une barre de navigation.
 *
 * `actif` évite d'appeler avant que la coque ne sache qu'elle a une session :
 * côté serveur et au premier rendu, il n'y a pas de jeton à lire.
 */
export function useIdentite(actif: boolean): AuthMe | null {
  const [identite, setIdentite] = useState<AuthMe | null>(null);

  // Abonnement AU CARNET, sans condition sur `actif` : une coque qui n'a pas
  // encore de jeton au premier rendu doit tout de même entendre le nom posé
  // ensuite, et `setIdentite` est stable d'un rendu à l'autre.
  useEffect(() => {
    abonnes.add(setIdentite);
    return () => {
      abonnes.delete(setIdentite);
    };
  }, []);

  useEffect(() => {
    if (!actif) return;
    let annule = false;
    api
      .get<AuthMe>(CHEMIN_IDENTITE)
      .then((moi) => {
        if (!annule) setIdentite(moi);
      })
      .catch(() => {
        // État neutre : la barre montre un tiret, jamais un nom deviné.
      });
    return () => {
      annule = true;
    };
  }, [actif]);

  return identite;
}
