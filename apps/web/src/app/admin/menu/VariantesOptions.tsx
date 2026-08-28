"use client";

/**
 * VARIANTES ET GROUPES D'OPTIONS — l'éditeur qui manquait.
 *
 * `ProductCreateSchema` les accepte depuis le premier jour, avec des règles
 * riches. L'écran, lui, ne savait poser que nom, description, catégorie et
 * étiquettes — et la grille passait le prix en lecture seule dès qu'un produit
 * avait des variantes, avec le message « édite-les avec le bouton Modifier ».
 * Ce bouton ouvrait justement le panneau incapable de les éditer : un produit à
 * variantes était un produit dont le prix n'était modifiable nulle part.
 *
 * ── Ce que cet éditeur ne touche pas, délibérément ─────────────────────────
 *
 * `perVariant` — la règle qui fait varier min/max/priceDelta selon la taille,
 * comme « le tacos XL impose trois viandes » — est conservé tel quel et jamais
 * réécrit. C'est du `Schema.Types.Mixed` côté Mongo : ni typé, ni validé, et
 * une clé qui ne correspond à aucune variante est ignorée EN SILENCE par le
 * calcul de commande. L'éditer à l'aveugle produirait des règles mortes que
 * rien ne signalerait. Il se pose au seed ou par script, en attendant un
 * éditeur qui saura le valider.
 *
 * Le groupe réservé « supplements » n'apparaît pas ici : la carte le retire de
 * `optionGroups`, et le service le réinjecte à l'enregistrement. Il se pilote
 * depuis les ingrédients, pas depuis la carte.
 */

import type { OptionGroup, Product, Variant } from "./types";
import { Btn, Field, IconBtn, Input, Select } from "@/components/ui";

/** « 8,90 » → 890 centimes. Chaîne vide ou illisible → `null`. */
export function euxCentimes(saisie: string): number | null {
  const net = saisie.trim().replace(/\s/g, "").replace(",", ".");
  if (net === "") return null;
  const n = Number(net);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** 890 → « 8,90 ». */
export const centimesEnSaisie = (cents: number): string =>
  (cents / 100).toFixed(2).replace(".", ",");

/**
 * Une clef technique lisible, dérivée du nom : « Pain ou galette » → « pain-ou-galette ».
 * Elle sert d'identifiant dans les commandes déjà passées — d'où le fait qu'on
 * ne la régénère JAMAIS sur un élément existant, seulement à la création.
 */
export function clefDepuis(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "option"
  );
}

// ─────────────────────────────────────────────────────────────
// Les variantes
// ─────────────────────────────────────────────────────────────

