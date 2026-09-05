import { screenPresentationOf, type ScreenPresentation, type ScreenView } from "@sm/contracts";

export type Appearance = Pick<ScreenView, "orientation" | "theme" | "scenography"> & {
  presentation: ScreenPresentation;
};
export type AppearanceEdits = Partial<Omit<Appearance, "presentation">> & {
  presentation?: Partial<ScreenPresentation>;
};
const PRESENTATION_KEYS = ["corners", "priceScale", "motion"] as const;

export function appearanceOf(screen: Omit<Appearance, "presentation"> & { presentation?: ScreenPresentation }): Appearance {
  return {
    orientation: screen.orientation,
    theme: screen.theme,
    scenography: screen.scenography,
    presentation: screenPresentationOf(screen.presentation),
  };
}

/** Un champ non touché suit toujours les dernières données de l'écran. */
export function appearanceDraft(base: Appearance, edits: AppearanceEdits): Appearance {
  return { ...base, ...edits, presentation: { ...base.presentation, ...edits.presentation } };
}

export function editAppearance<K extends keyof Appearance>(
  base: Appearance,
  edits: AppearanceEdits,
  key: K,
  value: Appearance[K],
): AppearanceEdits {
  const next = { ...edits };
  if (key === "presentation") {
    const presentation = value as ScreenPresentation;
    const changed = Object.fromEntries(PRESENTATION_KEYS
      .filter((field) => presentation[field] !== base.presentation[field])
      .map((field) => [field, presentation[field]]));
    if (Object.keys(changed).length) next.presentation = changed;
    else delete next.presentation;
  } else if (value === base[key]) delete next[key];
  else Object.assign(next, { [key]: value });
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
  if (edits.presentation && PRESENTATION_KEYS.some((field) =>
    edits.presentation?.[field] !== undefined && edits.presentation[field] !== base.presentation[field],
  )) {
    patch.presentation = appearanceDraft(base, edits).presentation;
  }
  return patch;
}
