import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMPTY_PARTY,
  UNKNOWN_VAT,
  type InvoiceParty,
  type InvoiceVatConfig,
} from '@sm/contracts';

/**
 * L'IDENTITÉ LÉGALE DE L'ÉMETTEUR — la nôtre.
 *
 * Elle n'existe NULLE PART dans le code ni dans la base : ni SIRET, ni numéro
 * de TVA, ni adresse de siège. C'est normal — ce sont des données d'entreprise,
 * pas des données produit, et les écrire en dur dans un dépôt les rendrait
 * fausses le jour d'un déménagement ou d'un changement de forme juridique.
 *
 * Elles viennent donc de l'environnement (Railway en production, `.env` en
 * local). Ce qui n'est pas fourni vaut `null` et s'imprimera en EMPLACEMENT sur
 * la facture : voir `INVOICE_LEGAL_PLACEHOLDER`. Rien n'est inventé, rien n'est
 * complété par un défaut « raisonnable » — une facture fausse est pire qu'une
 * facture incomplète.
 *
 * ─── VARIABLES ATTENDUES ───
 *
 *   SM_BILLING_ISSUER_NAME        Dénomination sociale
 *   SM_BILLING_ISSUER_LEGAL_FORM  Forme juridique et capital
 *   SM_BILLING_ISSUER_ADDRESS     Adresse du siège (une ligne)
 *   SM_BILLING_ISSUER_SIRET       SIRET, 14 chiffres
 *   SM_BILLING_ISSUER_VAT_NUMBER  TVA intracommunautaire (FR…)
 *   SM_BILLING_ISSUER_RCS         Greffe d'immatriculation
 *   SM_BILLING_ISSUER_EMAIL       Contact facturation
 *   SM_BILLING_ISSUER_PHONE       Téléphone
 *   SM_BILLING_VAT_RATE           Taux en pourcent : « 20 », « 0 » (franchise)…
 *   SM_BILLING_AMOUNTS            « ht » ou « ttc » — ce que vaut `amountCents`
 *
 * `SM_BILLING_AMOUNTS` mérite un mot : la collection `invoices` ne stocke qu'UN
 * montant, sans jamais dire s'il est hors taxes. Tant que l'exploitant ne l'a
 * pas déclaré, la ventilation HT / TVA / TTC reste vide plutôt que devinée —
 * diviser par 1,2 « parce que c'est le taux courant » produirait une base
 * imposable inventée sur une pièce comptable.
 */
@Injectable()
export class IssuerConfig {
  constructor(private readonly config: ConfigService) {}

  /** Chaîne d'environnement nettoyée — vide ou absente valent `null`. */
  private text(key: string): string | null {
    const raw = this.config.get<string>(key);
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value === '' ? null : value;
  }

  /** L'émetteur, tel que l'environnement le décrit — trous compris. */
  issuer(): InvoiceParty {
    return {
      ...EMPTY_PARTY,
      name: this.text('SM_BILLING_ISSUER_NAME'),
      legalForm: this.text('SM_BILLING_ISSUER_LEGAL_FORM'),
      address: this.text('SM_BILLING_ISSUER_ADDRESS'),
      siret: this.text('SM_BILLING_ISSUER_SIRET'),
      vatNumber: this.text('SM_BILLING_ISSUER_VAT_NUMBER'),
      rcs: this.text('SM_BILLING_ISSUER_RCS'),
      email: this.text('SM_BILLING_ISSUER_EMAIL'),
      phone: this.text('SM_BILLING_ISSUER_PHONE'),
    };
  }

  /**
   * Le régime de TVA déclaré. Une valeur illisible (« vingt pour cent ») est
   * traitée comme une absence : mieux vaut un emplacement vide qu'un taux
   * silencieusement remplacé par zéro, qui ferait passer une entreprise
   * assujettie pour une franchise en base.
   */
  vat(): InvoiceVatConfig {
    const rawRate = this.text('SM_BILLING_VAT_RATE');
    const rate = rawRate === null ? null : Number(rawRate.replace(',', '.'));
    const ratePercent = rate !== null && Number.isFinite(rate) && rate >= 0 ? rate : null;

    const rawBasis = this.text('SM_BILLING_AMOUNTS')?.toLowerCase() ?? null;
    const amountsAre = rawBasis === 'ht' || rawBasis === 'ttc' ? rawBasis : null;

    if (ratePercent === null && amountsAre === null) return UNKNOWN_VAT;
    return { ratePercent, amountsAre };
  }
}
