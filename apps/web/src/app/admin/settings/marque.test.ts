import { describe, expect, it } from "vitest";
import {
  BrandStrictSchema,
  COUPLES_CONTRASTE,
  DIRECTIONS,
  PRESET_KEYS,
  TYPE_PAIRS,
  BRAND_SHAPES,
  BRAND_MOTIONS,
  contraste,
  type Brand,
  type CoupleContraste,
  type MediaVue,
} from "@sm/contracts";
import {
  COUPLES_LABELS,
  DIRECTIONS_LABELS,
  EMPLACEMENTS,
  FORMES,
  MOUVEMENTS,
  PAIRES_LABELS,
  ROLES,
  appliquerDirection,
  avertissementDeCotes,
  directionPortee,
  lireEmplacement,
  messageDuRefus,
  normaliserHex,
  poserEmplacement,
  ratioDit,
  roleCorrige,
  servableCommeImageDeMarque,
  verdictsDerivesEnEchec,
  verdictsPosables,
} from "./marque";

const LOGOS = {
  mark: { light: "https://sm.test/a.png", dark: "https://sm.test/b.png" },
  lockup: { light: "https://sm.test/c.png", dark: "https://sm.test/d.png" },
};

const media = (bout: Partial<MediaVue> = {}): MediaVue => ({
  id: "m1",
  genre: "photo",
  empreinte: "0".repeat(32),
  type: "image/png",
  octets: 120_000,
  largeur: 1600,
  hauteur: 1200,
  point: { x: 0.5, y: 0.5 },
  alt: "",
  stockage: "objet",
  origine: "depot",
  auteur: null,
  deposeLe: null,
  urls: {
    vignette: "https://api.test/public/medias/t1/m1",
    carte: "https://api.test/public/medias/t1/m1",
    fiche: "https://api.test/public/medias/t1/m1",
    bandeau: "https://api.test/public/medias/t1/m1",
  },
  utilisePar: 0,
  ...bout,
});

// ─────────────────────────────────────────────────────────────
// Les tables de libellés ne peuvent pas dériver du contrat
// ─────────────────────────────────────────────────────────────

