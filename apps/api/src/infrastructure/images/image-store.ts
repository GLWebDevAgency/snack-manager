/**
 * PORT DE STOCKAGE D'IMAGES — les fichiers de marque des établissements.
 *
 * Le logo d'une enseigne est consommé partout (caisse, cuisine, board TV,
 * page de commande, tickets) mais n'avait aucun endroit où EXISTER : le champ
 * `logoUrl` restait `null` faute d'hébergement, et l'écran Paramètres du
 * gérant promettait « bientôt » (diagnostic quatre casquettes, fiche 10).
 *
 * Ce port ne connaît que trois gestes — poser, lire, retirer un objet — et
 * des octets. Le choix du fournisseur (R2 aujourd'hui) et la politique
 * d'images (formats admis, taille, clefs) vivent ailleurs : le fournisseur
 * dans la fabrique, la politique dans le module tenants, qui est le seul à
 * savoir ce qu'est « un logo ».
 */
export interface ImageStore {
  /** `false` : aucun fournisseur configuré — les gestes d'envoi refusent. */
  readonly enabled: boolean;
  readonly providerName: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** `null` : l'objet n'existe pas (ou le magasin est désactivé). */
  get(key: string): Promise<Buffer | null>;
  /** Idempotent : retirer un objet déjà absent n'est pas une erreur. */
  delete(key: string): Promise<void>;
}

/**
 * Magasin au repos — variables absentes. `put` LÈVE au lieu de faire
 * semblant : un envoi qui « réussit » sans rien stocker fabriquerait un
 * lien mort sur les tickets, précisément ce que cette fonctionnalité
 * existe pour empêcher. Les contrôleurs vérifient `enabled` avant.
 */
export class NoopImageStore implements ImageStore {
  readonly enabled = false;
  readonly providerName = 'aucun';

  put(): Promise<void> {
    return Promise.reject(new Error("Magasin d'images désactivé — aucun fournisseur configuré"));
  }

  get(): Promise<Buffer | null> {
    return Promise.resolve(null);
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }
}
