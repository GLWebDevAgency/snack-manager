import { describe, expect, it } from 'vitest';
import { REMISE_PLAFOND_CENTS } from '@sm/contracts';
import {
  SERVICE_STATUSES,
  commandesEnCours,
  depasseLePlafond,
  estEnCours,
  grouperParStatut,
  heureCourte,
  plafondRemise,
  pourcentageParDefaut,
  roleStaff,
  versCommande,
  type ServerOrderRow,
} from './service-state';

const MINUIT = new Date('2026-09-03T00:00:00').getTime();
const MAINTENANT = new Date('2026-09-03T12:30:00').getTime();

function ligne(over: Partial<ServerOrderRow> & { _id: string }): ServerOrderRow {
  return {
    number: 1,
    clientId: `c-${over._id}`,
    status: 'new',
    channel: 'pos',
    type: 'surplace',
    createdAt: new Date(MINUIT + 11 * 3_600_000).toISOString(),
    totals: { subtotal: 1200, total: 1200 },
    payment: { status: 'paid', tender: 'card' },
    ...over,
  };
}

/** Commande passée à `h` heures `m` minutes, heure locale du poste. */
function a(h: number, m = 0): string {
  return new Date(MINUIT + h * 3_600_000 + m * 60_000).toISOString();
}

describe('ce qui compte comme « en cours »', () => {
  it('retient reçue, en préparation et prête', () => {
    expect(estEnCours('new')).toBe(true);
    expect(estEnCours('preparing')).toBe(true);
    expect(estEnCours('ready')).toBe(true);
  });

  it('exclut les remises et les annulées — ni l’une ni l’autre n’attend au comptoir', () => {
    expect(estEnCours('delivered')).toBe(false);
    expect(estEnCours('cancelled')).toBe(false);
  });

  it('exclut par défaut un statut inconnu, plutôt que de gonfler la pastille', () => {
    // Liste blanche : un statut ajouté demain au contrat ne devient pas
    // « en cours » sans que personne ne l'ait décidé.
    expect(estEnCours('en_livraison')).toBe(false);
    expect(estEnCours(undefined)).toBe(false);
  });
});

describe('l’ordre de la vue du service', () => {
  it('met les PRÊTES en tête : ce sont elles qu’on appelle au comptoir', () => {
    expect(SERVICE_STATUSES).toEqual(['ready', 'preparing', 'new']);
  });

  it('groupe par statut, puis par ancienneté dans chaque groupe', () => {
    const rows = [
      ligne({ _id: 'a', number: 1, status: 'new', createdAt: a(11, 0) }),
      ligne({ _id: 'b', number: 2, status: 'ready', createdAt: a(11, 30) }),
      ligne({ _id: 'c', number: 3, status: 'preparing', createdAt: a(11, 10) }),
      ligne({ _id: 'd', number: 4, status: 'ready', createdAt: a(11, 5) }),
    ];
    const ordre = commandesEnCours(rows, MAINTENANT).map((c) => c.number);
    // Les deux prêtes d'abord (la plus ancienne en tête), puis la préparation,
    // puis la reçue.
    expect(ordre).toEqual([4, 2, 3, 1]);
  });

  it('écarte remis et annulé, mais garde une active antérieure au reset local', () => {
    const rows = [
      ligne({ _id: 'a', number: 1, status: 'delivered', createdAt: a(12) }),
      ligne({ _id: 'b', number: 2, status: 'cancelled', createdAt: a(12) }),
      // Le journal local a été vidé à 15 h, mais cette commande reste à
      // appeler : elle doit rester dans la vue opérationnelle.
      ligne({ _id: 'c', number: 3, status: 'ready', createdAt: a(11) }),
      ligne({ _id: 'd', number: 4, status: 'ready', createdAt: a(19) }),
    ];
    expect(commandesEnCours(rows, MAINTENANT).map((c) => c.number)).toEqual([3, 4]);
  });

  it('reste STABLE : le tri ne dépend jamais de l’horloge du rendu', () => {
    const rows = [
      ligne({ _id: 'a', number: 1, status: 'preparing', createdAt: a(11, 0) }),
      ligne({ _id: 'b', number: 2, status: 'preparing', createdAt: a(11, 4) }),
      ligne({ _id: 'c', number: 3, status: 'preparing', createdAt: a(11, 8) }),
    ];
    // Le minuteur avance de dix minutes : l'ordre à l'écran ne bouge pas d'un
    // cran. C'est ce qui empêche une carte de sauter sous le doigt.
    const avant = commandesEnCours(rows, MAINTENANT).map((c) => c.id);
    const apres = commandesEnCours(rows, MAINTENANT + 600_000).map((c) => c.id);
    expect(apres).toEqual(avant);
  });

  it('départage deux commandes de la même seconde de façon déterministe', () => {
    const rows = [
      ligne({ _id: 'zz', number: 9, status: 'new', createdAt: a(11) }),
      ligne({ _id: 'aa', number: 8, status: 'new', createdAt: a(11) }),
    ];
    // Sans ce départage, deux cartes permuteraient à chaque rafraîchissement.
    expect(commandesEnCours(rows, MAINTENANT).map((c) => c.id)).toEqual(['aa', 'zz']);
  });

  it('garde les groupes vides pour que la liste ne saute pas', () => {
    const groupes = grouperParStatut(
      commandesEnCours([ligne({ _id: 'a', status: 'new' })], MAINTENANT),
    );
    expect(groupes.map((g) => g.status)).toEqual(['ready', 'preparing', 'new']);
    expect(groupes.map((g) => g.commandes.length)).toEqual([0, 0, 1]);
  });
});

