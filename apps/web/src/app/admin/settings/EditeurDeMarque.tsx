"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ÉDITEUR DE MARQUE — l'écran qui manquait au masque d'identité
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le masque est livré depuis deux jours : cinq rôles stockés, une cinquantaine
 * de variables dérivées, six directions, dix-neuf couples de contraste jugés,
 * et une route `PATCH /tenants/me/marque` qui n'avait AUCUN appelant dans le
 * web. Quatre des cinq emplacements d'image ne se remplissaient qu'en collant
 * une adresse à la main dans un appel direct. Voici la surface.
 *
 * ─── LES VERDICTS SE MONTRENT, ILS NE SE DEVINENT PAS ──────────────────────
 *
 * `contraste()` rend depuis le premier jour, pour chaque couple, son ratio,
 * son seuil, et — pour un couple STOCKÉ en échec — la nuance la plus proche
 * qui passe. Personne ne l'avait jamais affichée. C'est le cœur de cet écran :
 * à chaque frappe, les trois couples que le restaurateur POSE disent leur
 * mesure, et celui qui tombe propose sa correction en un geste.
 *
 * L'API rejoue le même jugement à l'écriture (`exigerAA`) et refuse en 400.
 * L'écran ne s'en remet donc pas à lui : il verrouille l'enregistrement tant
 * qu'un couple échoue, et dit lequel. Le 400 reste traité (`messageDuRefus`) —
 * il ne doit jamais apparaître comme une panne — mais il ne devrait plus
 * arriver, et la phrase le dit.
 *
 * ─── CE QUI EST ICI, ET CE QUI EST DANS `marque.ts` ────────────────────────
 *
 * Ici : le rendu, l'état, les requêtes. Là-bas : tout ce qui se décide sans
 * navigateur (quel rôle une correction réécrit, quelle direction un masque
 * porte encore, ce qu'un refus veut dire), pour que ça se prouve.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DIRECTIONS,
  TYPE_PAIRS,
  TYPE_PAIR_KEYS,
  contraste,
  marqueEffective,
  type Brand,
  type BrandMotion,
  type BrandShape,
  type MediaVue,
  type PresetKey,
  type TypePairKey,
} from "@sm/contracts";
import { ApiError, api, type TenantMe } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, Field, Icon, Input, Panel, Skeleton } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { ChoixDeMedia } from "@/components/mediatheque/ChoixDeMedia";
import type { Mediatheque } from "@/components/mediatheque/photos";
import { ApercuDeMarque } from "./ApercuDeMarque";
import {
  CLES_DIRECTIONS,
  CLES_FORMES,
  CLES_MOUVEMENTS,
  COUPLES_LABELS,
  DIRECTIONS_LABELS,
  EMPLACEMENTS,
  FORMES,
  MOUVEMENTS,
  PAIRES_LABELS,
  REMEDE_DERIVE,
  ROLES,
  appliquerDirection,
  avertissementDeCotes,
  directionPortee,
  hexValide,
  lireEmplacement,
  messageDuRefus,
  normaliserHex,
  poserEmplacement,
  ratioDit,
  retouche,
  roleCorrige,
  servableCommeImageDeMarque,
  verdictsDerivesEnEchec,
  verdictsPosables,
  type CleEmplacement,
  type CleRole,
  type Emplacement,
} from "./marque";

/**
 * Les six masques de vignette, résolus UNE FOIS au chargement du module.
 *
 * `DIRECTIONS` est une constante : recalculer six palettes complètes à chaque
 * frappe dans un champ de couleur — donc à chaque rendu de cet écran — serait
 * payer trente mélanges et vingt-quatre recherches d'AA pour un résultat
 * identique.
 */
const MASQUES_DIRECTIONS = Object.fromEntries(
  CLES_DIRECTIONS.map((cle) => [cle, styleDuMasque(DIRECTIONS[cle])]),
) as Record<(typeof CLES_DIRECTIONS)[number], ReturnType<typeof styleDuMasque>>;

/** Le cadre d'une vignette qui porte SON propre masque. */
const VIGNETTE = `${classesPolices} font-body block rounded-card bg-bg p-3 text-left text-ink`;

