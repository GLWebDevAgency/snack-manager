import { describe, expect, it } from 'vitest';
import { horairesPublics } from './horaires-publics';

/**
 * UNE SEULE FORME D'HORAIRES POUR TOUT CE QUI SORT VERS LE PUBLIC.
 *
 * La vitrine, l'écran de salle et la fiche publique rendaient les mêmes
 * horaires de trois façons — deux copies du même `map`, et une troisième qui
 * ne convertissait rien. Ce qui est verrouillé ici, ce n'est pas le `map` :
 * c'est ce qu'une donnée MAL FORMÉE devient en sortie. La route qui écrit ces
 * horaires est validée depuis (`TenantHoursUpdateSchema`), mais une garde
 * d'ENTRÉE ne réécrit pas le passé : ce que la route nue a laissé en base y
 * dort toujours, et c'est cette lecture-là qui sort vers le public.
 */
describe('les horaires rendus au public', () => {
  it('rend la journée telle quelle quand elle est complète', () => {
    expect(
      horairesPublics([
        { day: 1, lunch: { open: '11:30', close: '14:30' }, dinner: null },
      ]),
    ).toEqual([{ day: 1, lunch: { open: '11:30', close: '14:30' }, dinner: null }]);
  });

  it('rend un tableau vide pour un tenant sans horaires', () => {
    expect(horairesPublics(undefined)).toEqual([]);
    expect(horairesPublics(null)).toEqual([]);
    expect(horairesPublics([])).toEqual([]);
  });

  it('ferme le service dont une borne manque — jamais `close: undefined`', () => {
    // Sans cette garde, la borne absente partait telle quelle dans le calcul
    // des créneaux de retrait de TOUTE la page de commande. Un service qu'on
    // ne sait pas lire est un service fermé, pas un service ouvert à demi.
    const [jour] = horairesPublics([
      { day: 2, lunch: { open: '11:30' }, dinner: { close: '22:30' } },
    ]);
    expect(jour).toEqual({ day: 2, lunch: null, dinner: null });
  });

  it('ramène le jour à un nombre, même écrit en chaîne par une reprise', () => {
    expect(horairesPublics([{ day: '3', lunch: null, dinner: null }])[0]?.day).toBe(3);
    expect(horairesPublics([null])[0]?.day).toBe(0);
  });

  it('ne rend QUE les trois clés du contrat — rien du document Mongoose', () => {
    // La fiche publique rendait le tableau de sous-documents tel quel : tout ce
    // que la base ajouterait demain à une journée partirait chez le client.
    const [jour] = horairesPublics([
      {
        day: 4,
        lunch: { open: '11:30', close: '14:30' },
        dinner: null,
        ...({ $__parent: {}, note: 'interne' } as object),
      },
    ]);
    expect(Object.keys(jour ?? {}).sort()).toEqual(['day', 'dinner', 'lunch']);
  });
});
