import { err, ok, unwrap, type Result } from '../shared/result';
import { FunctionalColorLocked, InvalidBrandColor, InvalidRestaurant } from './errors';

/**
 * Marque grise.
 *
 * Ce qui appartient au restaurateur : son nom, son logo, UNE couleur d'accent.
 * C'est peu, et c'est voulu — un thème complet par client, c'est quatre apps à
 * re-tester à chaque onboarding.
 *
 * Ce qui ne lui appartient JAMAIS : les couleurs fonctionnelles. Vert = prêt,
 * rouge = urgent, ambre = en attente, chez tous les clients. Un extra formé
 * chez Class'Food le vendredi doit savoir lire l'écran cuisine d'O'Braise le
 * samedi sans réapprendre le code couleur. C'est une règle produit, pas une
 * limite technique : elle est donc exprimée ici, dans le domaine, et pas dans
 * une feuille de style où le premier `!important` venu l'effacerait.
 */

// ─── Couleur ───

/** Couleur hexadécimale normalisée, « #c8281e ». */
export class HexColor {
  private constructor(readonly value: string) {}

  static create(input: string): Result<HexColor, InvalidBrandColor> {
    const cleaned = input.trim().toLowerCase();
    // On accepte l'écriture courte : les chartes graphiques la donnent souvent.
    const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(cleaned);
    if (short) {
      const [, r, g, b] = short;
      return ok(new HexColor(`#${r}${r}${g}${g}${b}${b}`));
    }
    const long = /^#?([0-9a-f]{6})$/.exec(cleaned);
    if (long) return ok(new HexColor(`#${long[1]}`));

    return err(
      new InvalidBrandColor(
        `« ${input} » n'est pas une couleur. Attendu : un code hexadécimal, par exemple #C8281E.`,
      ),
    );
  }

  get rgb(): readonly [number, number, number] {
    const hex = this.value.slice(1);
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  /** Luminance relative WCAG — sert à choisir la couleur du texte posé dessus. */
  luminance(): number {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = this.rgb;
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  equals(other: HexColor): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/** Littéraux du design system : un échec serait une faute de frappe dans ce fichier. */
const color = (hex: string): HexColor => unwrap(HexColor.create(hex));

// ─── Couleurs fonctionnelles (verrouillées) ───

/**
 * Les trois sémantiques standard. Le type ne contient QUE des rôles
 * fonctionnels : l'accent n'y figure pas, et réciproquement — il est
 * impossible d'écrire `theme.customize({ ready: … })` sans erreur de
 * compilation.
 */
export const FUNCTIONAL_ROLES = ['ready', 'alert', 'preparing'] as const;
export type FunctionalRole = (typeof FUNCTIONAL_ROLES)[number];

export const FUNCTIONAL_ROLE_LABELS: Readonly<Record<FunctionalRole, string>> = {
  ready: 'Prêt',
  alert: 'Urgent',
  preparing: 'En préparation',
};

/** Valeurs du design system — identiques sur tous les comptes. */
export const FUNCTIONAL_COLORS: Readonly<Record<FunctionalRole, HexColor>> = Object.freeze({
  ready: color('#3fae4a'),
  alert: color('#c94b3f'),
  preparing: color('#e0973f'),
});

export function isFunctionalRole(key: string): key is FunctionalRole {
  return (FUNCTIONAL_ROLES as readonly string[]).includes(key);
}

/** Le seul jeton qu'un restaurant peut redéfinir. */
export const CUSTOMIZABLE_TOKENS = ['accent'] as const;
export type CustomizableToken = (typeof CUSTOMIZABLE_TOKENS)[number];

/** Jetons effectivement livrés aux quatre applications. */
export type ThemeToken = CustomizableToken | 'onAccent' | FunctionalRole;

// ─── Thème ───

export class BrandTheme {
  private constructor(
    readonly name: string,
    readonly accent: HexColor,
    /** `null` tant que le restaurateur n'a pas envoyé de fichier : on affiche l'initiale. */
    readonly logoUrl: string | null,
  ) {}

  /** Marque Snack Manager, servie avant tout onboarding. */
  static readonly HOUSE = new BrandTheme('Snack Manager', color('#c9a15a'), null);

  static create(brand: {
    name: string;
    accent: HexColor;
    logoUrl?: string | null;
  }): Result<BrandTheme, InvalidRestaurant> {
    const name = brand.name.trim();
    if (name.length === 0) {
      return err(new InvalidRestaurant('Le nom du restaurant est obligatoire'));
    }
    if (name.length > 120) {
      return err(new InvalidRestaurant('Le nom du restaurant dépasse 120 caractères'));
    }
    const logoUrl = brand.logoUrl?.trim();
    return ok(new BrandTheme(name, brand.accent, logoUrl ? logoUrl : null));
  }

  /** Initiale affichée tant qu'aucun logo n'est chargé (« C » pour Class'Food). */
  initial(): string {
    return this.name.slice(0, 1).toUpperCase();
  }

  withAccent(accent: HexColor): BrandTheme {
    return new BrandTheme(this.name, accent, this.logoUrl);
  }

  withLogo(logoUrl: string | null): BrandTheme {
    return new BrandTheme(this.name, this.accent, logoUrl);
  }

  /**
   * Applique la palette envoyée par l'écran d'onboarding.
   *
   * Le typage interdit déjà de viser une couleur fonctionnelle ; ce contrôle
   * couvre l'autre porte d'entrée : un JSON d'API, qui n'est typé par personne.
   * On refuse explicitement au lieu d'ignorer en silence — le gérant qui a
   * essayé de peindre son « prêt » en violet mérite de savoir pourquoi ça n'a
   * pas pris.
   */
  customize(
    overrides: Readonly<Partial<Record<CustomizableToken, HexColor>>>,
  ): Result<BrandTheme, FunctionalColorLocked> {
    for (const key of Object.keys(overrides)) {
      if (isFunctionalRole(key)) {
        return err(new FunctionalColorLocked(FUNCTIONAL_ROLE_LABELS[key]));
      }
    }
    return ok(overrides.accent ? this.withAccent(overrides.accent) : this);
  }

  /**
   * Couleur du texte posé sur l'accent.
   *
   * Un accent clair (le jaune d'un kebab, le vert pomme d'un poké) rendrait le
   * libellé blanc du bouton « Commander » illisible. On bascule sur le noir
   * au-delà du seuil WCAG plutôt que d'imposer une palette au restaurateur.
   */
  onAccent(): HexColor {
    return this.accent.luminance() > 0.45 ? color('#000000') : color('#ffffff');
  }

  /**
   * Palette effective des quatre applications : l'accent du restaurant,
   * les fonctionnelles du standard. Une seule source pour les quatre apps.
   */
  tokens(): Readonly<Record<ThemeToken, HexColor>> {
    return Object.freeze({
      accent: this.accent,
      onAccent: this.onAccent(),
      ...FUNCTIONAL_COLORS,
    });
  }
}
