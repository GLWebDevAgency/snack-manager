"use client";

/**
 * Modale « Importer la carte (CSV / XML) » (spec backoffice-restaurant §7.5).
 * Trois étapes RÉELLES :
 *   1. dépôt — vrai `input[type=file]` + drag & drop (.csv/.xml, 5 Mo max),
 *      modèle CSV téléchargeable (BOM UTF-8, séparateur « ; » — Excel FR) ;
 *   2. aperçu — parsing local (séparateur ; ou , détecté, BOM géré, guillemets
 *      échappés « "" »), mini-table et catégories à créer signalées ;
 *   3. succès — récap chiffré, avec rapport d'erreur partielle le cas échéant.
 *
 * Import : POST /categories pour chaque catégorie inconnue (on récupère son
 * `_id`), puis POST /products en série — une ligne en échec n'interrompt pas
 * les suivantes (rapport « N créés, M en erreur »).
 *
 * Écart assumé vs maquette : la phrase « les colonnes supplémentaires sont
 * conservées telles quelles » est remplacée par la vérité du contrat API
 * (ProductCreateSchema ignore les champs inconnus).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { api } from "@/lib/api";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { Btn, Icon, Modal, Pill } from "@/components/ui";
import { inputToCents, type Category } from "./types";

const MAX_BYTES = 5 * 1024 * 1024;
/** Au-delà, l'aperçu est tronqué (l'import, lui, traite tout le fichier). */
const PREVIEW_ROWS = 100;
/** Rapport final : au-delà, la liste des lignes en erreur est repliée en « +N autres ». */
const ERROR_ROWS = 30;

// ─── Colonnes reconnues (accents et casse ignorés) ───
const NAME_KEYS = ["nom", "name", "produit", "libelle", "titre", "designation"];
const PRICE_KEYS = ["prix", "price", "tarif", "prix ttc", "prix de vente"];
const CATEGORY_KEYS = ["categorie", "category", "rayon", "famille"];
const DESC_KEYS = ["composition", "description", "ingredients", "desc", "detail"];
const ACTIVE_KEYS = ["dispo", "disponible", "actif", "active", "available"];

const FALSY = ["0", "non", "no", "false", "faux", "n", "off", "inactif", "masque"];

/** Modèle CSV (séparateur « ; », BOM UTF-8 à l'écriture). */
const TEMPLATE_CSV = [
  "nom;prix;catégorie;composition;dispo",
  'Wrap Crousty;8,90;Wraps;"Tenders, cheddar, salade";oui',
  'Wrap Signature;9,90;Wraps;"Poulet mariné, sauce maison";oui',
  "Brownie;3,50;Desserts & Glaces;Fait maison;oui",
].join("\r\n");

type Row = {
  name: string;
  priceCents: number;
  categoryName: string;
  description: string;
  active: boolean;
};

type Parsed = { rows: Row[]; skipped: number };

type Step = "drop" | "preview" | "done";

/** Minuscules, sans accents, espaces normalisés — pour comparer des libellés. */
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

function toRow(
  name: string,
  price: string,
  category: string,
  description: string,
  active: string,
): Row | null {
  const n = name.trim();
  const c = category.trim();
  // Sans nom ni catégorie, la ligne est inexploitable (POST /products exige
  // un `categoryId` existant) : elle est comptée « ignorée » dans l'aperçu.
  if (!n || !c) return null;
  return {
    name: n,
    priceCents: inputToCents(price) ?? 0,
    categoryName: c,
    description: description.trim(),
    active: !FALSY.includes(norm(active)),
  };
}

/** CSV → table de cellules : guillemets, « "" » échappés, sauts de ligne inclus. */
function splitCsv(text: string, sep: string): string[][] {
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((c) => c.trim() !== "")) table.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  pushRow();
  return table;
}

