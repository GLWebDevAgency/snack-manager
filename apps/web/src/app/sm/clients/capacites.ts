/**
 * LA RÈGLE DU PANNEAU « ACCÈS ET OPTIONS » — quel geste chaque ligne appelle.
 *
 * Un module à part, sans alias `@/` ni React : c'est la convention des règles
 * testables de cette application (`sm/navigation.ts`, `sm/refus.ts`), et la
 * raison est mécanique — vitest tourne ici sans configuration, donc sans
 * résolution de l'alias. Une règle enfouie dans `data.ts`, qui importe le
 * client HTTP, serait une règle qu'aucun test ne peut atteindre.
 *
 * Rien d'autre ne vit ici : le CALCUL des capacités appartient au contrat
 * (`detailCapacites`), et le front ne le rejoue jamais — la règle d'or veut que
 * le conditionnement se lise à un seul endroit.
 */

import type { CapaciteEffective, GesteDerogation } from "@sm/contracts";

/**
 * LE GESTE QU'UNE LIGNE DE CAPACITÉ APPELLE — un seul, déduit de son état.
 *
 * Une dérogation posée se LÈVE (on efface l'exception, la formule reprend la
 * main) ; sinon une fonction ouverte se RETIRE, et une fonction fermée
 * s'ACCORDE. Le panneau ne demande donc jamais « quel geste ? » — il demande
 * « sur quelle fonction ? », la seule question que l'opérateur se pose au
 * téléphone.
 *
 * C'est ce qui rend évidents les deux cas connus du déploiement : la fidélité
 * du pilote en formule Complet et l'éditeur de carte d'un client sans formule
 * sont deux lignes fermées et sans dérogation — un clic sur « Accorder », rien
 * à choisir.
 *
 * ON NE NEUTRALISE PAS UNE EXCEPTION EN EMPILANT L'EXCEPTION INVERSE. C'est
 * pourquoi la levée passe devant : un retrait l'emporte toujours sur un octroi
 * (`capacitesEffectives`), si bien qu'« accorder » par-dessus un retrait
 * n'aurait aucun effet visible si l'API ne remplaçait pas la ligne. Lever est
 * le geste juste, et il se lit tel quel dans le journal.
 */
export const gestePour = (c: CapaciteEffective): GesteDerogation =>
  c.derogation ? "levee" : c.acquise ? "retiree" : "accordee";