export function EditeurDeMarque({
  me,
  onEnregistre,
}: {
  me: TenantMe;
  onEnregistre: (t: TenantMe) => void;
}) {
  /*
   * `marqueEffective` et non `me.brand` NU — c'est l'adaptateur de lecture
   * unique du contrat, et il existe pour ce cas : un établissement d'avant la
   * reprise (`backfill:brand`) n'a PAS de masque stocké, et une API déployée
   * avant le champ n'en rend pas du tout. Lire le champ directement ferait
   * partir `undefined` dans `styleDuMasque()` — un `TypeError` sur
   * `brand.palette.ground`, donc l'écran des paramètres entier dans son
   * error boundary. L'adaptateur rend alors la direction Nuit avec l'accent
   * et le logo du restaurant : exactement ce que ses clients voient déjà.
   */
  /** Ce qui est EN LIGNE — la référence de « rien à enregistrer ». */
  const [pose, setPose] = useState<Brand>(() => marqueEffective(me));
  const [brand, setBrand] = useState<Brand>(() => marqueEffective(me));
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<CleEmplacement | null>(null);

  /** Toute retouche repose `preset` sur ce qui est vraiment peint. */
  const poser = useCallback((suivant: Brand) => {
    setRefus(null);
    setBrand(retouche(suivant));
  }, []);

  /*
   * MÉMORISÉ — dix-neuf couples, dont treize dérivés qui refont chacun une
   * recherche d'AA par pas de 1/200. C'est le calcul le plus cher de l'écran
   * et il se rejoue à chaque frappe : sans ce `useMemo`, il se rejouerait
   * aussi à l'ouverture d'une modale et au chargement de la médiathèque.
   */
  const verdict = useMemo(() => contraste(brand), [brand]);
  const posables = useMemo(() => verdictsPosables(verdict.verdicts), [verdict]);
  const deriveEnEchec = useMemo(() => verdictsDerivesEnEchec(verdict.verdicts), [verdict]);
  const direction = useMemo(() => directionPortee(brand), [brand]);

  /*
   * La comparaison passe par la sérialisation : le masque est une petite
   * arborescence figée (cinq couleurs, cinq adresses, quatre énumérations) et
   * une comparaison champ à champ écrite ici oublierait le champ ajouté
   * demain — c'est-à-dire qu'elle rendrait « rien à enregistrer » sur un
   * changement réel.
   */
  const dirty = useMemo(() => JSON.stringify(brand) !== JSON.stringify(pose), [brand, pose]);

  // ── La médiathèque : une requête pour les cinq emplacements ──
  const mediathequeRef = useRef<Promise<Mediatheque> | null>(null);
  const chargerMediatheque = useCallback((forcer = false) => {
    if (forcer) mediathequeRef.current = null;
    mediathequeRef.current ??= api.get<Mediatheque>("/medias").catch((e: unknown) => {
      mediathequeRef.current = null; // un échec ne doit pas être mis en cache
      throw e;
    });
    return mediathequeRef.current;
  }, []);

  /**
   * Le catalogue sert à UNE chose : retrouver les cotes d'une image DÉJÀ
   * posée, pour pouvoir en avertir au rechargement de la page et pas
   * seulement à l'instant du choix. Un échec ne casse rien — il n'ôte que
   * l'avertissement, et le masque reste modifiable.
   */
  const [medias, setMedias] = useState<MediaVue[] | null>(null);
  useEffect(() => {
    // Les cotes d'une image posée ne sont pas dans le masque (qui ne stocke
    // qu'une adresse) : elles se lisent dans la médiathèque. Sans cet appel, un
    // logo trop petit ne s'avoue qu'à l'instant où on le choisit, et plus
    // jamais ensuite — un rechargement de page effacerait l'avertissement.
    void chargerMediatheque()
      .then((m) => setMedias(m.medias))
      .catch(() => setMedias([]));
  }, [chargerMediatheque]);

  const parAdresse = useMemo(() => {
    const table = new Map<string, MediaVue>();
    for (const m of medias ?? []) {
      for (const url of Object.values(m.urls)) table.set(url, m);
    }
    return table;
  }, [medias]);

  const emplacementOuvert = EMPLACEMENTS.find((e) => e.cle === ouvert) ?? null;

  async function enregistrer() {
    if (busy || !dirty || !verdict.ok) return;
    setBusy(true);
    setRefus(null);
    try {
      const suivant = await api.patch<TenantMe>("/tenants/me/marque", brand);
      // La réponse fait foi : l'API greffe le logo hérité sur un masque qui
      // n'en portait aucun (`avecLogoHerite`). Reposer `brand` tel qu'on l'a
      // envoyé rendrait « rien à enregistrer » faux dès l'enregistrement
      // suivant, et l'écran afficherait un logo que la base ne porte plus.
      const enregistre = marqueEffective(suivant);
      setPose(enregistre);
      setBrand(enregistre);
      onEnregistre(suivant);
    } catch (e) {
      /*
       * Le refus du serveur est écrit pour être compris : il nomme les couples
       * en échec ou les adresses hors liste. `messageDuRefus` le traduit — un
       * « Enregistrement impossible » générique jetterait précisément ce qui
       * rend ce refus actionnable.
       */
      setRefus(
        e instanceof ApiError
          ? messageDuRefus(e.status, e.body)
          : "Enregistrement impossible — vérifiez votre connexion et réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <SectionDirections direction={direction} onChoisir={(cle) => poser(appliquerDirection(brand, cle))} />

          <SectionCouleurs
            brand={brand}
            posables={posables}
            deriveEnEchec={deriveEnEchec}
            onPalette={(cle, valeur) =>
              poser({ ...brand, palette: { ...brand.palette, [cle]: valeur } })
            }
          />

          <SectionTypographie brand={brand} onBrand={poser} />

          <SectionImages
            brand={brand}
            parAdresse={parAdresse}
            cotesConnues={medias !== null}
            onOuvrir={setOuvert}
            onRetirer={(cle) => poser(poserEmplacement(brand, cle, null))}
          />
        </div>

        {/* L'aperçu colle en haut de l'écran large : régler une couleur en
            perdant de vue son effet, c'est régler à l'aveugle. */}
        <Panel
          title="Votre vitrine"
          sub="Le masque en cours d'édition, appliqué aux composants de votre vraie page de commande. Les deux plats sont des exemples."
          className="lg:sticky lg:top-4"
          bodyClassName="flex flex-col gap-2"
        >
          <ApercuDeMarque brand={brand} nom={me.name} />
          <p className="text-[12px] text-mut">
            Le fond va jusqu&apos;au bord de l&apos;écran sur la vraie page — ici, le cadre
            s&apos;arrête pour ne pas repeindre votre back-office.
          </p>
        </Panel>
      </div>

      <BarreEnregistrement
        dirty={dirty}
        busy={busy}
        contrasteOk={verdict.ok}
        echecs={posables.filter((v) => !v.ok).length + deriveEnEchec.length}
        refus={refus}
        onAnnuler={() => {
          setRefus(null);
          setBrand(pose);
        }}
        onEnregistrer={() => void enregistrer()}
      />

      {emplacementOuvert && (
        <ChoixDeMedia
          titre={emplacementOuvert.nom}
          aide={emplacementOuvert.aide}
          posee={lireEmplacement(brand, emplacementOuvert.cle)}
          adresseDe={(m) => m.urls[emplacementOuvert.usage]}
          admissible={(m) => servableCommeImageDeMarque(m, emplacementOuvert.usage)}
          note={(m) =>
            servableCommeImageDeMarque(m, emplacementOuvert.usage)
              ? avertissementDeCotes(emplacementOuvert, m)
              : "Cette photo est servie par une adresse relative (les dix-neuf plats du pilote) : elle ne peut pas voyager jusqu'à la caisse ni au manifeste."
          }
          onChoisir={(m) => {
            poser(poserEmplacement(brand, emplacementOuvert.cle, m.urls[emplacementOuvert.usage]));
            setOuvert(null);
          }}
          onFerme={() => setOuvert(null)}
          chargerMediatheque={chargerMediatheque}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 1. La direction — six vignettes, pas six pastilles
// ─────────────────────────────────────────────────────────────

function SectionDirections({
  direction,
  onChoisir,
}: {
  direction: PresetKey | null;
  onChoisir: (cle: PresetKey) => void;
}) {
  return (
    <Panel
      title="Votre direction"
      sub="Six points de départ. En choisir un remplace couleurs, typographie, formes et mouvement — vos images restent en place."
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {CLES_DIRECTIONS.map((cle) => {
          const { nom, phrase } = DIRECTIONS_LABELS[cle];
          const choisie = direction === cle;
          return (
            <button
              key={cle}
              type="button"
              aria-pressed={choisie}
              onClick={() => onChoisir(cle)}
              className={cx(
                "cf-press overflow-hidden rounded-card border-2",
                choisie ? "border-accent" : "border-line hover:border-mut",
              )}
            >
              {/* Chaque vignette porte SON masque : ce ne sont pas six
                  pastilles de couleur, c'est la direction telle qu'elle
                  peindra — police d'affichage comprise. */}
              <span style={MASQUES_DIRECTIONS[cle]} className={VIGNETTE}>
                <span className="font-display block text-[15px] font-extrabold tracking-[-0.01em]">
                  {nom}
                </span>
                <span className="mt-1 block text-[11.5px] leading-snug text-mut">{phrase}</span>
                <span className="mt-2 flex items-center gap-1.5">
                  <span className="rounded-pill bg-accent px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-onaccent">
                    Commander
                  </span>
                  <span className="rounded-ctrl border border-linefirm bg-surface px-1.5 py-1 text-[10.5px] font-bold">
                    9,50 €
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. Les cinq rôles, et les verdicts en direct
// ─────────────────────────────────────────────────────────────

function SectionCouleurs({
  brand,
  posables,
  deriveEnEchec,
  onPalette,
}: {
  brand: Brand;
  posables: ReturnType<typeof verdictsPosables>;
  deriveEnEchec: ReturnType<typeof verdictsDerivesEnEchec>;
  onPalette: (cle: CleRole, valeur: string) => void;
}) {
  /*
   * ── LA SAISIE EST TENUE À PART DE LA PALETTE, ET ELLE SAIT D'OÙ ELLE VIENT ──
   *
   * « #c9a15 » est un état légitime au milieu d'une frappe : le pousser dans
   * le masque le ferait refuser par le contrat à chaque caractère. Le champ
   * garde donc ce qu'on tape, et la palette ne reçoit que ce qui est déjà une
   * couleur.
   *
   * `issu` est la moitié qui manquait à la première version, et son absence
   * était un vrai défaut : après avoir tapé dans « Le texte » puis choisi une
   * direction, la pastille montrait le nouveau brun et le champ à côté
   * affichait encore l'ancienne saisie. On retient donc la valeur de palette
   * CONTRE laquelle la saisie a été faite ; dès que la palette bouge par un
   * autre chemin (une direction, une correction de contraste), elle ne
   * correspond plus et le champ redit la vérité.
   */
  const [saisie, setSaisie] = useState<{ cle: CleRole; texte: string; issu: string } | null>(null);

  return (
    <Panel
      title="Vos cinq couleurs"
      sub="Tout le reste en découle : le texte atténué, les contours, l'anneau de sélection, les couleurs d'état. Vous n'avez que ces cinq-là à choisir."
      bodyClassName="flex flex-col gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map(({ cle, nom, role }) => {
          const valeur = brand.palette[cle];
          const enCours = saisie !== null && saisie.cle === cle && saisie.issu === valeur;
          const brute = enCours ? saisie.texte : valeur;
          const valide = hexValide(normaliserHex(brute));
          /** Retenir la frappe, et pousser la couleur dès qu'elle en est une. */
          const frapper = (texte: string) => {
            const hex = normaliserHex(texte);
            const bon = hexValide(hex);
            setSaisie({ cle, texte, issu: bon ? hex : valeur });
            if (bon) onPalette(cle, hex);
          };
          return (
            <Field key={cle} label={nom} htmlFor={`marque-${cle}`} hint={role}>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  aria-label={`Choisir ${nom.toLowerCase()}`}
                  value={valeur}
                  onChange={(e) => frapper(e.target.value)}
                  className="size-[44px] shrink-0 cursor-pointer rounded-ctrl border border-linefirm bg-transparent p-1"
                />
                <Input
                  id={`marque-${cle}`}
                  value={brute}
                  spellCheck={false}
                  onChange={(e) => frapper(e.target.value)}
                  className="w-[128px]"
                />
                {!valide && (
                  <span className="text-xs font-semibold text-alertt">Format : #rrggbb</span>
                )}
              </div>
            </Field>
          );
        })}
      </div>

      <Verdicts posables={posables} deriveEnEchec={deriveEnEchec} onPalette={onPalette} />
    </Panel>
  );
}

/**
 * LES VERDICTS — ce que `contraste()` sait depuis le premier jour.
 *
 * Deux blocs, et la séparation n'est pas cosmétique : les trois premiers
 * couples sont ceux que le restaurateur POSE, ils portent une correction et
 * un bouton. Les autres sont DÉRIVÉS — il ne les choisit pas, et un bouton
 * n'aurait rien à écrire. On ne les montre donc QUE lorsqu'ils tombent, et on
 * dit alors la seule chose qu'il puisse faire : écarter ses couleurs.
 */
function Verdicts({
  posables,
  deriveEnEchec,
  onPalette,
}: {
  posables: ReturnType<typeof verdictsPosables>;
  deriveEnEchec: ReturnType<typeof verdictsDerivesEnEchec>;
  onPalette: (cle: CleRole, valeur: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line2 pt-3.5">
      <div className="mb-0.5 text-xs font-bold uppercase tracking-[0.04em] text-mut">
        Ce que vos clients arriveront à lire
      </div>

      {posables.map((v) => {
        const role = roleCorrige(v.couple);
        return (
          <div
            key={v.couple}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line bg-[image:var(--cf-elev-gradient)] px-3.5 py-2"
          >
            <span
              className={cx(
                "flex items-center gap-2 text-[13px] font-bold",
                v.ok ? "text-okt" : "text-alertt",
              )}
            >
              <Icon name={v.ok ? "check" : "alert"} size={15} />
              {COUPLES_LABELS[v.couple]}
            </span>
            <span className="cf-fig text-xs text-mut">
              {ratioDit(v.ratio)} · il en faut {ratioDit(v.seuil)}
            </span>
            {!v.ok && v.proposition !== null && role !== null && (
              <Btn
                size="sm"
                variant="ghost"
                icon="check"
                className="ml-auto min-h-[44px]"
                onClick={() => onPalette(role, v.proposition as string)}
                title={`Remplacer par ${v.proposition}`}
              >
                Corriger
              </Btn>
            )}
            {!v.ok && v.proposition === null && (
              <span className="ml-auto text-xs text-mut">
                Aucune nuance ne passe : changez la couleur d&apos;en face.
              </span>
            )}
          </div>
        );
      })}

      {deriveEnEchec.length > 0 && (
        <div className="mt-1.5 rounded-card border border-alert/40 px-3.5 py-2.5">
          <p className="text-[13px] font-bold text-alertt">
            {deriveEnEchec.length === 1
              ? "Une nuance calculée ne tient pas"
              : `${deriveEnEchec.length} nuances calculées ne tiennent pas`}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {deriveEnEchec.map((v) => (
              <li key={v.couple} className="text-[12.5px] text-mut">
                {COUPLES_LABELS[v.couple]} — <span className="cf-fig">{ratioDit(v.ratio)}</span>{" "}
                pour {ratioDit(v.seuil)} attendus
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12.5px] leading-snug text-mut">{REMEDE_DERIVE}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. L'accord typographique, la forme, le mouvement
// ─────────────────────────────────────────────────────────────

function SectionTypographie({ brand, onBrand }: { brand: Brand; onBrand: (b: Brand) => void }) {
  /*
   * Chaque vignette porte le masque du restaurateur AVEC la seule variante
   * qu'elle propose : ses couleurs, sa forme, son mouvement, et l'accord (ou
   * la forme, ou le mouvement) qu'on lui propose d'essayer. C'est ce qui
   * permet de montrer l'effet au lieu de lister des noms — et c'est mémorisé
   * ensemble, parce que quinze résolutions de palette à chaque frappe dans un
   * champ de couleur seraient quinze fois trop.
   */
  const masquesPaires = useMemo(
    () =>
      Object.fromEntries(
        TYPE_PAIR_KEYS.map((pair) => [pair, styleDuMasque({ ...brand, type: { pair } })]),
      ) as Record<TypePairKey, ReturnType<typeof styleDuMasque>>,
    [brand],
  );
  const masquesFormes = useMemo(
    () =>
      Object.fromEntries(
        CLES_FORMES.map((shape) => [shape, styleDuMasque({ ...brand, shape })]),
      ) as Record<BrandShape, ReturnType<typeof styleDuMasque>>,
    [brand],
  );
  const masquesMouvements = useMemo(
    () =>
      Object.fromEntries(
        CLES_MOUVEMENTS.map((motion) => [motion, styleDuMasque({ ...brand, motion })]),
      ) as Record<BrandMotion, ReturnType<typeof styleDuMasque>>,
    [brand],
  );

  return (
    <Panel
      title="L'écriture, les formes, le rythme"
      sub="Dix accords typographiques, trois arrondis, deux vitesses."
      bodyClassName="flex flex-col gap-5"
    >
      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-mut">
          L&apos;accord typographique
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {TYPE_PAIR_KEYS.map((pair) => {
            const choisi = brand.type.pair === pair;
            const { prixMono } = TYPE_PAIRS[pair];
            return (
              <button
                key={pair}
                type="button"
                aria-pressed={choisi}
                onClick={() => onBrand({ ...brand, type: { pair } })}
                className={cx(
                  "cf-press overflow-hidden rounded-card border-2",
                  choisi ? "border-accent" : "border-line hover:border-mut",
                )}
              >
                <span style={masquesPaires[pair]} className={VIGNETTE}>
                  <span className="font-display block truncate text-[16px] font-extrabold leading-tight">
                    Kebab maison
                  </span>
                  <span
                    className={cx(
                      "mt-1 block text-[13px] font-bold tabular-nums",
                      prixMono && "font-mono",
                    )}
                  >
                    9,50 €
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-mut">
                    {PAIRES_LABELS[pair]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-mut">
          Les arrondis
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {CLES_FORMES.map((shape) => {
            const choisie = brand.shape === shape;
            return (
              <button
                key={shape}
                type="button"
                aria-pressed={choisie}
                onClick={() => onBrand({ ...brand, shape })}
                className={cx(
                  "cf-press overflow-hidden rounded-card border-2",
                  choisie ? "border-accent" : "border-line hover:border-mut",
                )}
              >
                {/* Les rayons du masque : la carte, le champ et la pilule
                    portent les VRAIS `--cf-r-*` de cette forme. */}
                <span style={masquesFormes[shape]} className={VIGNETTE}>
                  <span className="flex items-center gap-1.5">
                    <span className="size-7 rounded-card border border-linefirm bg-surface" />
                    <span className="size-7 rounded-ctrl border border-linefirm bg-surface" />
                    <span className="h-7 flex-1 rounded-pill bg-accent" />
                  </span>
                  <span className="mt-2 block text-[12px] font-bold">{FORMES[shape].nom}</span>
                  <span className="block text-[11px] text-mut">{FORMES[shape].phrase}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-mut">
          Le rythme
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {CLES_MOUVEMENTS.map((motion) => {
            const choisi = brand.motion === motion;
            return (
              <button
                key={motion}
                type="button"
                aria-pressed={choisi}
                onClick={() => onBrand({ ...brand, motion })}
                className={cx(
                  "group cf-press overflow-hidden rounded-card border-2",
                  choisi ? "border-accent" : "border-line hover:border-mut",
                )}
              >
                <span style={masquesMouvements[motion]} className={VIGNETTE}>
                  {/*
                    Le mouvement ne se montre qu'en bougeant : la pastille
                    traverse sa piste au survol, à la durée RÉELLE du profil
                    (`duration-med` lit `--sm-t-med`, que le masque de cette
                    vignette vient de poser). Choisir en fait aussi le rythme
                    de tout l'aperçu, à droite.
                  */}
                  <span className="block h-7 rounded-pill bg-surface p-1">
                    <span className="block size-5 rounded-pill bg-accent transition-transform duration-med ease-sm group-hover:translate-x-[calc(100%*3)] motion-reduce:transition-none" />
                  </span>
                  <span className="mt-2 block text-[12px] font-bold">{MOUVEMENTS[motion].nom}</span>
                  <span className="block text-[11px] text-mut">{MOUVEMENTS[motion].phrase}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. Les cinq emplacements d'image
// ─────────────────────────────────────────────────────────────

function SectionImages({
  brand,
  parAdresse,
  cotesConnues,
  onOuvrir,
  onRetirer,
}: {
  brand: Brand;
  parAdresse: ReadonlyMap<string, MediaVue>;
  cotesConnues: boolean;
  onOuvrir: (cle: CleEmplacement) => void;
  onRetirer: (cle: CleEmplacement) => void;
}) {
  return (
    <Panel
      title="Vos images"
      sub="Quatre déclinaisons de logo et la photo d'accueil. Elles se choisissent dans votre médiathèque — celle des photos de plats — ou s'y déposent."
      bodyClassName="flex flex-col gap-2.5"
    >
      {EMPLACEMENTS.map((e) => (
        <RangeeImage
          key={e.cle}
          emplacement={e}
          brand={brand}
          media={parAdresse.get(lireEmplacement(brand, e.cle) ?? "") ?? null}
          cotesConnues={cotesConnues}
          onOuvrir={() => onOuvrir(e.cle)}
          onRetirer={() => onRetirer(e.cle)}
        />
      ))}
      <p className="mt-1 text-[12px] leading-snug text-mut">
        Une marque gagne à faire au moins 256 px de côté, une horizontale 512 px de large. En
        dessous, on vous le dit — et on enregistre quand même : une image un peu petite
        s&apos;affiche, elle est seulement molle sur un grand écran.
      </p>
    </Panel>
  );
}

function RangeeImage({
  emplacement,
  brand,
  media,
  cotesConnues,
  onOuvrir,
  onRetirer,
}: {
  emplacement: Emplacement;
  brand: Brand;
  media: MediaVue | null;
  cotesConnues: boolean;
  onOuvrir: () => void;
  onRetirer: () => void;
}) {
  const url = lireEmplacement(brand, emplacement.cle);
  const avertissement = media ? avertissementDeCotes(emplacement, media) : null;

  /*
   * L'ÉPREUVE SE FAIT SUR LE FOND OÙ LA DÉCLINAISON EST POSÉE.
   *
   * C'est toute la raison d'être des quatre emplacements : un logo dessiné
   * pour un fond sombre disparaît sur du clair. Les montrer tous sur le même
   * fond ferait choisir à l'aveugle — et c'est le défaut qu'on referme.
   *
   * `bg-ink` et `bg-bg` sont les DEUX EXTRÊMES que l'admin porte déjà en
   * jetons (encre blanche sur fond noir, la marque grise du produit) : aucune
   * couleur n'est écrite à la main ici. L'accueil, lui, s'éprouve sur le fond
   * du masque en cours — c'est là qu'elle vivra.
   */
  const fond =
    emplacement.fond === "clair"
      ? "bg-ink"
      : emplacement.fond === "sombre"
        ? "bg-bg"
        : "bg-transparent";

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-card border border-line bg-[image:var(--cf-elev-gradient)] p-2.5">
      <div
        style={emplacement.fond === "masque" ? { background: brand.palette.ground } : undefined}
        className={cx(
          "grid h-[64px] w-[104px] shrink-0 place-items-center overflow-hidden rounded-ctrl border border-linefirm",
          emplacement.fond === "masque" ? undefined : fond,
        )}
      >
        {url ? (
          // `contain` : un logo recadré n'est plus un logo. L'accueil, lui,
          // couvre — c'est ainsi qu'il s'affichera en bandeau.
          // eslint-disable-next-line @next/next/no-img-element -- image servie par notre API : next/image n'a rien à y optimiser.
          <img
            src={url}
            alt=""
            className={cx(
              "size-full",
              emplacement.cle === "hero" ? "object-cover" : "object-contain p-1.5",
            )}
          />
        ) : (
          <Icon name="grid" size={18} className="text-mut" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold text-ink">{emplacement.nom}</div>
        <p className="mt-0.5 text-[12px] leading-snug text-mut">{emplacement.aide}</p>
        {url === null ? (
          <p className="mt-0.5 text-[12px] text-mut">Aucune image — rien ne s&apos;affichera ici.</p>
        ) : media === null ? (
          <p className="mt-0.5 text-[12px] text-mut">
            {cotesConnues
              ? "Image posée hors médiathèque — ses dimensions ne sont pas vérifiables."
              : "Vérification des dimensions…"}
          </p>
        ) : (
          <p className={cx("mt-0.5 text-[12px]", avertissement ? "text-prept" : "text-mut")}>
            {avertissement ?? `${media.largeur} × ${media.hauteur} px — la taille convient.`}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* `min-h-[44px]` : la taille `sm` du design system mesure 38 px, et
            ces deux commandes sont les seules de l'écran qu'on presse au
            pouce, sur une rangée dense de cinq emplacements. */}
        <Btn variant="ink" size="sm" icon="grid" className="min-h-[44px]" onClick={onOuvrir}>
          {url ? "Remplacer" : "Choisir"}
        </Btn>
        {url && (
          <Btn variant="ghost" size="sm" className="min-h-[44px]" onClick={onRetirer}>
            Retirer
          </Btn>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. L'enregistrement
// ─────────────────────────────────────────────────────────────

function BarreEnregistrement({
  dirty,
  busy,
  contrasteOk,
  echecs,
  refus,
  onAnnuler,
  onEnregistrer,
}: {
  dirty: boolean;
  busy: boolean;
  contrasteOk: boolean;
  echecs: number;
  refus: string | null;
  onAnnuler: () => void;
  onEnregistrer: () => void;
}) {
  return (
    /*
     * COLLANTE EN BAS SUR GRAND ÉCRAN — la boucle de cet écran est « je change
     * une couleur, je lis le verdict, j'enregistre ». Reléguée en pied d'une
     * page de quatre panneaux, la barre obligeait à re-parcourir tout pour
     * valider. Pas sur téléphone : la barre de navigation basse y occupe déjà
     * ce bord, et deux barres superposées n'en font plus aucune.
     */
    <div className="z-10 flex flex-col gap-2 rounded-panel border border-line bg-[image:var(--cf-card-gradient)] p-3.5 shadow-card lg:sticky lg:bottom-4">
      <div className="flex flex-wrap items-center gap-3">
        <Btn
          variant="ink"
          icon="check"
          disabled={!dirty || busy || !contrasteOk}
          onClick={onEnregistrer}
        >
          {busy ? "Enregistrement…" : "Enregistrer l'identité visuelle"}
        </Btn>
        {dirty && (
          <Btn variant="ghost" disabled={busy} onClick={onAnnuler}>
            Revenir à ce qui est en ligne
          </Btn>
        )}
        {/*
          Le bouton n'est jamais grisé sans raison écrite : l'API refuse un
          masque illisible (400), et laisser cliquer pour se faire refuser
          serait lui faire porter une explication qu'on a déjà sous la main.
        */}
        <span className="text-[12.5px] text-mut">
          {!contrasteOk
            ? `${echecs === 1 ? "Un couple ne se lit pas" : `${echecs} couples ne se lisent pas`} — corrigez-les d'abord, le serveur refuserait ce masque.`
            : dirty
              ? "Vos clients verront le changement à leur prochaine visite."
              : "Rien à enregistrer."}
        </span>
      </div>
      {refus && (
        <p role="alert" className="text-[12.5px] leading-snug text-alertt">
          {refus}
        </p>
      )}
    </div>
  );
}

/** Le squelette de l'éditeur, le temps que `GET /tenants/me` réponde. */
export function EditeurDeMarqueEnAttente() {
  return (
    <div className="flex max-w-[1040px] flex-col gap-4">
      <Skeleton className="h-[220px]" />
      <Skeleton className="h-[320px]" />
    </div>
  );
}
