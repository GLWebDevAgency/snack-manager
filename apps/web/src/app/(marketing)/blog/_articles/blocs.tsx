/*
 * ═══ POURQUOI LES FICHIERS DU BLOG DÉSACTIVENT `react/no-unescaped-entities` ═══
 *
 * (La note est ici parce que c'est le fichier qu'on ouvre en premier quand on
 * vient écrire un article ; les cinq autres y renvoient.)
 *
 * La règle interdit l'apostrophe droite dans du texte JSX et réclame `&apos;`.
 * Le reste du dépôt ne la rencontre jamais, et ce n'est pas un hasard : tout le
 * texte affiché de la vitrine vit en CHAÎNES dans `content.ts`, où la règle ne
 * s'applique pas — un composant de la landing ne rend qu'une constante.
 *
 * Un article ne peut pas suivre ce modèle : sa prose porte du gras, de l'emphase
 * et des renvois AU MILIEU des phrases, elle est donc du texte JSX par nature.
 * Les deux issues sont mauvaises. Écrire `n&apos;est` deux cent quarante fois
 * rend le texte illisible dans l'éditeur, c'est-à-dire relu de travers et
 * corrigé de travers — sur les pages mêmes qui existent pour être exactes. Et
 * passer à l'apostrophe typographique brouillerait le site, qui compose partout
 * ailleurs avec l'apostrophe droite.
 *
 * L'exemption est donc PAR FICHIER, jamais globale : la configuration partagée
 * ne bouge pas, aucun autre dossier n'en hérite, et le jour où la règle change
 * d'avis, six lignes disparaissent. `pnpm --filter @sm/web exec eslint
 * "src/app/(marketing)/blog"` sort en 0.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ancre } from "@/components/marketing/content";

/**
 * Les briques communes aux articles — et surtout LE GARDE-FOU DES LIENS.
 *
 * ═══ POURQUOI `Renvoi` EXISTE ═══
 *
 * Un article vit sous `/blog/mon-article`. Une ancre nue écrite dedans —
 * `href="#tarifs"` — ne résout donc PAS vers la landing : le navigateur cherche
 * l'élément dans la page où l'on se trouve, ne le trouve pas, et NE FAIT RIEN.
 * Pas de 404, pas d'erreur, pas une ligne de console. Le lien le plus commercial
 * de l'article devient un lien mort, et personne ne le voit avant un prospect.
 *
 * `Renvoi` rend cette faute IMPOSSIBLE : on ne lui donne pas une adresse, on lui
 * donne un identifiant de section, et il la résout par `ancre()` — laquelle
 * LÈVE si la section a disparu de `SECTIONS`. Le jour où une section est
 * supprimée, le rendu casse net au lieu de livrer un renvoi silencieusement
 * mort. C'est exactement ainsi qu'« Expertise → #pourquoi » a survécu des
 * semaines au composant qu'il désignait.
 *
 * Corollaire de style, valable dans tout ce dossier : AUCUN `<a href="#…">`
 * n'est écrit à la main dans un article. Ni ici, ni ailleurs.
 */
export function Renvoi({ section, children }: { section: string; children: ReactNode }) {
  return (
    <Link className="bl-renvoi" href={ancre(section).href}>
      {children}
    </Link>
  );
}

/**
 * Un libellé d'interface recopié VERBATIM depuis l'outil qu'on décrit
 * (« Commande de repas », « Définir comme préféré »).
 *
 * Il est composé différemment du reste pour une raison pratique : un lecteur qui
 * suit le mode d'emploi devant son écran cherche des mots à retrouver du regard,
 * pas des phrases à lire. Et parce qu'ils sont recopiés à l'identique, ils ne se
 * traduisent pas et ne se reformulent pas — un libellé « amélioré » est un
 * libellé introuvable.
 */
export function Ui({ children }: { children: ReactNode }) {
  return <span className="bl-ui">{children}</span>;
}

/** L'encadré « à retenir » : une idée, deux phrases, et on repart. */
export function Note({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <aside className="bl-note">
      <p className="bl-notetitre">{titre}</p>
      <div className="bl-notecorps">{children}</div>
    </aside>
  );
}

/**
 * Un mode d'emploi numéroté. `<ol>` et pas `<ul>` : l'ordre des étapes est la
 * seule information que porte une procédure, et un lecteur d'écran doit
 * l'entendre.
 */
export function Etapes({ children }: { children: ReactNode }) {
  return <ol className="bl-etapes">{children}</ol>;
}

export function Etape({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <li className="bl-etape">
      <p className="bl-etapetitre">{titre}</p>
      {children}
    </li>
  );
}

export type Source = {
  readonly url: string;
  readonly libelle: string;
  /** La date de consultation — une page d'aide se réécrit sans prévenir. */
  readonly consultee: string;
};

/**
 * LES SOURCES SONT AFFICHÉES, ET AVEC LEUR DATE DE CONSULTATION.
 *
 * Un article qui explique une procédure dans l'interface de quelqu'un d'autre
 * périme le jour où cette interface bouge. Dire QUAND on a regardé n'est pas une
 * précaution d'universitaire : c'est ce qui permet au lecteur de savoir s'il
 * doit nous croire ou aller vérifier — et à nous de savoir quel article relire.
 *
 * `rel="noopener noreferrer"` sur des liens sortants ouverts dans un onglet :
 * la page ouverte n'a aucune raison de garder une poignée sur la nôtre.
 */
export function Sources({ items }: { items: readonly Source[] }) {
  return (
    <section className="bl-sources">
      <h2 className="bl-sourcestitre">Sources</h2>
      <ul className="bl-sourceslist">
        {items.map((s) => (
          <li className="bl-source" key={s.url}>
            <a className="bl-sourcelink" href={s.url} target="_blank" rel="noopener noreferrer">
              {s.libelle}
            </a>
            <span className="bl-sourcedate">Consultée le {s.consultee}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
