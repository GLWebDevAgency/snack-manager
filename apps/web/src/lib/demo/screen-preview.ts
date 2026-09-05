import {
  SCENE_MAX_LINES,
  SCENOGRAPHY_DEFAULT,
  SCREEN_POLL_INTERVAL_MS,
  SCREEN_SERVICE_LABELS,
  RESTAURANT_TZ,
  ScreenSceneSchema,
  isServedAt,
  logoPour,
  masquePourFond,
  type ScreenContent,
  type ScreenPreview,
  type ScreenProduct,
  type ScreenScenePayload,
} from "@sm/contracts";
import { Money } from "@sm/domain";
import { serviceClock, type DemoProduct, type DemoScreenRow, type DemoWorld } from "./state";

function product(p: DemoProduct): ScreenProduct {
  const prices = p.variants.flatMap((v) => {
    const price = (v as { price?: unknown } | null)?.price;
    return typeof price === "number" && Number.isFinite(price) ? [price] : [];
  });
  if (!prices.length) prices.push(p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const priceLabel = min === max
    ? Money.fromCents(min).format()
    : `${Money.fromCents(min).format().replace(/\s*€$/, "")} – ${Money.fromCents(max).format()}`;
  return {
    id: p._id, name: p.name, description: p.description,
    priceCents: min, priceMaxCents: max, priceLabel,
    photoUrl: p.photoUrl, photoPoint: null,
    isNew: p.isNew, outOfStock: p.outOfStock,
  };
}

/** La démo reste dans son service simulé, comme ses commandes. Aucun accès réseau ni écriture. */
export function previewDemoScreen(
  world: DemoWorld,
  draft: ScreenPreview,
  saved?: DemoScreenRow,
): ScreenContent {
  const instant = serviceClock(world.tenant, world.bootAt);
  const hour = Number(new Intl.DateTimeFormat("fr-FR", {
    timeZone: RESTAURANT_TZ, hour: "numeric", hourCycle: "h23",
  }).format(instant));
  const service = draft.service ?? (hour < 16 ? "lunch" : "dinner");
  const orientation = draft.orientation ?? saved?.orientation ?? "landscape";
  const theme = draft.theme ?? saved?.theme ?? "brand";
  const scenography = draft.scenography ?? saved?.scenography ?? (saved ? "ardoise" : SCENOGRAPHY_DEFAULT);
  const masque = masquePourFond(world.tenant.brand, theme);
  const categories = world.categories.filter((c) => c.active).sort((a, b) => a.order - b.order);
  const activeCategories = new Set(categories.map((c) => c._id));
  const products = world.products
    .filter((p) => p.active && activeCategories.has(p.categoryId ?? "") && isServedAt(p.tags, service))
    .sort((a, b) => a.order - b.order);
  const playlist = draft.playlist ?? saved?.playlist ?? categories.map((c) => ({
    kind: "category", categoryId: c._id, durationMs: 12_000,
  }));
  const scenes: ScreenScenePayload[] = [];
  playlist.forEach((raw, index) => {
    const parsed = ScreenSceneSchema.safeParse(raw);
    if (!parsed.success) return;
    const scene = parsed.data;
    const category = categories.find((c) => c._id === scene.categoryId);
    if (scene.kind === "category" && !category) return;
    const ids = new Map(products.map((p) => [p._id, p]));
    const selected = scene.kind === "category"
      ? products.filter((p) => p.categoryId === scene.categoryId)
      : scene.productIds.flatMap((id) => ids.has(id) ? [ids.get(id)!] : []);
    const promos = scene.kind === "promo" ? world.promotions.filter((p) => p.active).slice(0, 3).map((p) => ({
      id: p._id, title: p.name, description: p.description,
      label: p.kind === "percent" ? `−${p.value} %` : p.kind === "amount" ? `−${Money.fromCents(p.value).format()}` : "Offert",
    })) : [];
    if ((scene.kind === "category" || scene.kind === "featured") && !selected.length) return;
    if (scene.kind === "promo" && !promos.length) return;
    const visible = scene.kind === "custom" ? selected.slice(0, SCENE_MAX_LINES) : selected;
    const pages = Math.max(1, Math.ceil(visible.length / SCENE_MAX_LINES));
    const size = Math.max(1, Math.ceil(visible.length / pages));
    for (let page = 0; page < pages; page++) {
      scenes.push({
        id: `demo-${index}-${page}`, kind: scene.kind,
        title: scene.title ?? category?.name ?? (scene.kind === "promo" ? "Offres du moment" : "La sélection"),
        subtitle: pages > 1 ? `${page + 1} / ${pages}` : null,
        durationMs: scene.durationMs,
        products: visible.slice(page * size, (page + 1) * size).map(product),
        promos, nextOpening: null,
      });
    }
  });
  if (!scenes.length) scenes.push({
    id: "demo-brand", kind: "custom", title: world.tenant.name,
    subtitle: "Carte en cours de préparation", durationMs: 12_000,
    products: [], promos: [], nextOpening: null,
  });
  const visible = {
    screenId: saved?.id ?? "demo-preview", name: saved?.name ?? "Aperçu",
    orientation, theme, scenography, masque,
    brand: { slug: world.tenant.slug, name: world.tenant.name, logoUrl: logoPour(masque, "lockup"), accent: masque.palette.accent },
    service: service as "lunch" | "dinner", serviceLabel: SCREEN_SERVICE_LABELS[service], open: true, scenes,
  };
  return {
    ...visible,
    // Empreinte locale exacte : les horodatages ne déclenchent pas une nouvelle scène.
    contentHash: JSON.stringify(visible),
    generatedAt: new Date().toISOString(),
    dailyReloadAt: new Date(Date.now() + 86_400_000).toISOString(),
    pollIntervalMs: SCREEN_POLL_INTERVAL_MS, timezone: RESTAURANT_TZ,
  };
}
