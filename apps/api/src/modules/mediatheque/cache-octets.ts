/**
 * CACHE D'OCTETS BORNÉ — la différence, minuscule et vitale, avec le logo.
 *
 * `LogoService` garde ses octets dans une `Map` sans borne, et c'est sans
 * risque : un tenant a UN logo d'au plus 512 Ko, donc le pire cas se compte en
 * mégaoctets pour tout le parc. Une médiathèque n'a pas cette propriété — un
 * restaurant peut y poser 256 Mio (son quota), et le même cache naïf ferait
 * tomber l'API sur mémoire épuisée dès qu'un service consulterait la carte.
 *
 * D'où un budget en OCTETS, et une éviction du plus anciennement SERVI.
 * Concrètement, le cache tient les photos de la carte réellement consultée —
 * quelques dizaines de clichés d'un ou deux restaurants en service — et rend
 * ce qui dort. Le coût d'un défaut de cache est une lecture R2 ; le coût de
 * l'absence de cache serait une lecture R2 par vignette et par visiteur, sur
 * une API REST limitée en débit.
 *
 * Une entrée n'est JAMAIS invalidée : la clé porte l'empreinte du contenu,
 * donc des octets différents ont une clé différente. C'est plus fort que la
 * ruse du logo (la version dans l'URL), et c'est le §3 du modèle qui le donne.
 */
export class CacheOctets<T extends { corps: Buffer }> {
  /** `Map` : l'ordre d'insertion EST l'ordre d'éviction, sans structure de plus. */
  private readonly entrees = new Map<string, T>();
  private octets = 0;

  constructor(private readonly budgetOctets: number) {}

  get taille(): number {
    return this.entrees.size;
  }

  get poids(): number {
    return this.octets;
  }

  get(cle: string): T | undefined {
    const entree = this.entrees.get(cle);
    if (entree === undefined) return undefined;
    // Réinsérée pour repartir en queue : ce qu'on sert reste, ce qu'on ne sert
    // plus s'en va. Sans ce geste, la première carte chargée après un
    // redémarrage évincerait celle qui est en service.
    this.entrees.delete(cle);
    this.entrees.set(cle, entree);
    return entree;
  }

  set(cle: string, valeur: T): void {
    const existante = this.entrees.get(cle);
    if (existante) this.octets -= existante.corps.length;
    this.entrees.delete(cle);

    // Un fichier plus gros que le budget entier n'est pas mis en cache : le
    // garder viderait tout le reste pour lui seul.
    if (valeur.corps.length > this.budgetOctets) return;

    this.entrees.set(cle, valeur);
    this.octets += valeur.corps.length;

    while (this.octets > this.budgetOctets) {
      const plusAncienne = this.entrees.keys().next();
      if (plusAncienne.done) break;
      this.supprimer(plusAncienne.value);
    }
  }

  /** Un média retiré : ses octets ne doivent plus sortir d'ici. */
  supprimer(cle: string): void {
    const entree = this.entrees.get(cle);
    if (!entree) return;
    this.octets -= entree.corps.length;
    this.entrees.delete(cle);
  }
}
