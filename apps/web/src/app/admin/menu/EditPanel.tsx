"use client";

/**
 * Panneau d'édition inline (spec backoffice-restaurant §7.3) enrichi de la
 * section « Recette & marge » (contexte supply) : coût matière, marge %,
 * allergènes, éditeur de lignes de recette (GET/PUT /supply/products/:ref/bom).
 * Sauvegarde bufferisée : « Enregistrer » → PATCH produit (+ PUT medias si
 * les photos ont bougé, + PUT bom si la recette a changé) ; « Fermer »
 * abandonne les modifications — après confirmation dès que la fiche a changé.
 *
 * Chaque envoi est DIFFÉRENTIEL et chacun a sa route : le correctif du produit
 * ne porte que ce que le gérant a touché (cf. `save()` et le groupe réservé
 * « supplements »), les photos passent par la médiathèque, la recette par le
 * contexte supply. Trois vérités, trois portes, aucune écrasée par mégarde.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  MEASURE_UNITS,
  type Allergen,
  type BomResponse,
  type CostEntry,
  type MeasureUnit,
  type SupplyIngredient,
} from "@sm/contracts";
import { DAYPART_TAGS } from "@sm/contracts";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import {
  Btn,
  Chip,
  Field,
  IconBtn,
  Input,
  Modal,
  Pill,
  Select,
  Skeleton,
} from "@/components/ui";
import {
  effectivePrice,
  type Category,
  type Mediatheque,
  type OptionGroup,
  type Product,
  type Variant,
} from "./types";
import { PhotosDuPlat } from "./PhotosDuPlat";
import { EditeurOptions, EditeurVariantes, figerLesClefs } from "./VariantesOptions";
import {
  erreurEnregistrementProduit,
  normaliserGroupesEdition,
  validerModificationProduit,
} from "./product-validation";

type LineDraft = { ingredientId: string; qty: string; unit: MeasureUnit };

type Props = {
  mode: "edit" | "create";
  /** Produit édité (mode edit). */
  product?: Product;
  /** Catégorie de rattachement présélectionnée (mode create). */
  createCategoryId?: string;
  categories: Category[];
  /** Coût/marge du lot GET /supply/costs — affiché en attendant le BOM. */
  initialCost?: CostEntry;
  /** Liste d'ingrédients supply (mise en cache au niveau page). */
  loadIngredients: () => Promise<SupplyIngredient[]>;
  /** Médiathèque du restaurant (mise en cache au niveau page). */
  chargerMediatheque: (forcer?: boolean) => Promise<Mediatheque>;
  onClose: () => void;
  /** Sauvegarde réussie — le parent toaste, ferme et recharge. */
  onSaved: (message: string) => void;
  isFeatured?: boolean;
  onManageFeatured?: () => void;
};

/** g/ml → millièmes d'unité de base (kg/l) — miroir de lineCostCents (@sm/supply). */
const toBaseUnit = (qty: number, unit: MeasureUnit) =>
  unit === "g" || unit === "ml" ? qty / 1000 : qty;

const lineCostCents = (qty: number, unit: MeasureUnit, costPerUnitCents: number) =>
  Math.round(toBaseUnit(qty, unit) * costPerUnitCents);

const parseQty = (raw: string): number =>
  Number.parseFloat(raw.replace(",", "."));

const serializeLines = (lines: LineDraft[]) =>
  JSON.stringify(lines.map((l) => [l.ingredientId, parseQty(l.qty) || 0, l.unit]));