function parseCsv(text: string): Parsed {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const semis = firstLine.split(";").length - 1;
  const commas = firstLine.split(",").length - 1;
  const table = splitCsv(clean, semis >= commas ? ";" : ",");
  if (table.length === 0) return { rows: [], skipped: 0 };

  const header = (table[0] ?? []).map(norm);
  const idx = {
    name: header.findIndex((h) => NAME_KEYS.includes(h)),
    price: header.findIndex((h) => PRICE_KEYS.includes(h)),
    category: header.findIndex((h) => CATEGORY_KEYS.includes(h)),
    desc: header.findIndex((h) => DESC_KEYS.includes(h)),
    active: header.findIndex((h) => ACTIVE_KEYS.includes(h)),
  };
  // Sans ligne d'en-tête reconnaissable, on retombe sur l'ordre documenté :
  // nom ; prix ; catégorie ; composition ; dispo.
  const hasHeader = idx.name >= 0;
  const body = hasHeader ? table.slice(1) : table;
  const pick = (cells: string[], col: number, positional: number) => {
    const at = hasHeader ? col : positional;
    return at >= 0 ? (cells[at] ?? "") : "";
  };

  const rows: Row[] = [];
  let skipped = 0;
  for (const cells of body) {
    const row = toRow(
      pick(cells, idx.name, 0),
      pick(cells, idx.price, 1),
      pick(cells, idx.category, 2),
      pick(cells, idx.desc, 3),
      pick(cells, idx.active, 4),
    );
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}

/** Texte du premier enfant direct dont le nom de balise correspond. */
function childText(el: Element, keys: string[]): string {
  for (const child of Array.from(el.children)) {
    if (keys.includes(norm(child.tagName))) return (child.textContent ?? "").trim();
  }
  for (const key of keys) {
    const attr = el.getAttribute(key);
    if (attr != null) return attr.trim();
  }
  return "";
}

function parseXml(text: string): Parsed {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Fichier XML illisible.");
  }
  let nodes = Array.from(root.children);
  const only = nodes.length === 1 ? nodes[0] : undefined;
  // <carte><produits><produit/>…</produits></carte> : descendre d'un cran
  if (only && only.children.length > 0 && !childText(only, NAME_KEYS)) {
    nodes = Array.from(only.children);
  }

  const rows: Row[] = [];
  let skipped = 0;
  for (const node of nodes) {
    const row = toRow(
      childText(node, NAME_KEYS),
      childText(node, PRICE_KEYS),
      childText(node, CATEGORY_KEYS),
      childText(node, DESC_KEYS),
      childText(node, ACTIVE_KEYS),
    );
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}

type Props = {
  open: boolean;
  /** Catégories existantes — sert à distinguer les catégories à créer. */
  categories: Category[];
  onClose: () => void;
  /** Import terminé (même partiel) — le parent recharge la carte. */
  onImported: () => void;
};

export function ImportModal({ open, categories, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("drop");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Lignes traitées pendant la série de POST — « Import en cours… 42/230 ». */
  const [progress, setProgress] = useState(0);
  /** Croix cliquée pendant l'import : on l'explique au lieu de l'avaler en silence. */
  const [closeAttempted, setCloseAttempted] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    failed: number;
    cats: number;
    /** « Nom · Catégorie » des lignes en échec — listées dans le rapport final. */
    errors: string[];
  } | null>(null);

  const existing = useMemo(
    () => new Map(categories.map((c) => [norm(c.name), c._id])),
    [categories],
  );

  /** Catégories du fichier absentes de la carte, dans l'ordre d'apparition. */
  const newCats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const key = norm(r.categoryName);
      if (!existing.has(key) && !seen.has(key)) seen.set(key, r.categoryName);
    }
    return [...seen].map(([key, name]) => ({ key, name }));
  }, [rows, existing]);

  const reset = useCallback(() => {
    setStep("drop");
    setFileName("");
    setRows([]);
    setSkipped(0);
    setDragOver(false);
    setError(null);
    setBusy(false);
    setProgress(0);
    setCloseAttempted(false);
    setResult(null);
  }, []);

  const close = useCallback(() => {
    if (busy) {
      // Import en cours : on ne coupe pas la série de POST — mais on le DIT,
      // un clic avalé en silence passe pour une interface figée.
      setCloseAttempted(true);
      return;
    }
    reset();
    onClose();
  }, [busy, reset, onClose]);

  // Échap ferme la modale aux étapes sans enjeu (dépôt vierge, récap final).
  // `destructive` prive la Modal de son écouteur clavier EN MÊME TEMPS que du
  // clic overlay (spec §7.5) : on rebranche ici la touche seule, hors aperçu
  // et hors import.
  useEffect(() => {
    if (!open || busy || step === "preview") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, step, close]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (ext !== "csv" && ext !== "xml") {
      setError("Format non supporté — déposez un fichier .csv ou .xml.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Fichier trop volumineux — 5 Mo maximum.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = ext === "csv" ? parseCsv(text) : parseXml(text);
      if (parsed.rows.length === 0) {
        setError(
          "Aucun produit exploitable — vérifiez les colonnes nom et catégorie.",
        );
        return;
      }
      setFileName(file.name);
      setRows(parsed.rows);
      setSkipped(parsed.skipped);
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fichier illisible.");
    }
  }, []);

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function downloadTemplate() {
    // BOM UTF-8 : Excel FR ouvre le fichier avec les bons accents.
    const blob = new Blob(["\uFEFF" + TEMPLATE_CSV], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-carte.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function confirmImport() {
    setBusy(true);
    setProgress(0);
    setCloseAttempted(false);
    const map = new Map(existing);
    let cats = 0;
    for (const c of newCats) {
      try {
        const doc = await api.post<{ _id: string }>("/categories", {
          name: c.name,
          order: categories.length + cats,
        });
        map.set(c.key, String(doc._id));
        cats++;
      } catch {
        // Catégorie non créée : ses produits seront comptés en erreur.
      }
    }

    let created = 0;
    let failed = 0;
    const errors: string[] = [];
    let processed = 0;
    for (const r of rows) {
      processed++;
      const categoryId = map.get(norm(r.categoryName));
      if (!categoryId) {
        failed++;
        errors.push(`${r.name} · ${r.categoryName}`);
        setProgress(processed);
        continue;
      }
      try {
        await api.post("/products", {
          categoryId,
          name: r.name,
          description: r.description,
          price: r.priceCents,
          active: r.active,
        });
        created++;
      } catch {
        failed++;
        errors.push(`${r.name} · ${r.categoryName}`);
      }
      setProgress(processed);
    }

    setResult({ created, failed, cats, errors });
    setBusy(false);
    setStep("done");
    onImported();
  }

  /** Bilan sans aucune création (API injoignable…) : l'écran final bascule en échec. */
  const allFailed = result !== null && result.created === 0 && result.failed > 0;

  const footer =
    step === "drop" ? (
      <>
        <button
          type="button"
          onClick={downloadTemplate}
          className="cf-press mr-auto text-[13px] font-bold text-accent hover:opacity-80"
        >
          Télécharger le modèle CSV
        </button>
        <Btn variant="ghost" size="sm" onClick={close}>
          Annuler
        </Btn>
      </>
    ) : step === "preview" ? (
      <>
        <Btn variant="ghost" size="sm" onClick={reset} disabled={busy}>
          Retour
        </Btn>
        <Btn
          size="sm"
          icon="check"
          className="tabular-nums"
          onClick={() => void confirmImport()}
          disabled={busy}
        >
          {busy ? `Import en cours… ${progress}/${rows.length}` : "Confirmer l'import"}
        </Btn>
      </>
    ) : step === "done" ? (
      <>
        <Btn variant="ghost" size="sm" onClick={close}>
          Fermer
        </Btn>
        {/* Réessayer uniquement quand RIEN n'a été créé : relancer un import
            partiellement réussi dupliquerait les produits déjà passés. */}
        {allFailed && (
          <Btn
            size="sm"
            onClick={() => {
              setResult(null);
              setStep("preview");
            }}
          >
            Réessayer
          </Btn>
        )}
      </>
    ) : undefined;

  return (
    <Modal
      open={open}
      onClose={close}
      // Spec §7.5 : le clic sur l'overlay ne ferme pas — d'autant plus pendant
      // la série de POST. Échap est rebranché plus haut, aux seules étapes sans
      // enjeu (dépôt, récap).
      destructive
      width={520}
      title="Importer la carte (CSV / XML)"
      footer={footer}
    >
      {step === "drop" && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              // cf-press-row : un bloc pleine largeur s'enfonce, il ne se met
              // pas à l'échelle (DA §4).
              "cf-press-row flex w-full flex-col items-center gap-1.5 rounded-card border-2 border-dashed bg-[image:var(--cf-elev-gradient)] px-4 py-[26px] text-center",
              dragOver
                ? "border-accent"
                : "border-line hover:border-white/25 hover:bg-[image:var(--cf-elev-hover)]",
            )}
          >
            <Icon name="arrow" size={22} className="rotate-90 text-accent" />
            <span className="text-[14.5px] font-bold text-ink">
              Déposez votre fichier ici ou cliquez pour parcourir
            </span>
            <span className="text-[12.5px] text-mut">.csv · .xml — max 5 Mo</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xml,text/csv,text/xml,application/xml"
            className="hidden"
            aria-label="Fichier de carte à importer"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // permet de re-choisir le même fichier
              if (file) void handleFile(file);
            }}
          />

          {error && (
            <p role="alert" className="text-[12.5px] text-alertt">
              {error}
            </p>
          )}

          <p className="text-[12.5px] leading-[1.5] text-mut">
            Colonnes attendues :{" "}
            <b className="text-ink">nom ; prix ; catégorie ; composition ; dispo</b>. Les
            catégories inconnues sont créées automatiquement. Séparateur «&nbsp;;&nbsp;» ou
            «&nbsp;,&nbsp;» détecté automatiquement ; les colonnes supplémentaires sont
            ignorées.
          </p>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <p className="text-[13.5px] text-mut">
            {/* break-all : un nom de fichier sans espace (export généré) ne doit
                pas faire défiler horizontalement le corps de la modale. */}
            Aperçu — <b className="break-all text-ink">{fileName}</b> : {rows.length} produit
            {rows.length > 1 ? "s" : ""} · {newCats.length} nouvelle
            {newCats.length > 1 ? "s" : ""} catégorie{newCats.length > 1 ? "s" : ""}
            {newCats.length > 0 && ` (« ${newCats.map((c) => c.name).join(" », « ")} »)`}
          </p>

          {/* Vraie table th/td (comme les onglets Ingrédients) : au lecteur
              d'écran, chaque prix et chaque catégorie restent associés à leur
              produit — l'en-tête colle en haut de la zone défilante. */}
          <div className="overflow-hidden rounded-ctrl border border-line">
            <div className="cf-scroll max-h-[240px] overflow-y-auto">
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky top-0 bg-[image:var(--cf-elev-gradient)] px-3 py-2 text-left text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                    >
                      Nom
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 w-20 bg-[image:var(--cf-elev-gradient)] px-2 py-2 text-right text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                    >
                      Prix
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 w-[128px] bg-[image:var(--cf-elev-gradient)] py-2 pl-2 pr-3 text-left text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut"
                    >
                      Catégorie
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_ROWS).map((r, i) => {
                    const isNewCat = !existing.has(norm(r.categoryName));
                    return (
                      <tr key={`${r.name}-${i}`} className="border-t border-line2">
                        <td className="px-3 py-2">
                          <span className="block truncate text-[13px] font-semibold text-ink">
                            {r.name}
                          </span>
                          {r.description && (
                            <span className="block truncate text-[11px] text-mut">
                              {r.description}
                            </span>
                          )}
                        </td>
                        <td
                          className={cx(
                            "px-2 py-2 text-right text-[12.5px] tabular-nums",
                            r.priceCents > 0 ? "text-ink" : "text-gold",
                          )}
                        >
                          {r.priceCents > 0 ? fmtEuro(r.priceCents) : "à définir"}
                        </td>
                        <td className="py-2 pl-2 pr-3">
                          {/* Le texte tronqué vit dans un span enfant : `truncate`
                              posé sur Pill (conteneur flex) coupe net sans ellipse.
                              `title` en dernier filet pour lire le nom entier. */}
                          {isNewCat ? (
                            <Pill
                              className="max-w-full"
                              title={`${r.categoryName} · nouveau`}
                              // Texte sombre sur le vert plein (comme la pilule
                              // gold) : le blanc n'y atteint pas le contraste AA.
                              style={{
                                background: "var(--cf-green)",
                                color: "#0B1F0E",
                              }}
                            >
                              <span className="truncate">
                                {r.categoryName} · nouveau
                              </span>
                            </Pill>
                          ) : (
                            <Pill className="max-w-full" title={r.categoryName}>
                              <span className="truncate">{r.categoryName}</span>
                            </Pill>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {rows.length > PREVIEW_ROWS && (
            <p className="text-xs text-mut">
              Aperçu limité aux {PREVIEW_ROWS} premières lignes —{" "}
              {rows.length - PREVIEW_ROWS} autre
              {rows.length - PREVIEW_ROWS > 1 ? "s" : ""} seront importées aussi.
            </p>
          )}
          {skipped > 0 && (
            <p className="text-xs text-gold">
              {skipped} ligne{skipped > 1 ? "s" : ""} ignorée{skipped > 1 ? "s" : ""} : nom
              ou catégorie manquant.
            </p>
          )}
          {/* Réponse au clic sur la croix pendant l'import — la Modal n'expose
              pas d'état désactivé pour sa croix, on répond donc par le texte. */}
          {busy && closeAttempted && (
            <p role="status" className="text-xs text-gold">
              Import en cours — la fermeture sera possible à la fin.
            </p>
          )}
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          {/* Rien créé = échec, pas succès : pastille rouge fonctionnelle —
              un check vert au-dessus de « 0 créés » ferait croire à un import réussi. */}
          <div
            aria-hidden
            className="grid size-[52px] place-items-center rounded-pill"
            style={{
              background: allFailed
                ? "color-mix(in srgb, var(--cf-red) 22%, var(--cf-surface))"
                : "color-mix(in srgb, var(--cf-green) 22%, var(--cf-surface))",
            }}
          >
            <Icon
              name={allFailed ? "close" : "check"}
              size={26}
              stroke={3}
              className={allFailed ? "text-alertt" : "text-ok"}
            />
          </div>
          <p className="text-base font-extrabold text-ink">
            {allFailed ? "Import échoué" : "Import terminé"}
          </p>
          {allFailed ? (
            <p className="text-[13.5px] leading-[1.5] text-mut">
              Aucun produit n&apos;a pu être créé — vérifiez la connexion, puis
              réessayez.
            </p>
          ) : (
            <p className="text-[13.5px] leading-[1.5] text-mut">
              {result.created} produit{result.created > 1 ? "s" : ""} ajouté
              {result.created > 1 ? "s" : ""}
              {result.cats > 0 &&
                ` · ${result.cats} catégorie${result.cats > 1 ? "s" : ""} créée${
                  result.cats > 1 ? "s" : ""
                }`}
              .
              <br />
              Retrouvez-les dans la liste, prêts à éditer.
            </p>
          )}
          {result.failed > 0 && (
            <div className="w-full">
              <p role="alert" className="text-[12.5px] text-alertt">
                {allFailed
                  ? `${result.failed} ligne${result.failed > 1 ? "s" : ""} en erreur :`
                  : `${result.created} créés, ${result.failed} en erreur — reprenez ces lignes à la main :`}
              </p>
              {/* LESQUELLES : sans la liste, il faudrait recomparer la carte au
                  fichier ligne à ligne pour retrouver ce qui a échoué. */}
              <ul className="cf-scroll mt-1.5 max-h-[140px] overflow-y-auto rounded-ctrl border border-line px-3 py-2 text-left text-xs leading-[1.7] text-mut">
                {result.errors.slice(0, ERROR_ROWS).map((line, i) => (
                  <li key={`${line}-${i}`} className="truncate" title={line}>
                    {line}
                  </li>
                ))}
                {result.errors.length > ERROR_ROWS && (
                  <li>+ {result.errors.length - ERROR_ROWS} autres</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
