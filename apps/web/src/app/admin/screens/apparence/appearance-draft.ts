import type { ScreenView } from "@sm/contracts";

export type Appearance = Pick<ScreenView, "orientation" | "theme" | "scenography">;
export type AppearanceEdits = Partial<Appearance>;

export function appearanceOf(screen: Appearance): Appearance {
  return {
    orientation: screen.orientation,
    theme: screen.theme,
    scenography: screen.scenography,
  };
}

/** Un champ non touché suit toujours les dernières données de l'écran. */
export function appearanceDraft(base: Appearance, edits: AppearanceEdits): Appearance {
  return { ...base, ...edits };
}

export function editAppearance<K extends keyof Appearance>(
  base: Appearance,
  edits: AppearanceEdits,
  key: K,
  value: Appearance[K],
): AppearanceEdits {
  const next = { ...edits };
  if (value === base[key]) delete next[key];
  else next[key] = value;
  return next;
}

/** Le PATCH ne réécrit ni les autres réglages ni une valeur déjà enregistrée. */
export function appearancePatch(base: Appearance, edits: AppearanceEdits): AppearanceEdits {
  const patch: AppearanceEdits = {};
  if (edits.orientation !== undefined && edits.orientation !== base.orientation) {
    patch.orientation = edits.orientation;
  }
  if (edits.theme !== undefined && edits.theme !== base.theme) patch.theme = edits.theme;
  if (edits.scenography !== undefined && edits.scenography !== base.scenography) {
    patch.scenography = edits.scenography;
  }
  return patch;
}
