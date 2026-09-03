import type { IngredientUpdate, TenantAuditAction } from '@sm/contracts';

/**
 * CE QUE L'ÉDITEUR D'UN INGRÉDIENT DOIT LAISSER AU REGISTRE.
 *
 * `PATCH /supply/ingredients/:id` écrit onze champs d'un coup. Deux seulement
 * relèvent du périmètre du journal (`TENANT_AUDIT_ACTIONS`, @sm/contracts), et
 * ce sont les deux qui manquaient le plus :
 *
 *  1. `currentStock` — c'était LE chemin par lequel une quantité changeait
 *     sans laisser la moindre trace, ni dans `stock_movements` ni ailleurs.
 *     Une perte de trois kilos de viande s'effaçait d'un `PATCH`, et
 *     l'inventaire redevenait juste sans que rien ne dise qu'il avait bougé.
 *  2. `supplementPriceCents` — un prix PAYÉ PAR LE CLIENT au comptoir, au même
 *     titre que celui d'un produit. D'où l'action `price.change` plutôt qu'une
 *     action « supplément » : pour le client, c'est le même fait.
 *
 * Les neuf autres (nom, catégorie, unité, allergènes, coût d'achat, seuil
 * d'alerte, conservation, retirable, libellé de caisse) restent hors journal —
 * voir la règle de périmètre et les raisons de chaque exclusion à côté de
 * `TENANT_AUDIT_ACTIONS`.
 *
 * ─── POURQUOI UNE FONCTION PURE, HORS DU SERVICE ───
 *
 * La DÉCISION (qu'est-ce qui mérite une ligne, et que porte-t-elle) est ce qui
 * se relit, se discute et se teste. Le service, lui, parle à deux bases. Sortie
 * ici, la règle se vérifie sur des valeurs, sans PostgreSQL ni Mongo : le test
 * porte alors sur le CONTENU des lignes, pas sur le fait qu'un appel a eu lieu.
 */
export type LigneDeJournal = {
  action: TenantAuditAction;
  meta: Record<string, unknown>;
};

/** L'état d'AVANT, réduit aux champs dont dépend la décision. */
export type IngredientAvant = {
  name: string;
  unit: string;
  currentStock: number;
  supplementPriceCents: number | null;
};

export function lignesDeLEditeurDIngredient(
  avant: IngredientAvant,
  dto: IngredientUpdate,
): LigneDeJournal[] {
  const lignes: LigneDeJournal[] = [];

  // `!==` sur des nombres déjà arrondis au millième par l'appelant : un PATCH
  // qui renvoie le formulaire entier sans rien changer ne doit pas écrire.
  if (dto.currentStock !== undefined && dto.currentStock !== avant.currentStock) {
    lignes.push({
      action: 'stock.adjust',
      meta: {
        name: avant.name,
        unit: avant.unit,
        // La TRANSITION, pas l'état final : « 12 kg → 9 kg » se défend en
        // contrôle, « 9 kg » ne prouve rien. Même règle que `price.change`.
        de: avant.currentStock,
        vers: dto.currentStock,
        ecart: Math.round((dto.currentStock - avant.currentStock) * 1000) / 1000,
      },
    });
  }

  if (
    dto.supplementPriceCents !== undefined &&
    dto.supplementPriceCents !== avant.supplementPriceCents
  ) {
    lignes.push({
      action: 'price.change',
      meta: {
        name: avant.name,
        // Ce qui distingue cette ligne d'un prix de produit à la relecture.
        // `null` des deux côtés est porteur de sens : d'un supplément gratuit
        // devenu payant, ou l'inverse.
        supplement: true,
        fromCents: avant.supplementPriceCents,
        toCents: dto.supplementPriceCents,
      },
    });
  }

  return lignes;
}
