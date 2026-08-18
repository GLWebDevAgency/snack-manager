/**
 * Formes renvoyées par `GET /site/domains` et `POST /site/domains`.
 *
 * Le libellé d'état et l'instruction DNS sont CALCULÉS PAR L'API : cet écran
 * les affiche sans les redériver, sinon la même règle vivrait des deux côtés
 * et finirait par diverger le jour d'un changement d'hébergeur.
 */

export type DomainStatus =
  | "pending_dns"
  | "issuing_certificate"
  | "active"
  | "failed";

export type DnsInstruction = {
  type: "CNAME";
  /** Étiquette attendue par OVH & Gandi : « commander ». */
  name: string;
  /** Nom complet attendu par d'autres panneaux : « commander.classfood.fr ». */
  fullName: string;
  value: string;
  ttl: number;
};

export type DomainView = {
  id: string;
  hostname: string;
  url: string;
  status: DomainStatus;
  statusLabel: string;
  isPrimary: boolean;
  addedAt: string;
  lastCheckedAt: string | null;
  /** Cause lisible d'un échec, renvoyée par le fournisseur. */
  detail: string | null;
  dns: DnsInstruction;
};

export type SiteAddresses = {
  subdomain: { hostname: string; url: string };
  domains: DomainView[];
  /** `null` = aucun fournisseur de domaines sur cet environnement. */
  provider: string | null;
};

/**
 * Domaine racine saisi ? On le détecte AVANT l'appel API pour proposer la
 * correction sans aller-retour. Un domaine racine (« classfood.fr ») ne peut
 * pas porter de CNAME : c'est une contrainte des DNS, pas un choix de notre
 * part — et le pointer chez nous casserait la messagerie du restaurant.
 */
export function apexSuggestion(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleaned)) return null;
  return cleaned.split(".").length === 2 ? `commander.${cleaned}` : null;
}

/** Domaine facturé chez l'hébergeur DNS, celui dont il faut ouvrir la zone. */
export function dnsZoneOf(dns: DnsInstruction): string {
  return dns.name === "@" ? dns.fullName : dns.fullName.slice(dns.name.length + 1);
}
