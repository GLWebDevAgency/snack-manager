/**
 * QUELLE RÉVISION CETTE API SERT-ELLE ?
 *
 * La question n'avait pas de réponse : on la déduisait de l'identifiant de
 * déploiement Railway, c'est-à-dire d'un autre système, à la main. `GET /health`
 * la rend triviale, et permet au contrôle de santé d'AFFIRMER que la version en
 * ligne est celle qu'on vient de pousser — au lieu de constater qu'il y a
 * quelque chose qui répond.
 *
 * ── La variable a été CHERCHÉE, pas devinée ─────────────────────────────────
 *
 * Le réflexe est de lire `RAILWAY_GIT_COMMIT_SHA`. Sur ce projet, elle
 * N'EXISTE PAS. Relevé le 20 août 2026 dans le conteneur `api` de staging
 * (`railway ssh --service api --environment staging printenv`) :
 *
 *     RAILWAY_DEPLOYMENT_ID=bbe5e37a-…      ← présente
 *     RAILWAY_ENVIRONMENT_NAME=staging      ← présente
 *     RAILWAY_GIT_REPO_OWNER=               ← présente et VIDE
 *     (aucune RAILWAY_GIT_COMMIT_SHA)
 *
 * La famille `RAILWAY_GIT_*` n'est renseignée que pour un service branché sur
 * un dépôt GitHub. Ici les mises en ligne partent de `railway up` (téléversement
 * depuis GitHub Actions) : Railway ne connaît aucun commit, et la variable reste
 * absente ou vide. Une route qui l'aurait lue seule aurait répondu « inconnue »
 * pour toujours, sans que rien ne le signale.
 *
 * D'où les deux sources, dans cet ordre :
 *
 *   1. `SM_REVISION` — POSÉE PAR NOUS. `deploy.yml` l'écrit sur le service
 *      Railway juste avant `railway up` (`railway variables --set … --skip-deploys`),
 *      donc le déploiement créé juste après la sert. C'est la source réelle.
 *   2. `RAILWAY_GIT_COMMIT_SHA` — si le service est un jour rebranché sur le
 *      dépôt GitHub, elle apparaîtra toute seule et prendra le relais.
 *
 * ── Et quand il n'y en a aucune ─────────────────────────────────────────────
 *
 * En développement local, aucune des deux n'existe : `revision` vaut `null` et
 * la route répond quand même 200. Un contrôle de santé qui tombe parce qu'on
 * travaille sur son poste n'est pas un contrôle de santé.
 *
 * ⚠️ Une valeur VIDE compte comme absente — c'est le cas réel de
 * `RAILWAY_GIT_REPO_OWNER=` ci-dessus. Sans ce `trim()`, `revisionCourte`
 * vaudrait `''` et le contrôle comparerait deux chaînes vides avec succès.
 *
 * Voir docs/CI-CD.md § 11 et § 13.
 */

/** Les variables lues, dans l'ordre. La première non vide gagne. */
export const SOURCES_REVISION = ['SM_REVISION', 'RAILWAY_GIT_COMMIT_SHA'] as const;

/**
 * Horodatage du chargement du module, c'est-à-dire du démarrage du processus.
 * Fixe pour toute la durée de vie du conteneur : deux appels à `/health` qui
 * rendent deux valeurs différentes signalent un redémarrage entre les deux.
 */
const DEMARRE_LE = new Date().toISOString();

export type RevisionServie = {
  /** Le SHA complet, ou `null` si aucune source ne le publie. */
  revision: string | null;
  /** Les sept premiers caractères — ce qu'on lit à l'œil nu. */
  revisionCourte: string | null;
  /** `staging`, `production`, ou `null` hors de Railway. */
  environnement: string | null;
  /** L'identifiant Railway, conservé : c'est lui qui sert au retour arrière. */
  deploiement: string | null;
  demarreLe: string;
};

function premiereNonVide(env: NodeJS.ProcessEnv, cles: readonly string[]): string | null {
  for (const cle of cles) {
    const valeur = env[cle]?.trim();
    if (valeur) return valeur;
  }
  return null;
}

export function revisionServie(env: NodeJS.ProcessEnv = process.env): RevisionServie {
  const revision = premiereNonVide(env, SOURCES_REVISION);
  return {
    revision,
    revisionCourte: revision ? revision.slice(0, 7) : null,
    environnement: env.RAILWAY_ENVIRONMENT_NAME?.trim() || null,
    deploiement: env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    demarreLe: DEMARRE_LE,
  };
}
