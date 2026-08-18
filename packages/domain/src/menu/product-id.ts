import { InvalidProductId } from './errors';
import { err, ok, type Result } from '../shared/result';

/**
 * Identifiant d'un produit de la carte.
 *
 * Value object plutôt que `string` : cet identifiant voyage loin — panier local
 * du téléphone, file de synchronisation hors ligne, ligne de commande archivée
 * dix ans pour NF525. Le confondre avec un identifiant de catégorie ou de
 * variante ne se voit qu'au moment où la cuisine sort le mauvais plat.
 *
 * On n'impose aucun format : la valeur vient d'un ObjectId Mongo aujourd'hui,
 * peut-être d'un slug importé d'une caisse concurrente demain. On garantit
 * seulement qu'elle est non vide et de taille plausible.
 */
export class ProductId {
  private constructor(readonly value: string) {}

  /** Au-delà de 64 caractères ce n'est plus un identifiant mais une donnée corrompue. */
  private static readonly MAX_LENGTH = 64;

  static create(input: string): Result<ProductId, InvalidProductId> {
    const cleaned = input.trim();

    if (!cleaned) {
      return err(new InvalidProductId('Identifiant produit vide'));
    }
    if (cleaned.length > ProductId.MAX_LENGTH) {
      return err(
        new InvalidProductId(
          `Identifiant produit illisible (${cleaned.length} caractères, ${ProductId.MAX_LENGTH} au maximum)`,
        ),
      );
    }

    return ok(new ProductId(cleaned));
  }

  equals(other: ProductId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
