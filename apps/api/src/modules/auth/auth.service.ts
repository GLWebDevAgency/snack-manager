import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { type HydratedDocument, Model } from 'mongoose';
import * as argon2 from 'argon2';
import {
  type JwtPayload,
  type Login,
  PASSWORD_ARGON2_COST,
  type StaffRole,
} from '@sm/contracts';
import type { Staff, Tenant, User } from '@sm/db';

/**
 * Empreinte factice Argon2id (m=64 MiB, t=3, p=4), sans compte associé.
 *
 * Elle n'est pas un secret : son unique rôle est d'imposer le même travail de
 * vérification lorsqu'un e-mail n'existe pas. Même si le mot de passe factice
 * était connu, `!user` ferme toujours le chemin avant toute émission de JWT.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$IkoUxvqiD3Tb2Igtj01mQA$XPrFjyzDtYZq91A4n+XaaqEt0sbZzedkzQDdTfpU/OQ';

const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  ...PASSWORD_ARGON2_COST,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel('User') private readonly users: Model<User>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly jwt: JwtService,
  ) {}

  /** Gérant / équipe SM — email + mot de passe. */
  async login({ email, password }: Login) {
    const user = await this.users.findOne({ email: email.toLowerCase() });
    const storedHash = usablePasswordHash(user?.passwordHash) ? user.passwordHash : null;
    const selectedHash = storedHash ?? DUMMY_PASSWORD_HASH;
    const currentPolicy = storedHash ? passwordHashUsesCurrentPolicy(storedHash) : false;

    // Inconnu et cohorte courante paient chacun UN Argon2 64 MiB. Une ancienne
    // cohorte vérifie son vrai hash en parallèle du dummy 64 MiB : le premier
    // essai est déjà dominé par le coût courant, avant même son rehash réussi.
    const [passwordMatches] = await Promise.all([
      verifyOrFalse(selectedHash, password),
      storedHash && !currentPolicy
        ? verifyOrFalse(DUMMY_PASSWORD_HASH, password)
        : Promise.resolve(false),
    ]);
    if (!user || !storedHash || !passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.rehashIfNeeded(user, storedHash, password, currentPolicy);
    // Le paquet API peut être typechecké avant la reconstruction de `@sm/db` ;
    // la lecture tolérante couvre aussi les documents Mongo historiques.
    const userSessionVersion = String(
      (user as unknown as { sessionVersion?: unknown }).sessionVersion ?? '0',
    );
    const payload: JwtPayload = {
      sub: String(user._id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      role: user.role,
      kind: 'user',
      userSessionVersion,
    };
    return {
      token: await this.jwt.signAsync(payload),
      user: { email: user.email, name: user.name, role: user.role, tenantId: payload.tenantId },
    };
  }

  /** Normalise progressivement les anciennes cohortes après preuve du secret. */
  private async rehashIfNeeded(
    user: HydratedDocument<User>,
    storedHash: string,
    password: string,
    currentPolicy: boolean,
  ): Promise<void> {
    if (currentPolicy) return;

    try {
      const passwordHash = await argon2.hash(password, PASSWORD_HASH_OPTIONS);
      // Compare-and-set : deux connexions simultanées ne remplacent pas une
      // empreinte déjà renouvelée par l'autre requête.
      await this.users.updateOne(
        { _id: user._id, passwordHash: storedHash },
        { $set: { passwordHash } },
      );
    } catch {
      // La migration ne transforme jamais un mot de passe juste en panne de
      // connexion. Aucun e-mail ni identifiant n'entre dans le journal.
      this.logger.warn('Ré-hachage opportuniste du mot de passe reporté.');
    }
  }

  /*
   * `loginPin` A ÉTÉ SUPPRIMÉE avec la route `POST /auth/pin` (28/08/2026).
   *
   * Elle acceptait un slug d'établissement venu du corps de la requête, ce qui
   * ouvrait une session équipe sur n'importe quel restaurant à qui devinait un
   * code. `DevicePinLogin` la remplace : l'établissement y vient du jeton
   * d'appareil, jamais du client.
   *
   * Ne pas la remettre. Le code mort n'était pas neutre ici : il suffisait de
   * rebrancher un contrôleur dessus pour rouvrir la porte.
   */

  /**
   * Re-validation PIN pour action sensible (annulation, remise…) — NF525.
   *
   * Rend le RÔLE avec l'identité, et ce n'est pas un détail de confort :
   * re-saisir un code prouve QUI agit, jamais que cette personne en a le droit.
   * Les appelants n'avaient que le `staffId` et ne pouvaient donc pas faire le
   * second contrôle — n'importe quel code actif du restaurant, cuisine
   * comprise, accordait une remise de n'importe quel montant.
   */
  async verifyPin(tenantId: string, pin: string): Promise<{ staffId: string; role: StaffRole }> {
    const members = await this.staff.find({ tenantId, active: true });
    for (const member of members) {
      if (await argon2.verify(member.pinHash, pin)) {
        return { staffId: String(member._id), role: member.role as StaffRole };
      }
    }
    throw new UnauthorizedException('PIN invalide');
  }
}

function usablePasswordHash(value: unknown): value is string {
  return typeof value === 'string' && /^\$argon2(?:id|i|d)\$/.test(value);
}

async function verifyOrFalse(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

function passwordHashUsesCurrentPolicy(hash: string): boolean {
  if (!hash.startsWith('$argon2id$')) return false;
  try {
    return !argon2.needsRehash(hash, PASSWORD_ARGON2_COST);
  } catch {
    return false;
  }
}
