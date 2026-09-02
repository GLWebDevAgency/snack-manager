/**
 * Politique UNIQUE des mots de passe utilisateur (`owner`, `sm_admin`, etc.).
 *
 * Les nombres vivent dans le paquet partagé afin que le seed, les scripts
 * d'administration, la conversion CRM, le login et son hash factice ne
 * dérivent plus selon les valeurs par défaut de leur version d'argon2.
 */
export const PASSWORD_ARGON2_COST = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;
