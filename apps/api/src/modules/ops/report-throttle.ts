/**
 * Limiteur de débit du guichet public d'erreurs.
 *
 * La route `POST /public/client-errors` est ouverte au monde : sans garde,
 * une page en boucle d'erreur — ou un plaisantin — écrirait au rythme de sa
 * connexion. Fenêtre glissante par clé (l'adresse IP), en mémoire : la
 * protection vaut par processus, ce qui suffit ici puisque l'écriture en base
 * est elle-même dédupliquée par empreinte — le limiteur protège la base de
 * la CHARGE, l'empreinte la protège du VOLUME.
 *
 * Le plafond de clés borne la mémoire : au-delà, les clés les plus anciennes
 * sont sacrifiées — un rapporteur légitime re-remplira la sienne au prochain
 * envoi, personne ne s'en aperçoit.
 */
export class ReportThrottle {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = 30,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 2_000,
  ) {}

  allow(key: string, now: number): boolean {
    const floor = now - this.windowMs;
    const stamps = (this.hits.get(key) ?? []).filter((t) => t > floor);
    if (stamps.length >= this.limit) {
      this.hits.set(key, stamps);
      return false;
    }
    stamps.push(now);
    // Réinsertion en fin de Map : l'ordre d'itération devient un LRU gratuit.
    this.hits.delete(key);
    this.hits.set(key, stamps);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return true;
  }
}
