import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermanentError, SyncQueue } from './sync-queue';
import { setStore } from './storage';

/**
 * LA FILE OFFLINE — ce qui tient le service quand le réseau tombe.
 *
 * Elle n'avait aucun test, alors qu'elle porte des ventes déjà encaissées : sur
 * une tablette de comptoir, une entrée perdue est de l'argent dans le tiroir
 * sans commande en face.
 *
 * Le défaut réparé ici : un refus définitif du serveur (4xx) retirait l'entrée
 * et la JETAIT. Le commentaire disait « on retire pour ne pas bloquer le
 * service » — juste — mais retirer sans trace ne l'est pas. Rien à l'écran ne
 * disait quelle vente venait de disparaître, ni pourquoi.
 */

/**
 * `enqueue` déclenche un envoi de son propre chef (`void this.flush()`), sans
 * l'attendre : sans ce point d'arrêt, un test verrait deux passes se marcher
 * dessus et compterait des appels qui ne sont pas les siens.
 */
const laisserPartir = () => new Promise((r) => setTimeout(r, 0));

/** Un stockage en mémoire, remis à neuf entre chaque test. */
function stockage() {
  const donnees = new Map<string, string>();
  setStore({
    getItem: async (k: string) => donnees.get(k) ?? null,
    setItem: async (k: string, v: string) => void donnees.set(k, v),
    removeItem: async (k: string) => void donnees.delete(k),
  });
  return donnees;
}

const commande = (id: string) => ({
  method: 'POST' as const,
  path: '/orders',
  body: { clientId: id, total: 1_850 },
  subject: id,
});

let donnees: Map<string, string>;
beforeEach(() => {
  donnees = stockage();
});

describe('une mutation refusée définitivement', () => {
  it('est CONSERVÉE avec son motif — sinon la vente disparaît', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    const rejets = file.getState().rejected;
    expect(rejets).toHaveLength(1);
    expect(rejets[0]).toMatchObject({ path: '/orders', reason: 'Produit supprimé', status: 409 });
    // Le CORPS est gardé : c'est lui qui permet de ressaisir la vente perdue.
    expect(rejets[0]!.body).toEqual({ clientId: 'c1', total: 1_850 });
  });

  it('quitte quand même la file — un refus définitif ne doit pas bloquer le service', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Déjà servie', 409));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    expect(file.getState().pending).toBe(0);
  });

  it('survit au redémarrage de la tablette', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const premiere = new SyncQueue(envoyer);
    await premiere.enqueue(commande('c1'));
    await laisserPartir();

    // Même stockage, instance neuve : c'est la tablette qu'on rallume.
    const seconde = new SyncQueue(vi.fn());
    await seconde.enqueue(commande('c2'));
    expect(seconde.getState().rejected).toHaveLength(1);
    expect(seconde.getState().rejected[0]!.reason).toBe('Produit supprimé');
  });

  it('garde les plus RÉCENTS et borne la liste', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Refus', 400));
    const file = new SyncQueue(envoyer);
    for (let i = 0; i < 25; i += 1) {
      await file.enqueue(commande(`c${i}`));
      await laisserPartir();
    }

    const rejets = file.getState().rejected;
    // Bornée : une liste qui gonfle remplirait le stockage de la tablette, et
    // un service ne se relit pas sur trois cents lignes.
    expect(rejets.length).toBeLessThanOrEqual(20);
    // Les plus récents priment — ce sont eux qu'on peut encore rattraper.
    expect(rejets[0]!.body).toMatchObject({ clientId: 'c24' });
  });

  it('ne s’efface que sur un geste EXPLICITE', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Refus', 400));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    expect(file.getState().rejected).toHaveLength(1);

    // Une seconde passe ne doit pas les faire disparaître : un rejet qui
    // s'efface tout seul ramène exactement le défaut qu'on répare.
    await file.flush();
    expect(file.getState().rejected).toHaveLength(1);

    await file.acquitterRejets();
    expect(file.getState().rejected).toHaveLength(0);
    expect(donnees.get('sm.sync.rejected.v1')).toBe('[]');
  });
});

describe('une panne passagère', () => {
  it('garde l’entrée en file et ne la compte pas comme rejetée', async () => {
    const envoyer = vi.fn().mockRejectedValue(new Error('réseau indisponible'));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    expect(file.getState().pending).toBe(1);
    expect(file.getState().rejected).toHaveLength(0);
    expect(file.getState().lastError).toBe('réseau indisponible');
  });

  it('bloque les mutations SUIVANTES du même sujet, pour préserver leur ordre', async () => {
    // Une commande dont la création échoue ne doit pas voir son changement de
    // statut partir devant : le serveur recevrait une mise à jour d'une
    // commande qui n'existe pas encore.
    const envoyer = vi.fn().mockRejectedValue(new Error('réseau'));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    envoyer.mockClear();

    await file.enqueue({ method: 'PATCH', path: '/orders/c1/status', subject: 'c1' });
    await laisserPartir();

    // La création est en tête et a échoué : la mise à jour ne doit pas partir
    // devant elle, sinon le serveur reçoit un changement de statut pour une
    // commande qui n'existe pas encore.
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer.mock.calls[0]![0]).toMatchObject({ path: '/orders' });
    expect(file.getState().pending).toBe(2);
  });
});