describe("les tables de l'écran suivent le contrat", () => {
  it("nomme les dix-neuf couples de contraste, ni plus ni moins", () => {
    // Un couple ajouté au contrat sans libellé s'afficherait en `ink/ground`
    // sur le seul écran d'accessibilité du produit ; un libellé orphelin
    // survivrait à un couple retiré. Les deux sens sont vérifiés.
    expect(Object.keys(COUPLES_LABELS).sort()).toEqual([...COUPLES_CONTRASTE].sort());
  });

  it("nomme les six directions et les dix accords typographiques", () => {
    expect(Object.keys(DIRECTIONS_LABELS).sort()).toEqual([...PRESET_KEYS].sort());
    expect(Object.keys(PAIRES_LABELS).sort()).toEqual(Object.keys(TYPE_PAIRS).sort());
  });

  it("nomme les trois formes et les deux mouvements", () => {
    expect(Object.keys(FORMES).sort()).toEqual([...BRAND_SHAPES].sort());
    expect(Object.keys(MOUVEMENTS).sort()).toEqual([...BRAND_MOTIONS].sort());
  });

  it("propose exactement les cinq rôles STOCKÉS — le reste est dérivé", () => {
    expect(ROLES.map((r) => r.cle).sort()).toEqual(
      Object.keys(DIRECTIONS.nuit.palette).sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Les directions
// ─────────────────────────────────────────────────────────────

describe("la direction qu'un masque porte", () => {
  it("reconnaît les six directions telles que le contrat les livre", () => {
    for (const cle of PRESET_KEYS) {
      expect(directionPortee(DIRECTIONS[cle])).toBe(cle);
    }
  });

  it("reconnaît encore une direction quand le restaurateur y a mis SES logos", () => {
    // C'est tout l'intérêt : les six directions du contrat sont livrées sans
    // logo, un vrai masque en porte. La coche doit rester sur la vignette.
    const avecLogos: Brand = { ...DIRECTIONS.brasserie, logo: LOGOS, hero: "https://sm.test/h.jpg" };
    expect(directionPortee(avecLogos)).toBe("brasserie");
  });

  it("ne reconnaît plus rien dès qu'une couleur est retouchée", () => {
    const retouche: Brand = {
      ...DIRECTIONS.soleil,
      palette: { ...DIRECTIONS.soleil.palette, accent: "#123456" },
    };
    expect(directionPortee(retouche)).toBeNull();
  });

  it("ne se fie pas au champ `preset` stocké, qui ment après une retouche", () => {
    const menteur: Brand = {
      ...DIRECTIONS.nuit,
      palette: { ...DIRECTIONS.nuit.palette, ink: "#ffffff" },
      preset: "nuit",
    };
    expect(menteur.preset).toBe("nuit");
    expect(directionPortee(menteur)).toBeNull();
  });
});

describe("poser une direction", () => {
  const depart: Brand = { ...DIRECTIONS.nuit, logo: LOGOS, hero: "https://sm.test/h.jpg" };

  it("préserve les accroches lorsque la direction change", () => {
    const brand = { ...depart, tagline: "Fait maison.", taglineSub: "À emporter." };
    expect(appliquerDirection(brand, "soleil")).toMatchObject({ tagline: brand.tagline, taglineSub: brand.taglineSub, hero: brand.hero });
  });

  it("remplace le masque entier", () => {
    const apres = appliquerDirection(depart, "marche");
    expect(apres.palette).toEqual(DIRECTIONS.marche.palette);
    expect(apres.mode).toBe(DIRECTIONS.marche.mode);
    expect(apres.type.pair).toBe(DIRECTIONS.marche.type.pair);
    expect(apres.shape).toBe(DIRECTIONS.marche.shape);
    expect(apres.motion).toBe(DIRECTIONS.marche.motion);
    expect(apres.preset).toBe("marche");
  });

  it("ne touche JAMAIS aux images — un geste de mise en page ne détruit pas un fichier", () => {
    const apres = appliquerDirection(depart, "neon");
    expect(apres.logo).toEqual(LOGOS);
    expect(apres.hero).toBe("https://sm.test/h.jpg");
  });

  it("rend un masque que la route d'écriture accepterait", () => {
    for (const cle of PRESET_KEYS) {
      expect(BrandStrictSchema.safeParse(appliquerDirection(depart, cle)).success).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Le cœur : la correction d'un couple en échec
// ─────────────────────────────────────────────────────────────

describe("la correction proposée par un verdict", () => {
  /** Un masque dont le couple visé échoue à coup sûr. */
  const casse: Record<"ink/ground" | "ink/surface" | "onAccent/accent", Brand> = {
    "ink/ground": {
      ...DIRECTIONS.brasserie,
      palette: { ...DIRECTIONS.brasserie.palette, ground: "#ffffff", ink: "#efe9dd" },
    },
    "ink/surface": {
      ...DIRECTIONS.brasserie,
      palette: { ...DIRECTIONS.brasserie.palette, surface: "#ffffff", ink: "#efe9dd" },
    },
    "onAccent/accent": {
      ...DIRECTIONS.nuit,
      palette: { ...DIRECTIONS.nuit.palette, accent: "#c9a15a", onAccent: "#b9b0a0" },
    },
  };

  const verdictDe = (brand: Brand, couple: CoupleContraste) => {
    const v = contraste(brand).verdicts.find((x) => x.couple === couple);
    if (!v) throw new Error(`couple absent : ${couple}`);
    return v;
  };

  it.each(Object.keys(casse) as (keyof typeof casse)[])(
    "« %s » : la nuance proposée, posée dans le rôle rendu, fait repasser le couple",
    (couple) => {
      const brand = casse[couple];
      const avant = verdictDe(brand, couple);
      expect(avant.ok).toBe(false);
      expect(avant.derive).toBe(false);
      expect(avant.proposition).not.toBeNull();

      const role = roleCorrige(couple);
      expect(role).not.toBeNull();
      const corrige: Brand = {
        ...brand,
        palette: { ...brand.palette, [role as string]: avant.proposition as string },
      };
      const apres = verdictDe(corrige, couple);
      expect(apres.ok).toBe(true);
      expect(apres.ratio).toBeGreaterThanOrEqual(avant.seuil);
    },
  );

  it("ne rend AUCUN rôle pour un couple dérivé — il n'y a pas de champ où l'écrire", () => {
    for (const couple of COUPLES_CONTRASTE) {
      const derive = !["ink/ground", "ink/surface", "onAccent/accent"].includes(couple);
      if (derive) expect(roleCorrige(couple)).toBeNull();
      else expect(roleCorrige(couple)).not.toBeNull();
    }
  });

  it("sépare ce que le restaurateur pose de ce qui en découle", () => {
    const { verdicts } = contraste(DIRECTIONS.soleil);
    expect(verdictsPosables(verdicts).map((v) => v.couple)).toEqual([
      "ink/ground",
      "ink/surface",
      "onAccent/accent",
    ]);
    // Les six directions du catalogue passent toutes : rien à montrer.
    expect(verdictsDerivesEnEchec(verdicts)).toEqual([]);
  });

  it("écrit un ratio comme un chiffre français", () => {
    expect(ratioDit(4.5)).toBe("4,50:1");
    expect(ratioDit(12.345)).toBe("12,35:1");
  });
});

// ─────────────────────────────────────────────────────────────
// Les cinq emplacements d'image
// ─────────────────────────────────────────────────────────────

describe("les emplacements d'image", () => {
  it("couvre les cinq champs d'image du contrat, et rien d'autre", () => {
    // Ce sont exactement les cinq que l'API tient à sa liste blanche
    // d'origines (`urlsDuMasque`) : un emplacement manquant ici serait un
    // emplacement qu'aucun écran ne remplit — le défaut qu'on referme.
    expect(EMPLACEMENTS.map((e) => e.cle)).toEqual([
      "mark.dark",
      "mark.light",
      "lockup.dark",
      "lockup.light",
      "hero",
    ]);
  });

  it("écrit et relit chaque emplacement sans en toucher un autre", () => {
    let brand: Brand = DIRECTIONS.nuit;
    for (const e of EMPLACEMENTS) {
      brand = poserEmplacement(brand, e.cle, `https://sm.test/${e.cle}.png`);
    }
    for (const e of EMPLACEMENTS) {
      expect(lireEmplacement(brand, e.cle)).toBe(`https://sm.test/${e.cle}.png`);
    }
    expect(BrandStrictSchema.safeParse(brand).success).toBe(true);
  });

  it("retire une image sans emporter les autres", () => {
    let brand: Brand = { ...DIRECTIONS.nuit, logo: LOGOS, hero: "https://sm.test/h.jpg" };
    brand = poserEmplacement(brand, "mark.light", null);
    expect(lireEmplacement(brand, "mark.light")).toBeNull();
    expect(lireEmplacement(brand, "mark.dark")).toBe(LOGOS.mark.dark);
    expect(lireEmplacement(brand, "hero")).toBe("https://sm.test/h.jpg");
  });
});

describe("ce qui peut servir d'image de marque", () => {
  it("accepte un média hébergé chez nous", () => {
    expect(servableCommeImageDeMarque(media(), "fiche")).toBe(true);
  });

  it("refuse une photo héritée du pilote, dont l'adresse est relative", () => {
    // `/photos/kebab.webp` est servi par le paquet web : il convient à la
    // carte de CETTE application, pas à la caisse ni au manifeste. L'API le
    // refuserait en 400 (`ImageUrl` exige http(s)).
    const heritee = media({
      stockage: "heritee",
      urls: {
        vignette: "/photos/kebab.webp",
        carte: "/photos/kebab.webp",
        fiche: "/photos/kebab.webp",
        bandeau: "/photos/kebab.webp",
      },
    });
    expect(servableCommeImageDeMarque(heritee, "fiche")).toBe(false);
  });
});

describe("l'avertissement de cotes", () => {
  const marque = EMPLACEMENTS.find((e) => e.cle === "mark.dark")!;
  const horizontale = EMPLACEMENTS.find((e) => e.cle === "lockup.dark")!;
  const accueil = EMPLACEMENTS.find((e) => e.cle === "hero")!;

  it("se tait quand l'image est assez grande", () => {
    expect(avertissementDeCotes(marque, media({ largeur: 512, hauteur: 512 }))).toBeNull();
    expect(avertissementDeCotes(horizontale, media({ largeur: 1024, hauteur: 256 }))).toBeNull();
    expect(avertissementDeCotes(accueil, media({ largeur: 1600, hauteur: 900 }))).toBeNull();
  });

  it("juge la marque sur son PLUS PETIT côté — un logo carré n'a pas de largeur privilégiée", () => {
    const large = media({ largeur: 900, hauteur: 120 });
    expect(avertissementDeCotes(marque, large)).toContain("256 px");
  });

  it("juge l'horizontale sur sa largeur, et l'accueil sur la sienne", () => {
    expect(avertissementDeCotes(horizontale, media({ largeur: 400, hauteur: 400 }))).toContain(
      "512",
    );
    expect(avertissementDeCotes(accueil, media({ largeur: 800, hauteur: 450 }))).toContain("1600");
  });

  it("dit qu'il ne sait pas plutôt que d'inventer, quand l'en-tête ne livre pas les cotes", () => {
    const inconnue = media({ largeur: null, hauteur: null });
    expect(avertissementDeCotes(marque, inconnue)).toContain("ne se lisent pas");
  });

  it("n'interdit jamais — la phrase le dit à celui qui la lit", () => {
    expect(avertissementDeCotes(marque, media({ largeur: 64, hauteur: 64 }))).toContain(
      "s'enregistre quand même",
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Le refus du serveur
// ─────────────────────────────────────────────────────────────

describe("le refus du serveur, dit à un restaurateur", () => {
  it("nomme les couples d'un refus de contraste, en français", () => {
    const dit = messageDuRefus(400, {
      message: "Contraste insuffisant",
      verdicts: [{ couple: "ink/ground" }, { couple: "onAccent/accent" }],
    });
    expect(dit).toContain("Le texte sur le fond");
    expect(dit).toContain("Le texte dans le bouton d'accent");
    expect(dit).not.toContain("ink/ground");
  });

  it("nomme les adresses refusées et les hôtes admis", () => {
    const dit = messageDuRefus(400, {
      message: "Origine d’image non autorisée",
      refusees: ["https://ailleurs.fr/logo.png"],
      hotesAutorises: ["snackmanager.app"],
    });
    expect(dit).toContain("https://ailleurs.fr/logo.png");
    expect(dit).toContain("snackmanager.app");
  });

  it("ne recrache pas une erreur de schéma zod à un gérant", () => {
    const dit = messageDuRefus(400, {
      message: "Validation failed",
      issues: [{ path: "palette.ink", message: "Couleur attendue au format #rrggbb" }],
    });
    expect(dit).not.toContain("palette.ink");
    expect(dit).toContain("Rechargez la page");
  });

  it("distingue une session insuffisante d'une panne", () => {
    expect(messageDuRefus(403, {})).toContain("session");
    expect(messageDuRefus(401, {})).toContain("session");
  });

  it("relaie le message du serveur quand il en a un, et se replie sinon", () => {
    expect(messageDuRefus(503, { message: "L'hébergement d'images n'est pas activé." })).toBe(
      "L'hébergement d'images n'est pas activé.",
    );
    expect(messageDuRefus(500, null)).toContain("réessayez");
  });
});

describe("la saisie d'une couleur", () => {
  it("accepte une saisie sans dièse et en majuscules", () => {
    expect(normaliserHex(" C9A15A ")).toBe("#c9a15a");
    expect(normaliserHex("#E07A1F")).toBe("#e07a1f");
  });

  it("rend la saisie telle quelle tant qu'elle n'est pas une couleur", () => {
    expect(normaliserHex("bleu")).toBe("bleu");
    expect(normaliserHex("#12")).toBe("#12");
  });
});
