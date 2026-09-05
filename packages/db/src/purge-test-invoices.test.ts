import { describe, expect, it } from 'vitest';
import { retiredInvoicePurge } from './purge-test-invoices';

describe('retrait de la purge historique des factures', () => {
  it('refuse avant tout accès à une base ou réinitialisation de compteur', () => {
    expect(retiredInvoicePurge).toThrow('Purge historique retirée');
  });
});
