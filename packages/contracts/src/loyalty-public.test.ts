import { describe, expect, it } from 'vitest';
import { publicLoyaltyAvailable } from './admin';
import { aLaCapacite, type SouscriptionLue } from './capacites';
import {
  loyaltyCardDeepLink,
  loyaltyTokenFromQrPayload,
} from './loyalty-public';

const TOKEN = 'A'.repeat(43);

describe('payload QR fidélité', () => {
  it('lit un jeton brut ou une deep-link dont le secret reste dans le fragment', () => {
    expect(loyaltyTokenFromQrPayload(TOKEN, 'classfood')).toBe(TOKEN);
    const link = loyaltyCardDeepLink('https://snackmanager.fr/', 'classfood', TOKEN);
    expect(link).toBe(
      `https://snackmanager.fr/r/classfood/fidelite#card=${TOKEN}`,
    );
    expect(new URL(link).search).toBe('');
    expect(loyaltyTokenFromQrPayload(link, 'classfood')).toBe(TOKEN);
  });

  it('refuse un autre restaurant, une query string et les protocoles actifs', () => {
    expect(
      loyaltyTokenFromQrPayload(
        `https://snackmanager.fr/r/autre/fidelite#card=${TOKEN}`,
        'classfood',
      ),
    ).toBeNull();
    expect(
      loyaltyTokenFromQrPayload(
        `https://snackmanager.fr/r/classfood/fidelite?card=${TOKEN}`,
        'classfood',
      ),
    ).toBeNull();
    expect(loyaltyTokenFromQrPayload(`javascript:#card=${TOKEN}`)).toBeNull();
  });

  it('refuse de construire un lien depuis une entrée invalide', () => {
    expect(() => loyaltyCardDeepLink('https://snackmanager.fr', '../admin', TOKEN))
      .toThrow();
    expect(() => loyaltyCardDeepLink('javascript:', 'classfood', TOKEN)).toThrow();
    expect(() => loyaltyCardDeepLink('https://snackmanager.fr', 'classfood', 'court'))
      .toThrow();
  });
});

/**
 * LA RÈGLE D'ACCÈS AU PROGRAMME PUBLIC — la matrice complète.
 *
 * `publicLoyaltyAvailable` vit dans `admin.ts`, avec la doctrine de la
 * suspension, mais c'est la surface PUBLIQUE DE FIDÉLITÉ qu'elle décide : elle
 * se vérifie donc ici, à côté du reste de cette surface.
 *
 * La capacité arrive en booléen déjà calculé (`aLaCapacite(tenant, 'loyalty')`
 * côté appelant) : ces cas-là partent donc du tenant, pour épingler ce que la
 * grille tarifaire fait vraiment au pilote et à ses voisins.
 */
describe('accès public au programme de fidélité', () => {
  const souscrite = (tenant: SouscriptionLue) => aLaCapacite(tenant, 'loyalty');
  const DEROGATION_ACCORDEE = {
    capacite: 'loyalty',
    sens: 'accordee',
    motif: 'Programme du pilote, ouvert hors formule',
    auteur: 'Équipe Snack Manager',
    le: '2026-09-03T09:00:00.000Z',
  };

  it('sert un compte actif dont la formule comprend la fidélité', () => {
    expect(publicLoyaltyAvailable({ status: 'active' }, souscrite({ plan: 'boost' }))).toBe(true);
  });

  it('ferme un compte SUSPENDU, quelle que soit sa formule', () => {
    // Le porteur n'est pour rien dans l'impayé — mais un solde qui annonce des
    // récompenses « à portée » envoie à un comptoir qui ne peut en honorer
    // aucune : la caisse d'un compte suspendu est fermée (`SessionAccess`).
    expect(publicLoyaltyAvailable({ status: 'suspended' }, souscrite({ plan: 'boost' }))).toBe(
      false,
    );
  });

  it('sert un ESSAI dont le terme est passé — un terme atteint ne ferme rien', () => {
    // `statutEffectif` en fait un compte ACTIF (donc facturable) et
    // `isAccessBlocked` répond faux aux deux : rien à fermer, ni avant ni après
    // la réconciliation de la passe mensuelle.
    expect(publicLoyaltyAvailable({ status: 'trial' }, souscrite({ plan: 'boost' }))).toBe(true);
    expect(publicLoyaltyAvailable({ status: 'churned' }, souscrite({ plan: 'boost' }))).toBe(true);
    // Le parc d'avant le champ `account` : un statut jamais écrit n'a jamais
    // fermé un restaurant, et ce n'est pas cette règle qui commencera.
    expect(publicLoyaltyAvailable(null, souscrite({ plan: 'boost' }))).toBe(true);
    expect(publicLoyaltyAvailable({}, souscrite({ plan: 'boost' }))).toBe(true);
  });

  it('ferme un restaurant qui n’a pas acheté la fidélité — Complet ne la comprend pas', () => {
    // LE PIÈGE DE DÉPLOIEMENT, épinglé : le pilote tourne en Complet.
    expect(publicLoyaltyAvailable({ status: 'active' }, souscrite({ plan: 'complet' }))).toBe(
      false,
    );
    expect(publicLoyaltyAvailable({ status: 'active' }, souscrite({ plan: 'essentiel' }))).toBe(
      false,
    );
    // La nouvelle offre commande comprend la fidélité, sans double abonnement.
    expect(
      publicLoyaltyAvailable({ status: 'active' }, souscrite({ plan: null, onlineOrdering: true })),
    ).toBe(true);
  });

  it('sert une fidélité ACCORDÉE hors formule, et referme dès qu’elle est levée', () => {
    const pilote = { plan: 'complet', derogationsCapacite: [DEROGATION_ACCORDEE] };
    expect(publicLoyaltyAvailable({ status: 'active' }, souscrite(pilote))).toBe(true);
    // La levée efface la ligne : la capacité revient à ce que la formule en dit.
    expect(
      publicLoyaltyAvailable({ status: 'active' }, souscrite({ ...pilote, derogationsCapacite: [] })),
    ).toBe(false);
    // Une dérogation ne survit pas à une suspension : les deux conditions sont
    // un ET, et c'est la plus fermante qui l'emporte.
    expect(publicLoyaltyAvailable({ status: 'suspended' }, souscrite(pilote))).toBe(false);
  });

  it('ferme une fidélité RETIRÉE malgré la formule', () => {
    // Un retrait l'emporte toujours sur ce que Boost comprend.
    expect(
      publicLoyaltyAvailable(
        { status: 'active' },
        souscrite({
          plan: 'boost',
          derogationsCapacite: [
            { ...DEROGATION_ACCORDEE, sens: 'retiree', motif: 'Retirée le temps du litige' },
          ],
        }),
      ),
    ).toBe(false);
  });
});
