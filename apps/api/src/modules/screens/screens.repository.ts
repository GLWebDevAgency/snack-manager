import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { screenPresentationOf, type ScreenPresentation, type Scenography, type ScreenOrientation, type ScreenScene, type ScreenTheme } from '@sm/contracts';
import type { Screen } from '@sm/db';

/**
 * Un écran tel qu'il est stocké, SANS son jeton d'appareil.
 *
 * L'omission est délibérée : le secret ne sort du dépôt qu'au moment de
 * l'appairage, par le seul chemin qui en a besoin. Un champ absent du type ne
 * peut pas se retrouver par mégarde dans une réponse de back-office.
 */
export interface StoredScreen {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly pairingCode: string | null;
  readonly pairingCodeExpiresAt: Date | null;
  readonly paired: boolean;
  readonly orientation: ScreenOrientation;
  readonly theme: ScreenTheme;
  readonly scenography: Scenography;
  readonly presentation?: ScreenPresentation;
  readonly playlist: ScreenScene[];
  readonly lastSeenAt: Date | null;
  readonly active: boolean;
}

export interface NewScreen {
  readonly name: string;
  readonly orientation: ScreenOrientation;
  readonly theme: ScreenTheme;
  readonly scenography: Scenography;
  readonly presentation?: ScreenPresentation;
  readonly playlist: ScreenScene[];
  readonly pairingCode: string;
  readonly pairingCodeExpiresAt: Date;
}

export interface ScreenPatch {
  readonly name?: string;
  readonly orientation?: ScreenOrientation;
  readonly theme?: ScreenTheme;
  readonly scenography?: Scenography;
  readonly presentation?: ScreenPresentation;
  readonly playlist?: ScreenScene[];
  readonly active?: boolean;
}

/**
 * Identifiants de scène illisibles par la base.
 *
 * Une playlist est éditée depuis le back-office, donc par un humain, donc avec
 * des fautes de copier-coller. Un `categoryId` qui n'est pas un ObjectId ferait
 * lever une CastError à l'écriture et le gérant recevrait un 500 opaque devant
 * son formulaire. On les nomme, il corrige.
 *
 * L'appartenance au tenant, elle, n'est PAS vérifiée ici : la résolution du
 * contenu ne lit que les produits de l'établissement, si bien qu'une scène
 * pointant ailleurs se résout à vide et disparaît de la boucle. Refuser en plus
 * casserait un aller-retour légitime — enregistrer une playlist dont une
 * catégorie vient d'être désactivée.
 */
export function invalidSceneIds(playlist: readonly ScreenScene[]): string[] {
  const invalid: string[] = [];
  for (const scene of playlist) {
    if (scene.categoryId && !Types.ObjectId.isValid(scene.categoryId)) {
      invalid.push(scene.categoryId);
    }
    for (const id of scene.productIds) {
      if (!Types.ObjectId.isValid(id)) invalid.push(id);
    }
  }
  return invalid;
}

export type RawScreen = Screen & { _id: unknown };

/** Exporté pour le test du champ absent : `.lean()` n'applique aucun défaut de schéma. */
export function toStored(raw: RawScreen): StoredScreen {
  return {
    id: String(raw._id),
    tenantId: String(raw.tenantId),
    name: String(raw.name ?? ''),
    pairingCode: raw.pairingCode ?? null,
    pairingCodeExpiresAt: raw.pairingCodeExpiresAt ?? null,
    paired: raw.paired === true,
    orientation: (raw.orientation ?? 'landscape') as ScreenOrientation,
    theme: (raw.theme ?? 'brand') as ScreenTheme,
    // Les écrans antérieurs au champ gardent l'écran qu'ils ont toujours eu.
    scenography: (raw.scenography ?? 'ardoise') as Scenography,
    presentation: screenPresentationOf(raw.presentation),
    playlist: (raw.playlist ?? []).map((s) => ({
      kind: s.kind as ScreenScene['kind'],
      categoryId: s.categoryId ? String(s.categoryId) : null,
      productIds: (s.productIds ?? []).map((id) => String(id)),
      title: s.title ?? null,
      durationMs: Number(s.durationMs ?? 0),
    })),
    lastSeenAt: raw.lastSeenAt ?? null,
    active: raw.active !== false,
  };
}

