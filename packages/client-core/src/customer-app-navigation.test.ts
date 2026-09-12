import { describe, expect, it } from 'vitest';
import { CUSTOMER_APP_DESTINATIONS, customerAppDestinations, customerAppPath, customerAppViewFromPath } from './customer-app-navigation';

describe('destinations de l’application client, communes web et mobile', () => {
  it('borne cinq destinations et conserve leur ordre selon les offres publiques', () => {
    expect(customerAppDestinations({ ordering: true, loyalty: true, account: true }).map(item => item.key))
      .toEqual(['menu', 'search', 'orders', 'loyalty', 'account']);
    expect(customerAppDestinations({ ordering: false, loyalty: true, account: true }).map(item => item.key))
      .toEqual(['loyalty', 'account']);
    expect(customerAppDestinations({ ordering: true, loyalty: false, account: false }).map(item => item.key))
      .toEqual(['menu', 'search', 'orders']);
    expect(customerAppDestinations({ ordering: false, loyalty: false, account: false })).toEqual([]);
  });
  it('garde chaque route dans le restaurant et permet les liens profonds sans état privé', () => {
    for (const item of CUSTOMER_APP_DESTINATIONS) {
      expect(customerAppPath('le-comptoir', item.key)).toBe(`/r/le-comptoir/${item.suffix}`);
      expect(customerAppViewFromPath(customerAppPath('le-comptoir', item.key))).toBe(item.key);
    }
    expect(customerAppPath('a/b?#secret', 'account')).toBe('/r/a%2Fb%3F%23secret/compte');
    expect(customerAppViewFromPath('/r/le-comptoir')).toBe('menu');
    expect(customerAppViewFromPath('/r/le-comptoir/fidelite/')).toBe('loyalty');
  });
});
