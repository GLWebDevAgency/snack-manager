import { describe, expect, it } from 'vitest';
import { dnsInstructionFor, dnsRecordName } from './dns-instruction';

describe('Instruction DNS', () => {
  it("l'étiquette à saisir chez l'hébergeur est le sous-domaine seul", () => {
    // OVH et Gandi affichent déjà « .classfood.fr » à droite du champ : y
    // recopier le nom complet crée « commander.classfood.fr.classfood.fr ».
    expect(dnsRecordName('commander.classfood.fr')).toBe('commander');
  });

  it('un sous-domaine à deux niveaux garde ses deux étiquettes', () => {
    expect(dnsRecordName('commande.en-ligne.classfood.fr')).toBe('commande.en-ligne');
  });

  it("une extension à deux étiquettes ne fait pas dériver l'étiquette", () => {
    // Sans la liste des suffixes publics, on répondrait « commander.classfood ».
    expect(dnsRecordName('commander.classfood.co.uk')).toBe('commander');
    expect(dnsRecordName('commander.snack.com.br')).toBe('commander');
  });

  it('un nom déjà à la racine de son suffixe est signalé par @', () => {
    // « classfood.asso.fr » a trois étiquettes mais reste une racine : le
    // restaurateur doit voir que quelque chose cloche, pas un nom plausible.
    expect(dnsRecordName('classfood.asso.fr')).toBe('@');
  });

  it("l'instruction porte les deux formes attendues par les hébergeurs", () => {
    const dns = dnsInstructionFor('commander.classfood.fr', 'sm-prod.up.railway.app');
    expect(dns.type).toBe('CNAME');
    expect(dns.name).toBe('commander');
    expect(dns.fullName).toBe('commander.classfood.fr');
    expect(dns.value).toBe('sm-prod.up.railway.app');
    expect(dns.ttl).toBe(3600);
  });
});
