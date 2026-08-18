import type { DomainStatus } from '@sm/domain';

/**
 * Traduction « nom de domaine » → « ce que le restaurateur doit taper chez son
 * hébergeur DNS ».
 *
 * C'est le point où l'on perd le plus de clients à l'installation : personne ne
 * sait ce qu'est un CNAME, et chaque panneau (OVH, Gandi, Ionos) demande le
 * champ sous une forme différente — les uns veulent l'étiquette seule
 * (« commander »), les autres le nom complet (« commander.classfood.fr »). On
 * calcule donc les DEUX et l'écran les affiche côte à côte.
 */
export interface DnsInstruction {
  readonly type: 'CNAME';
  /** Étiquette attendue par OVH & Gandi : « commander ». */
  readonly name: string;
  /** Nom complet attendu par certains panneaux : « commander.classfood.fr ». */
  readonly fullName: string;
  /** Valeur à recopier — la cible fournie par notre hébergeur. */
  readonly value: string;
  /** TTL conseillé, en secondes : 1 h suffit, un TTL court retarde la propagation. */
  readonly ttl: number;
}

/**
 * Suffixes publics à deux étiquettes que l'on croise chez nos clients.
 * Sans cette liste, « commander.classfood.co.uk » donnerait l'étiquette
 * « commander.classfood » au lieu de « commander ».
 */
const TWO_LABEL_SUFFIXES = new Set([
  'asso.fr',
  'com.fr',
  'tm.fr',
  'nom.fr',
  'gouv.fr',
  'co.uk',
  'org.uk',
  'com.au',
  'net.au',
  'com.br',
  'co.jp',
]);

/**
 * Étiquette à saisir dans la zone DNS, c'est-à-dire le nom d'hôte privé du
 * domaine racine. « @ » signale la racine : cas théorique ici, `PublicDomain`
 * refuse déjà les domaines racine — sauf sous suffixe à deux étiquettes.
 */
export function dnsRecordName(hostname: string): string {
  const labels = hostname.split('.');
  const suffixSize = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(0, Math.max(0, labels.length - suffixSize)).join('.') || '@';
}

export function dnsInstructionFor(hostname: string, target: string): DnsInstruction {
  return {
    type: 'CNAME',
    name: dnsRecordName(hostname),
    fullName: hostname,
    value: target,
    ttl: 3600,
  };
}

/** Libellés d'état — le restaurateur lit « En attente DNS », pas « pending_dns ». */
export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  pending_dns: 'En attente DNS',
  issuing_certificate: 'Certificat en cours',
  active: 'Actif',
  failed: 'Échec',
};