@Injectable()
export class ScreensRepository {
  constructor(@InjectModel('Screen') private readonly screens: Model<Screen>) {}

  async list(tenantId: string): Promise<StoredScreen[]> {
    const rows = await this.screens.find({ tenantId }).sort({ createdAt: -1 }).lean();
    return rows.map((r) => toStored(r as RawScreen));
  }

  async byId(tenantId: string, id: string): Promise<StoredScreen | null> {
    // Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou,
    // Mongoose lève une CastError et le client reçoit un 500 au lieu d'un 404.
    if (!Types.ObjectId.isValid(id)) return null;
    const raw = await this.screens.findOne({ _id: id, tenantId }).lean();
    return raw ? toStored(raw as RawScreen) : null;
  }

  async create(tenantId: string, screen: NewScreen): Promise<StoredScreen> {
    const created = await this.screens.create({ ...screen, tenantId });
    return toStored(created.toObject() as RawScreen);
  }

  async update(tenantId: string, id: string, patch: ScreenPatch): Promise<StoredScreen | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const $set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) $set[key] = value;
    }
    const raw = await this.screens
      .findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true })
      .lean();
    return raw ? toStored(raw as RawScreen) : null;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.screens.deleteOne({ _id: id, tenantId });
    return res.deletedCount > 0;
  }

  /**
   * Repose un code d'appairage neuf.
   *
   * Remet aussi `paired` et `deviceToken` à zéro : régénérer un code, c'est
   * dire « cet écran est à réinstaller », et l'ancien jeton ne doit plus ouvrir
   * la carte — typiquement quand la clé HDMI a été volée ou remplacée.
   */
  async resetPairing(
    tenantId: string,
    id: string,
    code: string,
    expiresAt: Date,
  ): Promise<StoredScreen | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const raw = await this.screens
      .findOneAndUpdate(
        { _id: id, tenantId },
        {
          $set: {
            pairingCode: code,
            pairingCodeExpiresAt: expiresAt,
            paired: false,
            deviceToken: null,
            lastSeenAt: null,
          },
        },
        { new: true },
      )
      .lean();
    return raw ? toStored(raw as RawScreen) : null;
  }

  /**
   * Cherche un écran par son code, TOUS établissements confondus : l'écran qui
   * s'appaire ne sait pas encore à quel restaurant il appartient — c'est
   * précisément ce que le code lui apprend.
   */
  async findByPairingCode(code: string): Promise<StoredScreen | null> {
    const raw = await this.screens.findOne({ pairingCode: code }).lean();
    return raw ? toStored(raw as RawScreen) : null;
  }

  /**
   * Consomme le code et scelle l'appairage, en UNE écriture conditionnée au
   * code encore présent. Deux écrans qui saisiraient le même code à la même
   * seconde : le second ne trouve plus rien à consommer et repart en erreur.
   */
  async claim(id: string, code: string, deviceToken: string, at: Date): Promise<boolean> {
    const res = await this.screens.updateOne(
      { _id: id, pairingCode: code },
      {
        $set: {
          pairingCode: null,
          pairingCodeExpiresAt: null,
          paired: true,
          deviceToken,
          lastSeenAt: at,
        },
      },
    );
    return res.modifiedCount > 0;
  }

  async findByDeviceToken(deviceToken: string): Promise<StoredScreen | null> {
    const raw = await this.screens.findOne({ deviceToken, paired: true }).lean();
    return raw ? toStored(raw as RawScreen) : null;
  }

  /** Battement de cœur — source du « hors ligne depuis 20 min » du back-office. */
  async touch(id: string, at: Date): Promise<void> {
    await this.screens.updateOne({ _id: id }, { $set: { lastSeenAt: at } });
  }
}
