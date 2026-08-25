import { describe, expect, it } from 'vitest';
import {
  ENCAISSEMENT_ETATS,
  EncaissementCompteSchema,
  etatDuCompte,
  peutEncaisserEnLigne,
  raisonIndisponibilite,
  type EncaissementCompte,
} from './encaissement';

/**
 * L'ÉTAT D'UN COMPTE CONNECTÉ NE SE STOCKE PAS, IL SE DÉDUIT.
 *
 * Stripe est la seule source de vérité sur la capacité d'un marchand à
 * encaisser : nous recopions ses drapeaux (`chargesEnabled`, `detailsSubmitted`)
 * et nous en DÉRIVONS l'état affiché. Un état stocké en toutes lettres
 * divergerait au premier changement chez Stripe — et un restaurant afficherait
 * « actif » pendant que ses paiements sont refusés.
 *
 * Ces tests verrouillent la seule règle qui compte en service : `peutEncaisser`
 * est VRAI uniquement quand Stripe l'autorise. Tout le reste dégrade vers le
 * paiement au comptoir, jamais vers une erreur.
 */

const compte = (over: Partial<EncaissementCompte> = {}): EncaissementCompte => ({
  accountId: 'acct_1234567890',
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  raccordeLe: '2026-08-25T10:00:00.000Z',
  synchroniseLe: '2026-08-25T10:00:00.000Z',
  ...over,
});

describe('l’état d’un compte d’encaissement', () => {
  it('aucun compte : « absent » — et le comptoir reste la seule voie', () => {
    expect(etatDuCompte(null)).toBe('absent');
    expect(peutEncaisserEnLigne(null)).toBe(false);
  });

  it('compte créé mais dossier non déposé : « en_cours »', () => {
    const c = compte({ detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false });
    expect(etatDuCompte(c)).toBe('en_cours');
    expect(peutEncaisserEnLigne(c)).toBe(false);
  });

  it('dossier déposé mais encaissement refusé par Stripe : « restreint »', () => {
    // Cas réel : pièce d'identité en cours de revue, ou justificatif rejeté.
    const c = compte({ chargesEnabled: false });
    expect(etatDuCompte(c)).toBe('restreint');
    expect(peutEncaisserEnLigne(c)).toBe(false);
  });

  it('Stripe autorise l’encaissement : « actif » — et lui seul encaisse', () => {
    expect(etatDuCompte(compte())).toBe('actif');
    expect(peutEncaisserEnLigne(compte())).toBe(true);
  });

  it('encaissement ouvert mais virements suspendus : actif quand même', () => {
    // Les virements se débloquent souvent après la première transaction : ce
    // n'est pas au client final d'en pâtir — l'argent est bien encaissé.
    const c = compte({ payoutsEnabled: false });
    expect(etatDuCompte(c)).toBe('actif');
    expect(peutEncaisserEnLigne(c)).toBe(true);
  });

  it('chaque état sans encaissement dit POURQUOI, en français', () => {
    for (const etat of ENCAISSEMENT_ETATS) {
      const raison = raisonIndisponibilite(etat);
      if (etat === 'actif') expect(raison).toBeNull();
      else expect(raison).toMatch(/\S/);
    }
  });
});

describe('le schéma d’un compte connecté', () => {
  it('exige un identifiant Stripe de compte, jamais une clé secrète', () => {
    expect(EncaissementCompteSchema.safeParse(compte()).success).toBe(true);
    expect(EncaissementCompteSchema.safeParse(compte({ accountId: 'sk_live_dangereux' })).success).toBe(
      false,
    );
    expect(EncaissementCompteSchema.safeParse(compte({ accountId: '' })).success).toBe(false);
  });

  it('les drapeaux absents valent « pas encore autorisé », jamais « autorisé »', () => {
    // Le défaut permissif est la faute classique : un document d'avant ce
    // champ ferait croire que le restaurant encaisse.
    const parse = EncaissementCompteSchema.parse({
      accountId: 'acct_1234567890',
      raccordeLe: '2026-08-25T10:00:00.000Z',
      synchroniseLe: '2026-08-25T10:00:00.000Z',
    });
    expect(parse.chargesEnabled).toBe(false);
    expect(parse.payoutsEnabled).toBe(false);
    expect(parse.detailsSubmitted).toBe(false);
    expect(peutEncaisserEnLigne(parse)).toBe(false);
  });
});
