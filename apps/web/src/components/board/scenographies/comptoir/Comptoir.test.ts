import { afterEach, describe, expect, it, vi } from "vitest";
import { chargerPhoto } from "./Comptoir";

describe("photo TV — seule une image décodée peut remplacer la précédente", () => {
  afterEach(() => vi.unstubAllGlobals());

  function imageFausse() {
    let decode!: () => void;
    let rejectDecode!: () => void;
    const decoding = new Promise<void>((resolve, reject) => {
      decode = resolve;
      rejectDecode = () => reject(new Error("image corrompue"));
    });
    const image = {
      src: "", naturalWidth: 640, naturalHeight: 480,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      decode: vi.fn(() => decoding),
    };
    vi.stubGlobal("Image", class { constructor() { return image; } });
    return { image, decode, rejectDecode };
  }

  it("attend le décodage après load, puis conserve la définition source", async () => {
    const { image, decode } = imageFausse();
    const result = chargerPhoto("/burger.webp", new AbortController().signal);
    const done = vi.fn();
    void result.then(done);
    expect(image.src).toBe("/burger.webp");
    image.onload!();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    decode();
    await expect(result).resolves.toEqual({ url: "/burger.webp", width: 640, height: 480 });
    expect(image.onload).toBeNull();
  });

  it("une URL cassée devient un repli, jamais une image cassée dans le rendu", async () => {
    const { image } = imageFausse();
    const result = chargerPhoto("/missing.webp", new AbortController().signal);
    image.onerror!();
    await expect(result).resolves.toBeNull();
  });

  it("une image chargée mais indécodable devient aussi un repli", async () => {
    const { image, rejectDecode } = imageFausse();
    const result = chargerPhoto("/corrupt.webp", new AbortController().signal);
    image.onload!();
    rejectDecode();
    await expect(result).resolves.toBeNull();
  });

  it("un remplacement dépassé ne revient pas après son décodage tardif", async () => {
    const { image, decode } = imageFausse();
    const abort = new AbortController();
    const result = chargerPhoto("/old-request.webp", abort.signal);
    image.onload!();
    abort.abort();
    decode();
    await expect(result).resolves.toBeNull();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });
});