describe('la projection d’une ligne serveur', () => {
  it('rend les libellés français du contrat, pas les clés techniques', () => {
    const c = versCommande(
      ligne({ _id: 'a', status: 'preparing', channel: 'online', type: 'pickup' }),
      MAINTENANT,
    );
    expect(c.statusLabel).toBe('En préparation');
    expect(c.channelLabel).toBe('En ligne');
    expect(c.typeLabel).toBe('Retrait');
  });

  it('repère la commande par le nom du client, sinon par son créneau', () => {
    const nomme = versCommande(
      ligne({
        _id: 'a',
        pickup: { slot: a(12, 45), customerName: 'Karim' },
      }),
      MAINTENANT,
    );
    expect(nomme.reperage).toBe('Karim');

    const anonyme = versCommande(
      ligne({ _id: 'b', pickup: { slot: a(12, 45), customerName: '  ' } }),
      MAINTENANT,
    );
    expect(anonyme.reperage).toBe('Retrait 12:45');

    // Vente au comptoir : rien à annoncer d'autre que le numéro.
    expect(versCommande(ligne({ _id: 'c' }), MAINTENANT).reperage).toBeNull();
  });

  it('retombe sur l’horloge du rendu quand la date est absente ou illisible', () => {
    // Sans ce repli, le minuteur partirait de 1970 : « 29 000 000 min » en
    // rouge vif sur une commande qui vient d'arriver.
    expect(versCommande(ligne({ _id: 'a', createdAt: undefined }), MAINTENANT).createdAtMs).toBe(
      MAINTENANT,
    );
    expect(versCommande(ligne({ _id: 'b', createdAt: 'pas une date' }), MAINTENANT).createdAtMs).toBe(
      MAINTENANT,
    );
  });

  it('dit si la commande est déjà encaissée', () => {
    expect(versCommande(ligne({ _id: 'a' }), MAINTENANT).paid).toBe(true);
    expect(
      versCommande(ligne({ _id: 'b', payment: { status: 'pending', tender: null } }), MAINTENANT)
        .paid,
    ).toBe(false);
  });

  it('formate un créneau en heure murale, et rend null sur une date absurde', () => {
    expect(heureCourte(a(9, 5))).toBe('09:05');
    expect(heureCourte('n’importe quoi')).toBeNull();
    expect(heureCourte(null)).toBeNull();
  });
});

describe('le plafond de remise du rôle ouvert sur le poste', () => {
  it('lit le plafond du contrat plutôt que d’en recopier un', () => {
    expect(plafondRemise('caisse').cents).toBe(REMISE_PLAFOND_CENTS.caisse);
    expect(plafondRemise('gerant').cents).toBeNull();
    expect(plafondRemise('cuisine').aucun).toBe(true);
  });

  it('formule le plafond comme le serveur le formulerait', () => {
    expect(plafondRemise('caisse').label).toBe('15,00 € maximum');
    expect(plafondRemise('gerant').label).toBe('sans plafond');
  });

  it('traite un rôle inconnu comme le plus RESTREINT', () => {
    // Session persistée par un ancien bundle, ou rôle ajouté côté serveur :
    // face à l'inconnu sur un plafond d'argent, on serre, on ne desserre pas.
    expect(roleStaff('archiviste')).toBe('cuisine');
    expect(roleStaff(undefined).length).toBeGreaterThan(0);
    expect(plafondRemise(null).cents).toBe(0);
  });

  it('reconnaît le dépassement — le cas exact du défaut corrigé', () => {
    const caisse = plafondRemise('caisse');
    // Commande à 100 €, remise de 20 % = 20 € : au-dessus des 15 € d'un code
    // caisse. L'écran proposait ce bouton et le serveur refusait après coup.
    expect(depasseLePlafond(2000, caisse)).toBe(true);
    expect(depasseLePlafond(1500, caisse)).toBe(false);
    // Le gérant n'a pas de plafond : rien ne le dépasse.
    expect(depasseLePlafond(50_000, plafondRemise('gerant'))).toBe(false);
  });

  it('ouvre la modale sur la plus forte proposition qui tienne sous le plafond', () => {
    const caisse = plafondRemise('caisse');
    // 100 € : 5 % = 5 €, 10 % = 10 €, 20 % = 20 € → on ouvre sur 10 %.
    expect(pourcentageParDefaut(10_000, [5, 10, 20], caisse)).toBe(10);
    // 20 € : les trois tiennent → on garde la plus forte proposée.
    expect(pourcentageParDefaut(2000, [5, 10, 20], caisse)).toBe(20);
    // 400 € : même 5 % (20 €) dépasse → aucune présélection, montant libre.
    expect(pourcentageParDefaut(40_000, [5, 10, 20], caisse)).toBeNull();
    // Le gérant garde toujours la proposition la plus forte.
    expect(pourcentageParDefaut(40_000, [5, 10, 20], plafondRemise('gerant'))).toBe(20);
  });
});
