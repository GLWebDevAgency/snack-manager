/**
 * AMORÇAGE DE DÉMONSTRATION — autorisé nulle part par défaut.
 *
 * Deux services du CRM écrivent des données d'exemple quand leur collection
 * est vide : le pipeline commercial (`CrmService`) et l'historique de
 * facturation (`BillingService`). C'est confortable sur un environnement de
 * travail — on ouvre l'écran, il y a quelque chose à voir.
 *
 * En production, c'est un piège. Le jour où l'on vide la base pour démarrer
 * proprement, la PREMIÈRE ouverture du back-office la repeuple de leads
 * fictifs et de factures inventées, sans rien demander à personne. La purge
 * s'annule toute seule, et l'on découvre « Pizza Vita » dans son pipeline le
 * jour du lancement.
 *
 * D'où l'inversion : l'amorçage n'est actif que si `SM_DEMO_SEED=on` est
 * posé EXPLICITEMENT. Un environnement qui ne dit rien n'écrit rien. On
 * accepte que quelqu'un doive ajouter une variable pour retrouver son
 * confort ; on n'accepte pas que la production se remplisse de fiction parce
 * qu'une variable manquait.
 *
 * Posé sur : le `.env` local et l'environnement Railway `staging`.
 * Absent de : `production`.
 */
export function demoSeedEnabled(): boolean {
  return process.env.SM_DEMO_SEED?.trim().toLowerCase() === 'on';
}
