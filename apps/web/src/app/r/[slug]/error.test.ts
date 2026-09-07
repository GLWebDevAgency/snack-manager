import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import EmbedError from "../../embed/[slug]/error";
import RestaurantError from "./error";

// Next's font loader runs at build time, not in the unit-test runtime.
vi.mock("@/components/masque/polices", () => ({ classesPolices: "fixture-fonts" }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  // The only hook in these boundaries logs the error; it does not drive retry.
  useEffect: vi.fn(),
}));

type Button = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function buttonsIn(node: ReactNode): Button[] {
  const buttons: Button[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return;
    if (child.type === "button") buttons.push(child);
    buttons.push(...buttonsIn(child.props.children));
  });
  return buttons;
}

const boundaries = [
  { route: "/r/[slug]", Component: RestaurantError },
  { route: "/embed/[slug]", Component: EmbedError },
];

describe.each(boundaries)("reprise du chargement $route", ({ Component }) => {
  const error = Object.assign(new Error("MongoServerError: private diagnostic"), {
    digest: "fixture-reference",
  });

  it("appelle retry pour recharger les données serveur, jamais reset", () => {
    const props = { error, retry: vi.fn(), reset: vi.fn() };
    const buttons = buttonsIn(Component(props));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.children).toBe("Réessayer");
    expect(buttons[0].props.onClick).toBeTypeOf("function");
    buttons[0].props.onClick?.();
    expect(props.retry).toHaveBeenCalledExactlyOnceWith();
    expect(props.reset).not.toHaveBeenCalled();
  });

  it("conserve le masque de repli et le bouton tactile existants", () => {
    const props = { error, retry: vi.fn(), reset: vi.fn() };
    const html = renderToStaticMarkup(Component(props));
    expect(html).toContain("La carte ne s’est pas chargée");
    expect(html).toContain("fixture-fonts");
    expect(html).toContain("bg-bg");
    expect(html).toContain("cf-press");
    expect(html).toContain("min-h-11");
    expect(html).toContain("rounded-pill bg-accent");
    expect(html).toContain("text-onaccent");
    expect(html).toContain('type="button"');
  });

  it("explique la panne sans affirmer que le restaurant est ouvert ni exposer l’erreur", () => {
    const props = { error, retry: vi.fn(), reset: vi.fn() };
    const html = renderToStaticMarkup(Component(props));
    expect(html).toContain("Le service est momentanément injoignable.");
    expect(html).not.toContain("toujours ouvert");
    expect(html).not.toContain(error.message);
  });
});

it("conserve uniquement la référence de diagnostic dans la vitrine", () => {
  const props = {
    error: Object.assign(new Error("private diagnostic"), { digest: "fixture-reference" }),
    retry: vi.fn(),
    reset: vi.fn(),
  };
  expect(renderToStaticMarkup(RestaurantError(props))).toContain("Référence : fixture-reference");
  expect(renderToStaticMarkup(EmbedError(props))).not.toContain("fixture-reference");
});
