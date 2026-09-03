import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_ACCOUNT_STATUS,
  TENANT_ACCOUNT_STATUSES,
  essaiEchuLe,
  isAccessBlocked,
  isBillable,
  statutEffectif,
} from './admin';

/**
 * L'ESSAI QUI NE SE TERMINAIT JAMAIS.
 *
 * `trialEndsAt` était écrit à la conversion, lu par un seul signal du CRM, et
 * par aucune garde. Aucun planificateur ne closait l'essai — le dépôt n'en a
 * aucun. Les seules écritures de statut étaient suspendre, réactiver et acter
 * un départ, toutes manuelles. Or `isBillable` exclut `trial` : un restaurant
 * signé que personne ne basculait à la main gardait un accès complet, gratuit
 * et permanent.
 *
 * Ces tests épinglent la règle qui ferme ce trou, et surtout ses BORNES : au
 * terme le compte devient facturable, et RIEN ne se ferme.
 */

const LE_15_SEPTEMBRE = new Date('2026-09-15T10:00:00.000Z');
const TERME_PASSE = new Date('2026-08-31T09:00:00.000Z');
const TERME_A_VENIR = new Date('2026-10-05T09:00:00.000Z');

describe('le statut effectif d’un compte', () => {
  it('rend « actif » un essai dont le terme est passé', () => {
    expect(
      statutEffectif({ status: 'trial', trialEndsAt: TERME_PASSE }, LE_15_SEPTEMBRE),
    ).toBe('active');
  });

  it('laisse « essai » tant que le terme n’est pas atteint', () => {
    expect(
      statutEffectif({ status: 'trial', trialEndsAt: TERME_A_VENIR }, LE_15_SEPTEMBRE),
    ).toBe('trial');
  });

  it('bascule à la seconde du terme, pas un jour plus tard', () => {
    // Le terme est une heure précise, écrite à la conversion : la facturation
    // s'aligne dessus, pas sur un arrondi de jour qui offrirait 24 h de plus à
    // celui qui a signé à 23 h 59.
    expect(statutEffectif({ status: 'trial', trialEndsAt: TERME_PASSE }, TERME_PASSE)).toBe(
      'active',
    );
    expect(
      statutEffectif(
        { status: 'trial', trialEndsAt: TERME_PASSE },
        new Date(TERME_PASSE.getTime() - 1),
      ),
    ).toBe('trial');
  });

  it('ne ressuscite NI un compte suspendu NI un compte parti', () => {
    // Une suspension a été décidée par un humain avec un motif, un départ acté
    // de même : une date qui passe n'annule ni l'une ni l'autre. C'est le
    // piège de cette dérivation, et il coûterait cher — rouvrir la facturation
    // d'un client qui nous a quittés.
    for (const status of ['suspended', 'churned'] as const) {
      expect(statutEffectif({ status, trialEndsAt: TERME_PASSE }, LE_15_SEPTEMBRE)).toBe(status);
    }
  });

  it('laisse « essai » un compte sans terme en base — on ne devine pas une échéance', () => {
    // Tout le parc d'avant `trialEndsAt` est dans ce cas. Un essai sans terme
    // écrit ne peut pas s'achever tout seul : il se clôt à la main, et le
    // signal du CRM continue de le rappeler.
    expect(statutEffectif({ status: 'trial', trialEndsAt: null }, LE_15_SEPTEMBRE)).toBe('trial');
    expect(statutEffectif({ status: 'trial' }, LE_15_SEPTEMBRE)).toBe('trial');
  });

  it('ne casse jamais sur un document incomplet ou aberrant', () => {
    // `.lean()` ne matérialise pas les défauts Mongoose, et le parc porte des
    // tenants créés avant le bloc `account`. Cette fonction décide si l'on
    // facture : elle rend un statut, toujours.
    expect(statutEffectif(null, LE_15_SEPTEMBRE)).toBe(DEFAULT_TENANT_ACCOUNT_STATUS);
    expect(statutEffectif(undefined, LE_15_SEPTEMBRE)).toBe(DEFAULT_TENANT_ACCOUNT_STATUS);
    expect(statutEffectif({}, LE_15_SEPTEMBRE)).toBe(DEFAULT_TENANT_ACCOUNT_STATUS);
    expect(statutEffectif({ status: 'inventé' }, LE_15_SEPTEMBRE)).toBe(
      DEFAULT_TENANT_ACCOUNT_STATUS,
    );
    expect(statutEffectif({ status: 'trial', trialEndsAt: 'pas une date' }, LE_15_SEPTEMBRE)).toBe(
      'trial',
    );
    expect(statutEffectif({ status: 'trial', trialEndsAt: 42 }, LE_15_SEPTEMBRE)).toBe('trial');
  });

  it('lit un terme en ISO comme un terme en Date — l’API rend l’un, la base stocke l’autre', () => {
    expect(
      statutEffectif({ status: 'trial', trialEndsAt: TERME_PASSE.toISOString() }, LE_15_SEPTEMBRE),
    ).toBe('active');
  });
});

describe('le terme échu', () => {
  it('rend la DATE du terme, qui devient le « depuis » du compte actif', () => {
    // Une date et non un booléen : le compte est devenu payant au jour convenu,
    // pas au jour où une lecture s'en est aperçue. C'est aussi ce que la
    // réconciliation écrit, si bien que la fiche ne voit pas sa date sauter
    // quand la passe mensuelle tourne.
    expect(essaiEchuLe({ status: 'trial', trialEndsAt: TERME_PASSE }, LE_15_SEPTEMBRE)).toEqual(
      TERME_PASSE,
    );
  });

  it('rend `null` dès qu’il n’y a rien à clore', () => {
    expect(essaiEchuLe({ status: 'trial', trialEndsAt: TERME_A_VENIR }, LE_15_SEPTEMBRE)).toBeNull();
    expect(essaiEchuLe({ status: 'active', trialEndsAt: TERME_PASSE }, LE_15_SEPTEMBRE)).toBeNull();
    expect(essaiEchuLe({ status: 'trial' }, LE_15_SEPTEMBRE)).toBeNull();
  });
});

describe('ce que le terme change, et ce qu’il ne change pas', () => {
  it('rend le compte FACTURABLE — c’est tout l’objet', () => {
    const compte = { status: 'trial', trialEndsAt: TERME_PASSE };
    // La veille du terme, on ne facture pas ; le lendemain, on facture.
    expect(isBillable(statutEffectif(compte, new Date('2026-08-20T10:00:00.000Z')))).toBe(false);
    expect(isBillable(statutEffectif(compte, LE_15_SEPTEMBRE))).toBe(true);
  });

  it('ne ferme RIEN : l’accès d’un essai et celui d’un actif sont le même', () => {
    // C'est ce qui rend la dérivation sans danger, et c'est l'arbitrage :
    // couper un restaurant en plein service parce qu'une date est passée serait
    // une faute. Le contrat est signé à la conversion — on facture.
    expect(isAccessBlocked('trial')).toBe(false);
    expect(isAccessBlocked('active')).toBe(false);
    expect(
      isAccessBlocked(statutEffectif({ status: 'trial', trialEndsAt: TERME_PASSE }, LE_15_SEPTEMBRE)),
    ).toBe(false);
  });

  it('ne facture ni un essai en cours ni un client parti, mais bien un suspendu', () => {
    // Un compte suspendu se facture : c'est justement parce qu'il doit de
    // l'argent qu'il est coupé, et cesser de facturer un impayé reviendrait à
    // l'effacer.
    expect(TENANT_ACCOUNT_STATUSES.filter(isBillable)).toEqual(['active', 'suspended']);
  });
});
