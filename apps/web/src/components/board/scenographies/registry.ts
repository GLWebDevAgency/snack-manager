import type { ComponentType } from "react";
import type {
  Brand,
  Scenography,
  ScreenContent,
  ScreenOrientation,
  ScreenScenePayload,
} from "@sm/contracts";
import { Ardoise } from "./ardoise/Ardoise";
import { Comptoir } from "./comptoir/Comptoir";

/**
 * LE REGISTRE DES SCÉNOGRAPHIES — une mise en scène est un module, pas un fichier.
 *
 * L'hôte (`BoardStage`) garantit à chacune le cadre de référence, les jetons du
 * masque, les polices de l'accord, la rotation, le fondu entre scènes et la
 * mise à jour en place. Une scénographie ne fait que composer une scène.
 *
 * Une entrée de plus ici, un dossier de plus à côté : c'est tout ce qu'une
 * troisième scénographie demande.
 */
export interface ScenographyProps {
  scene: ScreenScenePayload;
  content: ScreenContent;
  /** Le masque EFFECTIF, replié par l'hôte si le contenu n'en porte pas — jamais `content.masque` directement. */
  masque: Brand;
  orientation: ScreenOrientation;
  /** Deux accords sur dix posent les prix en chasse fixe — lu une fois par l'hôte. */
  prixMono: boolean;
}

export interface ScenographyModule {
  Component: ComponentType<ScenographyProps>;
  /** `header` : l'hôte peint l'en-tête persistant ; `none` : la scénographie dessine le sien. */
  chrome: "header" | "none";
}

export const SCENOGRAPHIES_WEB: Record<Scenography, ScenographyModule> = {
  ardoise: Ardoise,
  comptoir: Comptoir,
};

/** Un contenu mis en cache par une version antérieure n'a pas de scénographie : Ardoise. */
export function moduleDe(slug: string | undefined): ScenographyModule {
  return slug && Object.prototype.hasOwnProperty.call(SCENOGRAPHIES_WEB, slug)
    ? (SCENOGRAPHIES_WEB as Record<string, ScenographyModule>)[slug]!
    : Ardoise;
}
