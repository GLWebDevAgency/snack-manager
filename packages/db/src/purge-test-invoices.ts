/**
 * Ancienne réparation ponctuelle, définitivement retirée.
 * La borne « numéro > 3 » n'identifie pas des données de test et remettre le
 * compteur en arrière invaliderait les réservations durables d'émission.
 * Ce fichier reste comme garde explicite pour les anciens raccourcis opérateur.
 * Aucun environnement n'est chargé et aucune connexion à la base n'est ouverte.
 */
export function retiredInvoicePurge(): never {
  throw new Error('Purge historique retirée : aucune facture ni séquence ne peut être effacée par ce script. Utilisez un rapprochement explicite des pièces et réservations, jamais une borne de numéro.');
}

if (require.main === module) {
  try { retiredInvoicePurge(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Purge historique retirée.');
    process.exitCode = 1;
  }
}
