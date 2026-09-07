import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELAI_MAX_LOGO_MS,
  POIDS_MAX_LOGO,
  hotesDeLogos,
  logoAutorise,
  logoIncorpore,
} from "./logo-incorpore";

/**
 * CE QUI DÉCIDE SI LE LOGO ENTRE DANS L'ICÔNE.
 *
 * Chacun de ces refus a une conséquence qu'on ne peut plus rattraper : Android
 * fige l'icône à l'installation. Un logo qui n'aurait pas dû être incorporé le
 * reste pour toujours sur ce téléphone, et un logo refusé à tort prive le
 * restaurateur de la seule surface qu'il regardait.
 */

/** Un WebP minimal, valide par sa signature RIFF/WEBP. */
const webp = (octets = 32) => {
  const b = Buffer.alloc(octets);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(octets - 8, 4);
  b.write("WEBP", 8, "latin1");
  b.write("VP8 ", 12, "latin1");
  return Uint8Array.from(b);
};

/** Des octets quelconques, sous une forme que `Response` accepte. */
const octetsDe = (texte: string) => Uint8Array.from(Buffer.from(texte, "latin1"));

const reponse = (corps: Uint8Array<ArrayBuffer>, entetes: Record<string, string> = {}) =>
  new Response(corps, { status: 200, headers: entetes });

const HOTES = ["api.exemple.fr"] as const;
const ADRESSE = "https://api.exemple.fr/public/medias/t1/9f2c1b";

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (impl: (url: string) => Promise<Response>) => {
  const espion = vi.fn((entree: unknown, options?: RequestInit) => {
    void options;
    return impl(String(entree));
  });
  vi.stubGlobal("fetch", espion);
  return espion;
};

describe("d’où le logo a le droit de venir", () => {
  it.each([
    "ftp://api.exemple.fr/logo.png",
    "file://api.exemple.fr/logo.png",
    "ws://api.exemple.fr/logo.png",
    "https://user@api.exemple.fr/logo.png",
    "https://user:password@api.exemple.fr/logo.png",
    "https://:password@api.exemple.fr/logo.png",
  ])("refuse protocole ou user-info avant tout téléchargement : %s", async url => {
    const espion = stubFetch(async () => reponse(webp()));
    expect(logoAutorise(url, HOTES)).toBe(false);
    expect(await logoIncorpore(url, { hotes: HOTES })).toBeNull();
    expect(espion).not.toHaveBeenCalled();
  });

  it("préserve l’hôte et le port de développement configurés", async () => {
    const hotes = hotesDeLogos({ NEXT_PUBLIC_API_URL: "http://localhost:3001" });
    const url = "http://localhost:3001/public/medias/t1/x";
    const espion = stubFetch(async () => reponse(webp()));
    expect(logoAutorise(url, hotes)).toBe(true);
    expect(await logoIncorpore(url, { hotes })).toMatch(/^data:image\/webp;base64,/);
    expect(espion.mock.calls[0]?.[0]).toBe(url);
  });

  it("accepte l’API que ce Web interroge, et ses sous-domaines", () => {
    const hotes = hotesDeLogos({ NEXT_PUBLIC_API_URL: "https://api.exemple.fr" });
    expect(logoAutorise("https://api.exemple.fr/public/medias/t1/x", hotes)).toBe(true);
    expect(logoAutorise("https://cdn.api.exemple.fr/x", hotes)).toBe(true);
  });

  it("refuse un hôte qui se contente de RESSEMBLER au nôtre", () => {
    /*
     * Le suffixe est comparé avec son point : sans lui, `evilapi.exemple.fr`
     * — ou pire, `api.exemple.fr.mechant.fr` — passerait pour chez nous, et
     * notre serveur irait chercher les octets de quelqu'un d'autre à chaque
     * icône demandée.
     */
    expect(logoAutorise("https://evilapi.exemple.fr/x", HOTES)).toBe(false);
    expect(logoAutorise("https://api.exemple.fr.mechant.fr/x", HOTES)).toBe(false);
    // L'user-info n'est pas l'hôte : `new URL` le sait, un découpage à la main non.
    expect(logoAutorise("https://api.exemple.fr@mechant.fr/x", HOTES)).toBe(false);
    expect(logoAutorise("pas une url", HOTES)).toBe(false);
  });

  it("lit indifféremment une origine complète et un hôte nu", () => {
    const hotes = hotesDeLogos({
      NEXT_PUBLIC_API_URL: "http://localhost:3001",
      SM_IMAGE_ORIGINS: " images.exemple.fr , https://r2.exemple.fr/logos/ ",
    });
    expect(hotes).toContain("localhost");
    expect(hotes).toContain("images.exemple.fr");
    expect(hotes).toContain("r2.exemple.fr");
  });

  it("n’envoie AUCUNE requête vers un hôte hors liste", async () => {
    const espion = stubFetch(async () => reponse(webp()));
    expect(await logoIncorpore("https://mechant.fr/logo.png", { hotes: HOTES })).toBeNull();
    expect(espion).not.toHaveBeenCalled();
  });
});

