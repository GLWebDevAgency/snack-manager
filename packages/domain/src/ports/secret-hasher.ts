/**
 * PORT — vérifier un secret sans savoir comment il est protégé.
 *
 * Le domaine a une règle forte : une remise ou une annulation de ligne exige la
 * validation d'un responsable (cf. `StaffAuthorization`, NF525). Pour
 * l'exprimer, il lui faut pouvoir dire « ce PIN correspond-il ? » — et rien de
 * plus. argon2, ses paramètres de mémoire et son sel ne sont pas des règles de
 * restauration rapide : ils changeront le jour où l'état de l'art changera,
 * sans que la règle « pas de remise sans PIN » bouge d'un caractère.
 *
 * Deux exigences implicites, que tout adaptateur doit tenir :
 *  - `verify` est à temps constant vis-à-vis du secret (une comparaison naïve
 *    laisse deviner un PIN à 4 chiffres) ;
 *  - `verify` ne lève JAMAIS sur une empreinte corrompue ou d'un ancien format,
 *    il renvoie `false`. Une fiche abîmée doit refuser l'accès, pas mettre la
 *    caisse à genoux en plein coup de feu.
 */

/**
 * Empreinte stockée. Alias nommé plutôt que `string` nu : sa valeur est opaque
 * et ne se compare qu'avec `verify`, jamais avec `===`.
 */
export type SecretHash = string;

export interface SecretHasher {
  /** Nom lisible de l'implémentation (journalisation, audit de sécurité). */
  readonly providerName: string;

  hash(secret: string): Promise<SecretHash>;

  verify(secret: string, hash: SecretHash): Promise<boolean>;
}
