import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMPTY_PARTY, type InvoiceParty } from '@sm/contracts';

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
 *
 * ─── CE QUI N'EST PLUS ICI : LE TAUX DE TVA ───
 *
 * Deux variables `SM_BILLING_VAT_RATE` et `SM_BILLING_AMOUNTS` décidaient
 * naguère du régime, faute de mieux — la base ne portait aucun taux. Elles ont
 * disparu, et pas par simplification : un taux de TVA n'est pas un secret de
 * déploiement mais une DÉCISION COMMERCIALE. En variable d'environnement, il
 * valait 20 en production et rien ailleurs, si bien que la même facture rendue
 * depuis deux environnements sortait avec deux ventilations différentes — sur
 * une pièce comptable, c'est la définition d'un litige.
 *
 * Le régime vit désormais à deux endroits, tous deux sous relecture : la
 * DÉCISION dans `SM_INVOICE_VAT` (@sm/contracts), et le taux RÉELLEMENT
 * APPLIQUÉ figé sur chaque facture à son émission (`invoices.vat`, @sm/db).
 * Une facture ancienne garde donc son taux d'époque, quoi qu'il arrive ensuite.
 *
 * Ce qui reste dans l'environnement est ce qui se CONSTATE et non ce qui se
 * décide : l'identité légale de l'entreprise. Tant qu'elle manque, la facture
 * porte un emplacement vide.
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
}
