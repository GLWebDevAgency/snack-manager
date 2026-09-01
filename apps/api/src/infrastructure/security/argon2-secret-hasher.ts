import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PASSWORD_ARGON2_COST } from '@sm/contracts';
import type { SecretHash, SecretHasher } from '@sm/domain/src/ports';

import { errorMessage } from '../http';

/**
 * ADAPTATEUR — `SecretHasher` sur argon2id.
 *
 * Cet adaptateur crée aujourd'hui les mots de passe des comptes issus du CRM.
 * Le coût partagé avec les scripts DB et le hash factice du login évite qu'une
 * cohorte plus rapide révèle, par sa durée, comment le compte a été créé.
 *
 * Le domaine, lui, ne sait rien de tout cela. Il sait qu'une remise exige un PIN
 * vérifié (cf. `StaffAuthorization`) — pas comment on le vérifie. Le jour où
 * argon2 est remplacé, ce fichier change, et rien d'autre.
 */
@Injectable()
export class Argon2SecretHasher implements SecretHasher {
  readonly providerName = 'argon2id';

  private readonly logger = new Logger(Argon2SecretHasher.name);

  /**
   * Paramètres explicites plutôt que les valeurs par défaut du paquet : elles
   * changent d'une version à l'autre, et une empreinte doit rester vérifiable
   * après une montée de version. Les paramètres sont de toute façon inscrits
   * DANS l'empreinte produite, donc les anciennes continuent de se vérifier.
   *
   * La politique vient de @sm/contracts : seed, scripts d'administration,
   * conversion CRM et login partagent exactement les mêmes nombres.
   */
  private static readonly OPTIONS = {
    type: argon2.argon2id,
    ...PASSWORD_ARGON2_COST,
  } as const;

  async hash(secret: string): Promise<SecretHash> {
    return argon2.hash(secret, Argon2SecretHasher.OPTIONS);
  }

  /**
   * Ne lève jamais.
   *
   * Une empreinte tronquée par un import raté, ou écrite par un ancien format,
   * fait lever argon2. En plein coup de feu, une exception ici ferait tomber la
   * requête de connexion entière ; un `false` refuse l'accès, ce qui est le
   * comportement sûr, et laisse une trace pour la fiche à réparer.
   */
  async verify(secret: string, hash: SecretHash): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch (error) {
      this.logger.warn(`Empreinte illisible, accès refusé : ${errorMessage(error)}`);
      return false;
    }
  }
}