describe("ce que le logo doit être pour entrer dans l’icône", () => {
  it("interdit au transport de suivre une redirection hors de l’hôte vérifié", async () => {
    const espion = stubFetch(async () => reponse(webp()));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toMatch(/^data:image\/webp;base64,/);
    expect(espion.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("rend une adresse `data:` typée par les OCTETS, pas par l’URL", async () => {
    /*
     * La médiathèque sert ses objets sans extension : le nom de fichier ne
     * peut donc rien dire du format. C'est la signature RIFF/WEBP qui décide,
     * et c'est elle qu'on retrouve dans le type déclaré.
     */
    stubFetch(async () => reponse(webp()));
    const uri = await logoIncorpore(ADRESSE, { hotes: HOTES });
    expect(uri).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(uri!.split(",")[1]!, "base64").subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  it("REFUSE un SVG, quel que soit ce que la réponse annonce", async () => {
    /*
     * Le vecteur d'attaque de l'exercice : un SVG incorporé dans un SVG y
     * rapatrie script, styles et sous-ressources. `detecterImage` ne connaît
     * que PNG, JPEG et WebP — et c'est le seul juge, pas le `Content-Type`.
     */
    stubFetch(async () =>
      reponse(octetsDe('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        "Content-Type": "image/png",
      }),
    );
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();
  });

  it("refuse ce qui n’est pas une image du tout", async () => {
    stubFetch(async () => reponse(octetsDe("GIF89a________")));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();
  });
});

describe("le poids, l’échec et le délai", () => {
  it("annule le flux sans lire quand le poids annoncé dépasse le plafond", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    stubFetch(async () => new Response(body, { headers: { "Content-Length": String(POIDS_MAX_LOGO + 1) } }));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "12"])("arrête et annule au premier dépassement réel, poids annoncé %s", async annonce => {
    let lus = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (lus === 3) { controller.close(); return; }
        lus++;
        controller.enqueue(webp());
      },
      cancel,
    }, { highWaterMark: 0 });
    stubFetch(async () => new Response(body, { headers: annonce ? { "Content-Length": annonce } : {} }));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES, poidsMax: 40 })).toBeNull();
    expect(lus).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it("accepte exactement le plafond après plusieurs morceaux sans arrayBuffer", async () => {
    const image = webp();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(image.slice(0, 10));
      controller.enqueue(image.slice(10));
      controller.close();
    } });
    const response = new Response(body);
    const arrayBuffer = vi.spyOn(response, "arrayBuffer");
    stubFetch(async () => response);
    const uri = await logoIncorpore(ADRESSE, { hotes: HOTES, poidsMax: image.byteLength });
    expect(uri).toBe(`data:image/webp;base64,${Buffer.from(image).toString("base64")}`);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("refuse sur le poids ANNONCÉ, avant même de lire le corps", async () => {
    let lu = false;
    stubFetch(async () => {
      const r = reponse(webp(), { "Content-Length": String(POIDS_MAX_LOGO + 1) });
      const original = r.arrayBuffer.bind(r);
      r.arrayBuffer = async () => {
        lu = true;
        return original();
      };
      return r;
    });
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();
    expect(lu, "deux mégaoctets lus pour rien").toBe(false);
  });

  it("refuse aussi sur le poids RÉEL — un `Content-Length` est une promesse", async () => {
    stubFetch(async () => reponse(webp(64), { "Content-Length": "12" }));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES, poidsMax: 32 })).toBeNull();
  });

  it("rend `null` sans lever sur un 404, un réseau coupé ou un délai dépassé", async () => {
    stubFetch(async () => new Response(null, { status: 404 }));
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();

    stubFetch(async () => {
      throw new Error("réseau");
    });
    expect(await logoIncorpore(ADRESSE, { hotes: HOTES })).toBeNull();
  });

  it("borne l’attente par un signal, et n’attend pas indéfiniment", async () => {
    /*
     * Le signal, pas une course de promesses : il ferme la connexion au lieu
     * de laisser le téléchargement se poursuivre derrière un `null` déjà rendu.
     * Le délai par défaut reste court parce que cette icône est demandée
     * PENDANT une installation — et qu'elle ne sera plus jamais relue après.
     */
    expect(DELAI_MAX_LOGO_MS).toBeLessThanOrEqual(2000);
    const espion = stubFetch(async () => reponse(webp()));
    await logoIncorpore(ADRESSE, { hotes: HOTES, delaiMs: 5 });
    const signal = espion.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await new Promise((r) => setTimeout(r, 20));
    expect(signal!.aborted).toBe(true);
  });
});