export function EditPanel({
  mode,
  product,
  createCategoryId,
  categories,
  initialCost,
  loadIngredients,
  chargerMediatheque,
  onClose,
  onSaved,
  isFeatured = false,
  onManageFeatured,
}: Props) {
  const [name, setName] = useState(product?.name ?? "");
  const [catId, setCatId] = useState(
    mode === "create" ? (createCategoryId ?? "") : (product?.categoryId ?? ""),
  );
  const [desc, setDesc] = useState(product?.description ?? "");
  const [isNew, setIsNew] = useState(product?.isNew ?? false);

  /**
   * Tailles et options — l'écran ne savait pas les éditer, alors que le
   * contrat les accepte depuis le premier jour. Un produit à variantes voyait
   * même son prix passer en lecture seule dans la grille, avec un message qui
   * renvoyait vers CE panneau : le prix n'était modifiable nulle part.
   */
  const [variants, setVariants] = useState<Variant[]>(() => product?.variants ?? []);
  const [groups, setGroups] = useState<OptionGroup[]>(() => normaliserGroupesEdition(product?.optionGroups ?? []));
  const variantsInitiales = useMemo(() => JSON.stringify(product?.variants ?? []), [product]);
  const groupsInitiaux = useMemo(() => JSON.stringify(normaliserGroupesEdition(product?.optionGroups ?? [])), [product]);

  /**
   * Les photos du plat — identifiants, DANS L'ORDRE, la première étant la
   * principale.
   *
   * Elles ne rejoignent PAS le correctif du produit : `PUT
   * /products/:id/medias` attache et réordonne d'un seul geste, et c'est la
   * médiathèque — pas le menu — qui sait ce qu'est un média valide et à qui il
   * appartient. Bufferisées ici comme le reste de la fiche : « Enregistrer »
   * les envoie, « Fermer » les abandonne.
   */
  const [photos, setPhotos] = useState<string[]>(() => product?.medias ?? []);
  const photosInitiales = useMemo(() => (product?.medias ?? []).join(","), [product]);

  /**
   * Services d'affichage sur les écrans de salle.
   *
   * La règle est celle de `DAYPART_TAGS` : un produit étiqueté « midi » ne
   * s'affiche qu'au service du midi, et sans aucune étiquette il reste visible
   * toute la journée — le cas de l'immense majorité de la carte. On ne
   * manipule ici que ces deux mots-clés : les autres étiquettes du produit
   * (« Mega Burger », « 1+1 »…) sont préservées telles quelles.
   */
  const initialTags = product?.tags ?? [];
  const hasTag = (kind: "lunch" | "dinner", tags: readonly string[]) =>
    tags.some((t) => DAYPART_TAGS[kind].includes(t.trim().toLowerCase()));
  const [lunch, setLunch] = useState(() => hasTag("lunch", initialTags));
  const [dinner, setDinner] = useState(() => hasTag("dinner", initialTags));

  /** Étiquettes finales : on retire les mots-clés de service puis on repose la sélection. */
  const nextTags = (): string[] => {
    const known = [...DAYPART_TAGS.lunch, ...DAYPART_TAGS.dinner];
    const others = initialTags.filter((t) => !known.includes(t.trim().toLowerCase()));
    return [...others, ...(lunch ? ["midi"] : []), ...(dinner ? ["soir"] : [])];
  };
  const tagsChanged = () =>
    JSON.stringify([...nextTags()].sort()) !== JSON.stringify([...initialTags].sort());

  // ─── Recette (mode edit uniquement — le produit doit exister pour un BOM) ───
  const [bomState, setBomState] = useState<"loading" | "ready" | "error">("loading");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [origSerialized, setOrigSerialized] = useState("[]");
  const [optionAllergens, setOptionAllergens] = useState<Allergen[]>([]);
  const [optionCostNote, setOptionCostNote] = useState(false);
  const [ingredients, setIngredients] = useState<SupplyIngredient[]>([]);
  /** Noms des ingrédients de la recette absents de la liste (inactifs…). */
  const [fallbackNames, setFallbackNames] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Garde-fou de « Fermer » : confirmation avant d'abandonner une saisie. */
  const [confirmClose, setConfirmClose] = useState(false);

  const loadBom = useCallback(async () => {
    if (mode !== "edit" || !product) return;
    setBomState("loading");
    try {
      const [bom, ings] = await Promise.all([
        api.get<BomResponse>(`/supply/products/${product._id}/bom`),
        loadIngredients(),
      ]);
      const base = bom.recipes.find((r) => r.variantKey === null || r.variantKey === "base");
      const drafts: LineDraft[] = (base?.lines ?? []).map((l) => ({
        ingredientId: l.ingredientId,
        qty: String(l.qty).replace(".", ","),
        unit: l.unit,
      }));
      const known = new Set(ings.map((i) => i.id));
      const fallbacks: Record<string, string> = {};
      for (const l of base?.lines ?? []) {
        if (!known.has(l.ingredientId)) fallbacks[l.ingredientId] = l.name;
      }
      setIngredients(ings);
      setFallbackNames(fallbacks);
      setLines(drafts);
      setOrigSerialized(serializeLines(drafts));
      const optAll = new Set<Allergen>();
      for (const o of bom.options) for (const a of o.allergens) optAll.add(a);
      setOptionAllergens([...optAll]);
      setOptionCostNote(bom.options.length > 0 || bom.recipes.some((r) => r.variantKey));
      setBomState("ready");
    } catch {
      setBomState("error");
    }
  }, [mode, product, loadIngredients]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : `loadBom` pose la recette, `origSerialized` (référence du calcul « modifié »), les allergènes d'options et `bomState`. Poser `origSerialized` ailleurs qu'immédiatement après `lines` ferait passer une fiche intacte pour modifiée, ou laisserait enregistrer une recette vide.
    void loadBom();
  }, [loadBom]);

  const ingredientById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );

  // ─── Recalcul live : coût matière, marge, allergènes ───
  const liveCostCents = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      const ing = ingredientById.get(l.ingredientId);
      const qty = parseQty(l.qty);
      if (!ing || !Number.isFinite(qty) || qty <= 0) continue;
      sum += lineCostCents(qty, l.unit, ing.costPerUnitCents);
    }
    return sum;
  }, [lines, ingredientById]);

  /**
   * Ce produit impose-t-il un choix qui COÛTE ?
   *
   * Le recalcul live ne compte que les lignes de RECETTE : les ingrédients
   * consommés par une option obligatoire — la viande imposée d'un tacos — n'y
   * entrent pas. L'API les compte, elle (`requiredOptionsCost`), et son
   * commentaire dit pourquoi : « un tacos M sans sa viande imposée » ne doit
   * pas afficher 90 % de marge.
   *
   * On ne peut pas les additionner ici sans refaire tout le chiffrage des
   * recettes d'options. On le DIT donc, plutôt que d'annoncer une marge que le
   * gérant croirait complète et sur laquelle il fixerait son prix.
   */
  const aDesChoixImposes = useMemo(
    () => groups.some((g) => (g.min ?? 0) > 0),
    [groups],
  );

  const priceCents = product ? effectivePrice(product) : 0;
  const showBatchFigures = bomState !== "ready" && initialCost !== undefined;
  const costCents = showBatchFigures ? initialCost.costCents : liveCostCents;
  const marginPct = showBatchFigures
    ? initialCost.marginPct
    : priceCents > 0
      ? Math.round(((priceCents - costCents) / priceCents) * 1000) / 10
      : null;

  /**
   * Chiffres seulement quand ils sont VRAIS : recette chargée, ou coût du lot
   * en attendant. Sans ce garde, le chargement affichait « Coût matière
   * 0,00 € » et « Marge 100 % » à côté des squelettes, corrigés ensuite sous
   * les yeux du gérant.
   */
  const showFigures =
    bomState === "ready" || (bomState === "loading" && showBatchFigures);

  const allergens = useMemo(() => {
    const set = new Set<Allergen>(optionAllergens);
    for (const l of lines) {
      const ing = ingredientById.get(l.ingredientId);
      if (ing) for (const a of ing.allergens) set.add(a);
    }
    return ALLERGENS.filter((a) => set.has(a));
  }, [lines, ingredientById, optionAllergens]);

  // ─── Sauvegarde ───
  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Le nom est requis.");
      return;
    }

    // Lignes de recette : validation avant PUT
    let recipeLines: { ingredientId: string; qty: number; unit: MeasureUnit }[] | null = null;
    if (mode === "edit" && bomState === "ready") {
      const kept = lines.filter((l) => l.ingredientId || l.qty.trim());
      for (const l of kept) {
        const qty = parseQty(l.qty);
        if (!l.ingredientId || !Number.isFinite(qty) || qty <= 0) {
          setError("Complète chaque ligne de recette (ingrédient + quantité > 0).");
          return;
        }
      }
      if (new Set(kept.map((l) => l.ingredientId)).size !== kept.length) {
        setError("Un même ingrédient apparaît deux fois dans la recette.");
        return;
      }
      recipeLines = kept.map((l) => ({
        ingredientId: l.ingredientId,
        qty: parseQty(l.qty),
        unit: l.unit,
      }));
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        await api.post("/products", {
          categoryId: catId,
          name: trimmed,
          description: desc.trim(),
          tags: nextTags(),
          isNew,
        });
        onSaved("Produit créé");
        return;
      }
      if (!product) return;

      const patch: Record<string, unknown> = {};
      if (isNew !== product.isNew) patch.isNew = isNew;
      if (trimmed !== product.name) patch.name = trimmed;
      if (desc.trim() !== product.description) patch.description = desc.trim();
      if (catId && catId !== (product.categoryId ?? "")) patch.categoryId = catId;
      if (tagsChanged()) patch.tags = nextTags();
      // Diff-only ici AUSSI, et ce n'est pas du zèle : envoyer `optionGroups`
      // sans y toucher ferait passer la liste FILTRÉE de la carte — le groupe
      // réservé « supplements » en moins. Le service le réinjecte, mais ne rien
      // envoyer reste la meilleure façon de ne rien casser.
      if (JSON.stringify(variants) !== variantsInitiales) patch.variants = variants;
      if (JSON.stringify(groups) !== groupsInitiaux) {
        patch.optionGroups = figerLesClefs(groups, product.optionGroups ?? []);
      }
      if (Object.keys(patch).length > 0) {
        const validation = validerModificationProduit(patch);
        if (!validation.success) {
          setError(validation.message);
          return;
        }
        await api.patch(`/products/${product._id}`, validation.data);
      }

      /*
       * LES PHOTOS PASSENT PAR LEUR PROPRE ROUTE, ET C'EST LA MÊME DISCIPLINE.
       *
       * Rien dans le correctif ci-dessus ne les mentionne : `photoUrl` n'est
       * plus écrivable (c'est ce qui ferme le contournement de la liste
       * blanche d'origines) et la liste de médias se pose d'un seul geste,
       * qui attache ET réordonne. On ne l'envoie que si elle a bougé — un PUT
       * inutile republierait `menu.updated` à toutes les tablettes.
       */
      if (photos.join(",") !== photosInitiales) {
        await api.put(`/products/${product._id}/medias`, { medias: photos });
      }

      const keptSerialized = recipeLines
        ? JSON.stringify(recipeLines.map((l) => [l.ingredientId, l.qty, l.unit]))
        : null;
      if (recipeLines && keptSerialized !== origSerialized) {
        await api.put(`/supply/products/${product._id}/bom`, {
          variantKey: null,
          lines: recipeLines,
        });
      }
      onSaved("Produit enregistré");
    } catch (e) {
      setError(erreurEnregistrementProduit(e, { optionGroups: groups, variants }));
    } finally {
      setBusy(false);
    }
  }

  const detachDisabled = mode === "edit" && product?.categoryId != null;

  /**
   * « Fermer » démonte le panneau et tout son état bufferisé (nom, tailles,
   * options, recette). Un clic machinal après dix minutes de saisie effaçait
   * tout sans un mot : on ne ferme sans confirmation qu'une fiche intacte.
   */
  const estModifie = () =>
    mode === "create"
      ? name.trim() !== "" ||
        isNew ||
        desc.trim() !== "" ||
        catId !== (createCategoryId ?? "") ||
        tagsChanged()
      : name !== (product?.name ?? "") ||
        isNew !== (product?.isNew ?? false) ||
        desc !== (product?.description ?? "") ||
        catId !== (product?.categoryId ?? "") ||
        tagsChanged() ||
        photos.join(",") !== photosInitiales ||
        JSON.stringify(variants) !== variantsInitiales ||
        JSON.stringify(groups) !== groupsInitiaux ||
        serializeLines(lines) !== origSerialized;
  const demanderFermeture = () => {
    if (estModifie()) setConfirmClose(true);
    else onClose();
  };

  return (
    /*
     * Panneau d'édition ouvert sous sa ligne : niveau « élément » + liseré
     * d'accent à gauche. Sans cela il se confondait avec la carte (#111) et
     * on ne voyait plus quelle ligne était dépliée (DA §1 et §3).
     */
    <div className="border-l-[3px] border-l-accent bg-[image:var(--cf-elev-gradient)] px-[18px] pb-3.5 pt-2.5 shadow-[inset_0_10px_18px_-12px_rgba(0,0,0,.9)]">
      {/* Une colonne sous `md` : deux champs côte à côte à 170 px chacun
          rendraient les libellés illisibles au doigt. */}
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        <Field label="Nom" htmlFor={`edit-name-${product?._id ?? "new"}`}>
          <Input
            id={`edit-name-${product?._id ?? "new"}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="py-2"
          />
        </Field>
        <Field
          label="Rattachement (catégorie)"
          htmlFor={`edit-cat-${product?._id ?? "new"}`}
          // En clair sous le champ, pas dans un `title` d'<option> : les menus
          // natifs ne le rendent presque jamais (et jamais au doigt) — le
          // choix grisé restait inexpliqué.
          hint={
            detachDisabled
              ? "Détachement possible uniquement via la suppression de sa catégorie."
              : undefined
          }
        >
          <Select
            id={`edit-cat-${product?._id ?? "new"}`}
            value={catId}
            onChange={(e) => setCatId(e.target.value)}
            className="py-2"
          >
            {mode === "edit" && (
              <option value="" disabled={detachDisabled}>
                Non rattaché
              </option>
            )}
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Composition / ingrédients"
          htmlFor={`edit-desc-${product?._id ?? "new"}`}
          // `md:` obligatoire : sous md, un span 2 dans la grille à 1 colonne
          // crée une piste implicite dont la gouttière décale de 10 px le bord
          // droit des champs non-spannés.
          className="md:col-span-2"
        >
          <Input
            id={`edit-desc-${product?._id ?? "new"}`}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Ex : escalope de poulet, jambon, œuf, tomate grillée"
            className="py-2"
          />
        </Field>

        {/* Services d'affichage sur les écrans de salle (dayparting). */}
        <div className="md:col-span-2">
          <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[.04em] text-mut">
            Écrans de salle
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["Midi", lunch, setLunch] as const,
                ["Soir", dinner, setDinner] as const,
              ]
            ).map(([label, on, set]) => (
              // Chip du DS, comme les allergènes du tiroir Ingrédient : même
              // langage visuel pour la même bascule d'étiquette, et son
              // `cf-press` porte l'exemption prefers-reduced-motion que le
              // scale posé à la main ignorait.
              <Chip key={label} on={on} onClick={() => set(!on)}>
                {label}
              </Chip>
            ))}
            <p className="text-xs text-mut">
              {lunch && !dinner
                ? "Affiché au service du midi uniquement."
                : dinner && !lunch
                  ? "Affiché au service du soir uniquement."
                  : "Affiché toute la journée — cochez un service pour le limiter."}
            </p>
          </div>
        </div>
      </div>

      <div className="my-4 flex flex-wrap items-center gap-3 rounded-ctrl border border-line bg-surface2 p-3">
        <Chip className="min-h-11" on={isNew} onClick={() => setIsNew(!isNew)}>Nouveauté</Chip>
        <span className="min-w-0 flex-1 text-xs text-mut">Le badge Nouveau accompagne le produit sur la carte et les écrans.</span>
        {mode === "edit" && <Btn variant="ghost" size="sm" className="min-h-11" icon="star" disabled={busy || !onManageFeatured || catId !== (product?.categoryId ?? "")} onClick={onManageFeatured}
          title={catId !== (product?.categoryId ?? "") ? "Enregistrez le changement de catégorie avant la mise en avant" : !onManageFeatured ? "Rattachez d’abord le produit à une catégorie" : "Ouvrir la sélection commune TV et commande en ligne"}>
          {isFeatured ? "Gérer la mise en avant" : "Mettre en avant"}
        </Btn>}
      </div>

      {/* ─── Photos ─── */}
      {mode !== "create" && product && (
        <PhotosDuPlat
          // Le nom EN COURS DE SAISIE et non celui enregistré : c'est le repli
          // du texte alternatif, et un gérant qui renomme son plat doit voir
          // ce que les lecteurs d'écran annonceront après enregistrement.
          produitNom={name.trim() || product.name}
          photos={photos}
          onChange={setPhotos}
          chargerMediatheque={chargerMediatheque}
        />
      )}

      {/* ─── Tailles et options ─── */}
      {mode !== "create" && (
        <>
          <EditeurVariantes variants={variants} onChange={setVariants} />
          <EditeurOptions groups={groups} onChange={setGroups} />
        </>
      )}

      {/* ─── Recette & marge (supply) ─── */}
      {mode === "create" ? (
        <p className="mt-3 border-t border-line pt-3 text-xs text-mut">
          Enregistre d&apos;abord le produit — tu pourras définir ses photos, ses
          tailles, ses options, sa recette et sa marge juste après, avec le
          bouton Modifier.
        </p>
      ) : (
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-mut">
              Recette &amp; marge
            </span>
            {optionCostNote && (
              <span className="text-[11px] text-mut">
                Recette de base — variantes &amp; options gérées côté Ingrédients
              </span>
            )}
          </div>

          {bomState === "loading" && (
            <div className="mt-2.5 flex flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {bomState === "error" && (
            <div className="mt-2.5 flex items-center gap-3">
              <p className="text-xs text-alertt">
                Impossible de charger la recette (contexte supply).
              </p>
              <Btn variant="ghost" size="sm" onClick={() => void loadBom()}>
                Réessayer
              </Btn>
            </div>
          )}

          {showFigures && (
            <>
              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                <span className="text-mut">
                  Coût matière{" "}
                  <b className="cf-fig text-[15px] font-extrabold text-ink">
                    {fmtEuro(costCents)}
                  </b>
                </span>
                <span className="text-mut">
                  Marge{" "}
                  <b
                    className={cx(
                      "cf-fig text-[15px] font-extrabold",
                      marginPct == null
                        ? "text-ink"
                        : marginPct >= 0
                          ? "text-okt"
                          : "text-alertt",
                    )}
                  >
                    {marginPct == null
                      ? "—"
                      : `${marginPct.toLocaleString("fr-FR")} %`}
                  </b>
                </span>
                <span className="text-xs text-mut">
                  sur prix de vente {fmtEuro(priceCents)}
                  {aDesChoixImposes && !showBatchFigures && (
                    <>
                      {" · "}
                      <span className="text-prept">
                        hors choix imposés — la marge réelle est plus basse
                      </span>
                    </>
                  )}
                </span>
              </div>

              {/* « Aucun allergène déclaré » est une affirmation INCO : on ne
                  la fait qu'une fois la recette réellement chargée. */}
              {bomState === "ready" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {allergens.length === 0 ? (
                    <span className="text-xs text-mut">Aucun allergène déclaré</span>
                  ) : (
                    allergens.map((a) => (
                      <Pill key={a} variant="out">
                        {ALLERGEN_LABELS[a]}
                      </Pill>
                    ))
                  )}
                </div>
              )}
            </>
          )}

          {bomState === "ready" && (
            <div className="mt-3 flex flex-col gap-2">
              {lines.map((l, i) => {
                const ing = ingredientById.get(l.ingredientId);
                const qty = parseQty(l.qty);
                const cost =
                  ing && Number.isFinite(qty) && qty > 0
                    ? lineCostCents(qty, l.unit, ing.costPerUnitCents)
                    : null;
                return (
                  /*
                   * `flex-wrap` + `basis-full` : sur téléphone, les largeurs
                   * fixes (qté 76 + unité 76 + coût 64 + croix) ne laissaient
                   * qu'~50 px au sélecteur — impossible de lire quel
                   * ingrédient compose la ligne. Il prend donc toute la
                   * largeur, les chiffres se replient dessous (motif DeviceRow
                   * de la fiche client).
                   */
                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <Select
                      value={l.ingredientId}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i ? { ...x, ingredientId: e.target.value } : x,
                          ),
                        )
                      }
                      aria-label={`Ingrédient de la ligne ${i + 1}`}
                      className="min-w-0 flex-1 basis-full py-2 text-[13px] md:basis-0"
                    >
                      <option value="">Choisir un ingrédient…</option>
                      {l.ingredientId && fallbackNames[l.ingredientId] && (
                        <option value={l.ingredientId}>
                          {fallbackNames[l.ingredientId]} — indisponible
                        </option>
                      )}
                      {ingredients.map((ing2) => (
                        <option key={ing2.id} value={ing2.id}>
                          {ing2.name}
                          {ing2.isOut ? " — rupture" : ""}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={l.qty}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i
                              ? { ...x, qty: e.target.value.replace(/[^0-9.,]/g, "") }
                              : x,
                          ),
                        )
                      }
                      inputMode="decimal"
                      placeholder="Qté"
                      aria-label={`Quantité de la ligne ${i + 1}`}
                      className="cf-fig w-[76px] py-2 text-right text-[13px] font-bold"
                    />
                    <Select
                      value={l.unit}
                      onChange={(e) =>
                        setLines((ls) =>
                          ls.map((x, j) =>
                            j === i ? { ...x, unit: e.target.value as MeasureUnit } : x,
                          ),
                        )
                      }
                      aria-label={`Unité de la ligne ${i + 1}`}
                      className="w-[76px] py-2 text-[13px]"
                    >
                      {MEASURE_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                    <span className="cf-fig w-[64px] shrink-0 text-right text-xs font-semibold text-mut">
                      {/* sr-only et non aria-label : sur un span sans rôle,
                          l'aria-label est ignoré des lecteurs d'écran (motif
                          AllergenChips). */}
                      <span className="sr-only">Coût de la ligne : </span>
                      {cost == null ? "—" : fmtEuro(cost)}
                    </span>
                    {/* IconBtn 32 px : la croix nue faisait ~22 px, sous le
                        minimum tactile — même composant que les suppressions
                        de VariantesOptions. */}
                    <IconBtn
                      icon="close"
                      label={`Retirer la ligne ${i + 1}`}
                      size={32}
                      iconSize={14}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    />
                  </div>
                );
              })}
              <div>
                <Btn
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    setLines((ls) => [...ls, { ingredientId: "", qty: "", unit: "g" }])
                  }
                >
                  Ingrédient
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 whitespace-pre-line text-xs text-alertt">
          {error}
        </p>
      )}

      <div className="mt-3.5 flex items-center justify-end gap-2">
        <Btn variant="ghost" size="sm" onClick={demanderFermeture} disabled={busy}>
          Fermer
        </Btn>
        <Btn size="sm" icon="check" onClick={() => void save()} disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </Btn>
      </div>

      {/* Fermeture ≠ perte silencieuse : Échap et l'overlay ramènent à la
          saisie (choix sûr), seul « Abandonner » jette les changements. */}
      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Abandonner les modifications ?"
        footer={
          <>
            <Btn variant="ghost" size="sm" onClick={() => setConfirmClose(false)}>
              Continuer la saisie
            </Btn>
            <Btn
              size="sm"
              // Rouge fonctionnel : le geste détruit la saisie en cours (§7.4).
              style={{ background: "var(--cf-red)", color: "var(--cf-text)" }}
              onClick={onClose}
            >
              Abandonner
            </Btn>
          </>
        }
      >
        <p className="leading-[1.5] text-mut">
          Cette fiche contient des changements non enregistrés — ils seront
          perdus.
        </p>
      </Modal>
    </div>
  );
}
