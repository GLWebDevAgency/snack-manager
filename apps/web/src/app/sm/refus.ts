/**
 * CE QU'ON MONTRE À L'OPÉRATEUR QUAND L'API REFUSE — règle pure, sans import.
 *
 * Séparée de `crm.ts` pour une raison précise : ce fichier-là importe l'alias
 * `@/`, que la configuration de test du web ne résout pas. Une règle qui décide
 * de ce qu'un opérateur lit en cas d'échec ne doit pas être intestable parce
 * qu'elle voisine avec un client HTTP. C'est le même choix que
 * `admin/ingredients/montants.ts`, et pour le même motif.
 *
 * ── L'ordre n'est pas indifférent ─────────────────────────────────────────
 *
 * Le refus de SCHÉMA d'abord : nos schémas zod sont rédigés en français et
 * nomment le champ fautif (« Motif obligatoire », « Code à 4 à 6 chiffres »).
 * C'est la seule information qui dit à l'opérateur quoi corriger.
 *
 * Le message de l'API ensuite : les exceptions métier portent une phrase
 * écrite pour être lue (« Ce code n'autorise aucune remise »).
 *
 * Le repli en dernier. Et « Validation failed » est explicitement écarté :
 * c'est le libellé générique que Nest pose quand aucun schéma n'a parlé — en
 * anglais, devant quelqu'un qui ne saura jamais quel champ a été refusé. Trois
 * écrans l'affichaient tel quel dans un toast de deux secondes.
 */

/** Le libellé générique de Nest, qui n'apprend rien à personne. */
const GENERIQUE = 'Validation failed';

/**
 * Choisit le message à afficher parmi ce que porte une réponse d'erreur.
 *
 * `body` est le corps JSON du refus (`{ issues: [{ message }] }` pour un refus
 * zod), `message` le message de l'exception, `repli` la phrase de l'écran.
 */
export function messageDeRefus(body: unknown, message: unknown, repli: string): string {
  const issues = (body as { issues?: unknown } | null | undefined)?.issues;
  const premier = Array.isArray(issues) ? issues[0] : null;
  const zod = (premier as { message?: unknown } | null)?.message;
  if (typeof zod === "string" && zod.trim()) return zod.trim();

  const brut = typeof message === "string" ? message.trim() : "";
  return brut && brut !== GENERIQUE ? brut : repli;
}