export function EditeurVariantes({
  variants,
  onChange,
}: {
  variants: Variant[];
  onChange: (v: Variant[]) => void;
}) {
  const modifier = (i: number, patch: Partial<Variant>) =>
    onChange(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <div className="mt-5 border-t border-white/6 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-bold text-ink">Tailles et formats</div>
        <span className="text-[12px] text-mut">{variants.length || "aucune"}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-mut">
        Dès qu&apos;il y en a une, le client <strong className="text-ink">doit</strong> en
        choisir une, et le prix du produit ne sert plus — c&apos;est celui de la
        taille qui compte.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {variants.map((v, i) => (
          <div key={v.key} className="flex items-end gap-2">
            <Field label={i === 0 ? "Nom" : ""} htmlFor={`var-nom-${v.key}`} className="flex-1">
              <Input
                id={`var-nom-${v.key}`}
                value={v.name}
                onChange={(e) => modifier(i, { name: e.target.value })}
                placeholder="Ex. M — 1 viande"
              />
            </Field>
            <Field label={i === 0 ? "Prix" : ""} htmlFor={`var-prix-${v.key}`} className="w-[110px]">
              <Input
                id={`var-prix-${v.key}`}
                inputMode="decimal"
                value={centimesEnSaisie(v.price)}
                onChange={(e) => {
                  const c = euxCentimes(e.target.value);
                  if (c !== null) modifier(i, { price: c });
                }}
                className="tabular-nums"
              />
            </Field>
            <IconBtn
              icon="trash"
              label={`Supprimer la taille ${v.name}`}
              className="mb-1"
              onClick={() => onChange(variants.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>

      <Btn
        variant="ghost"
        size="sm"
        icon="plus"
        className="mt-2"
        onClick={() => {
          // La clef se dérive d'un compteur et non du nom : le nom est vide à
          // la création, et deux tailles sans nom produiraient la même clef.
          const n = variants.length + 1;
          onChange([...variants, { key: `v${n}`, name: "", price: 0 }]);
        }}
      >
        Ajouter une taille
      </Btn>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Les groupes d'options
// ─────────────────────────────────────────────────────────────

export function EditeurOptions({
  groups,
  onChange,
}: {
  groups: OptionGroup[];
  onChange: (g: OptionGroup[]) => void;
}) {
  const modifier = (i: number, patch: Partial<OptionGroup>) =>
    onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <div className="mt-5 border-t border-white/6 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-bold text-ink">Options à la commande</div>
        <span className="text-[12px] text-mut">{groups.length || "aucune"}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-mut">
        Viandes, sauces, cuisson — ce que le client choisit en commandant. Les
        suppléments payants, eux, se pilotent depuis les ingrédients.
      </p>

      <div className="mt-3 flex flex-col gap-4">
        {groups.map((g, i) => (
          <div key={g.key} className="rounded-card border border-white/6 p-3">
            <div className="flex items-end gap-2">
              <Field label="Intitulé" htmlFor={`grp-nom-${g.key}`} className="flex-1">
                <Input
                  id={`grp-nom-${g.key}`}
                  value={g.name}
                  onChange={(e) => modifier(i, { name: e.target.value })}
                  placeholder="Ex. Sauces"
                />
              </Field>
              <Field label="Choix" htmlFor={`grp-type-${g.key}`} className="w-[130px]">
                <Select
                  id={`grp-type-${g.key}`}
                  value={g.type}
                  onChange={(e) => modifier(i, { type: e.target.value as "single" | "multi" })}
                >
                  <option value="single">Un seul</option>
                  <option value="multi">Plusieurs</option>
                </Select>
              </Field>
              <IconBtn
                icon="trash"
                label={`Supprimer le groupe ${g.name}`}
                className="mb-1"
                onClick={() => onChange(groups.filter((_, j) => j !== i))}
              />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Minimum" htmlFor={`grp-min-${g.key}`}>
                <Input
                  id={`grp-min-${g.key}`}
                  inputMode="numeric"
                  value={String(g.min ?? 0)}
                  onChange={(e) => {
                    const n = Number(e.target.value.trim());
                    if (Number.isInteger(n) && n >= 0) modifier(i, { min: n });
                  }}
                  className="tabular-nums"
                />
              </Field>
              <Field
                label="Maximum"
                htmlFor={`grp-max-${g.key}`}
                hint="Vide = autant qu’on veut."
              >
                <Input
                  id={`grp-max-${g.key}`}
                  inputMode="numeric"
                  value={g.max == null ? "" : String(g.max)}
                  onChange={(e) => {
                    const brut = e.target.value.trim();
                    // Le champ vide OMET la clef : `0` est refusé par le
                    // schéma (`.int().positive()`) et `null` aussi
                    // (`.optional()` n'est pas `.nullable()`). Écrire l'un ou
                    // l'autre ferait échouer l'enregistrement en 400.
                    if (brut === "") {
                      // La clé est OMISE, jamais mise à `0` ni `null` :
                      // `OptionGroupSchema.max` est `.int().positive()` et
                      // refuse les deux (`.optional()` n'est pas
                      // `.nullable()`). D'où le retrait par déstructuration.
                      const sansMax = { ...groups[i]! };
                      delete sansMax.max;
                      onChange(groups.map((x, j) => (j === i ? sansMax : x)));
                      return;
                    }
                    const n = Number(brut);
                    if (Number.isInteger(n) && n > 0) modifier(i, { max: n });
                  }}
                  className="tabular-nums"
                />
              </Field>
            </div>

            <div className="mt-3">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-mut">
                Choix possibles
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {g.choices.map((c, k) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <Input
                      aria-label={`Nom du choix ${k + 1}`}
                      value={c.name}
                      onChange={(e) =>
                        modifier(i, {
                          choices: g.choices.map((x, j) =>
                            j === k ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                      placeholder="Ex. Samouraï"
                      className="flex-1"
                    />
                    <Input
                      aria-label={`Supplément du choix ${k + 1}`}
                      inputMode="decimal"
                      value={centimesEnSaisie(c.priceDelta ?? 0)}
                      onChange={(e) => {
                        const v = euxCentimes(e.target.value);
                        if (v !== null)
                          modifier(i, {
                            choices: g.choices.map((x, j) =>
                              j === k ? { ...x, priceDelta: v } : x,
                            ),
                          });
                      }}
                      className="w-[100px] tabular-nums"
                    />
                    <IconBtn
                      icon="trash"
                      label={`Supprimer le choix ${c.name || k + 1}`}
                      // Un groupe sans choix est refusé par le schéma : on
                      // ferme le geste plutôt que d'afficher une erreur après
                      // coup.
                      disabled={g.choices.length <= 1}
                      onClick={() =>
                        modifier(i, { choices: g.choices.filter((_, j) => j !== k) })
                      }
                    />
                  </div>
                ))}
              </div>
              <Btn
                variant="ghost"
                size="sm"
                icon="plus"
                className="mt-2"
                onClick={() =>
                  modifier(i, {
                    choices: [
                      ...g.choices,
                      { key: `c${g.choices.length + 1}`, name: "", priceDelta: 0 },
                    ],
                  })
                }
              >
                Ajouter un choix
              </Btn>
            </div>

            {g.perVariant && (
              <p className="mt-3 text-[12px] text-mut">
                Ce groupe a des règles par taille (nombre de choix ou prix qui
                changent selon le format). Elles sont conservées, mais ne
                s&apos;éditent pas encore ici.
              </p>
            )}
          </div>
        ))}
      </div>

      <Btn
        variant="ghost"
        size="sm"
        icon="plus"
        className="mt-3"
        onClick={() =>
          onChange([
            ...groups,
            {
              key: `g${groups.length + 1}`,
              name: "",
              type: "multi",
              min: 0,
              choices: [{ key: "c1", name: "", priceDelta: 0 }],
            },
          ])
        }
      >
        Ajouter un groupe
      </Btn>
    </div>
  );
}

/**
 * Les clefs définitives, posées au moment d'enregistrer.
 *
 * On les dérive du nom pour qu'un ticket reste lisible — « samourai » plutôt
 * que « c3 » — mais JAMAIS sur un élément qui existait déjà : la clef est
 * l'identifiant dénormalisé dans les commandes passées, et la changer rendrait
 * illisibles les tickets d'hier tout en cassant les paniers ouverts.
 */
export function figerLesClefs(groups: OptionGroup[], avant: OptionGroup[]): OptionGroup[] {
  const connues = new Set(avant.flatMap((g) => [g.key, ...g.choices.map((c) => c.key)]));
  const unique = (base: string, prises: Set<string>) => {
    let k = base;
    let n = 2;
    while (prises.has(k)) k = `${base}-${n++}`;
    prises.add(k);
    return k;
  };
  const prises = new Set(connues);
  return groups.map((g) => ({
    ...g,
    key: connues.has(g.key) ? g.key : unique(clefDepuis(g.name), prises),
    choices: g.choices.map((c) => ({
      ...c,
      key: connues.has(c.key) ? c.key : unique(clefDepuis(c.name), prises),
    })),
  }));
}

export type { Product };
