"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LE CADRAGE D'UNE PHOTO — on clique sur le plat, pas sur deux champs
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le point d'intérêt (`PointInteret`, au contrat) existe parce que la même
 * photo est recadrée en carré à la caisse, en 4:3 sur la vitrine, en 3:2 sur
 * la fiche et en 16:9 au téléviseur. Sans point commun, chaque surface centre
 * son recadrage et coupe le plat à quatre endroits différents.
 *
 * ─── POURQUOI ON LE POSE AU DOIGT, ET PAS AVEC DEUX NOMBRES ────────────────
 *
 * `{ x: 0.42, y: 0.31 }` ne veut rien dire pour un restaurateur, et deux
 * champs numériques lui demanderaient de deviner, d'enregistrer, d'aller voir
 * sa caisse, de revenir corriger. Il DÉSIGNE donc son plat sur la photo — le
 * geste qu'il ferait avec le doigt en montrant l'écran — et les quatre
 * recadrages réels se redessinent sous ses yeux, aux ratios exacts de
 * `USAGES_MEDIA`. C'est tout l'intérêt de la fonction : il VOIT que son burger
 * ne sera pas coupé en deux à la caisse, au lieu de l'espérer.
 *
 * Les aperçus ne sont pas une simulation : ils appliquent `cadrageCss` sur une
 * image en `object-fit: cover`, exactement ce que font la caisse, la vitrine
 * et l'écran de salle. Ce qu'il voit ici est ce que ses clients verront.
 */

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  MEDIA_ALT_MAX,
  USAGES,
  USAGES_MEDIA,
  cadrageCss,
  texteAlternatif,
  type MediaVue,
  type PointInteret,
  type UsageMedia,
} from "@sm/contracts";
import { api } from "@/lib/api";
import { Btn, Field, Input, Modal } from "@/components/ui";

/**
 * Le nom de la SURFACE, jamais son rapport écrit en toutes lettres.
 *
 * Le rapport vient de `USAGES_MEDIA` et il dessine directement la boîte
 * (`aspectRatio`) : le jour où la caisse passera du carré au 4:3, l'aperçu
 * suivra tout seul. Écrire « 1:1 » à côté aurait été une seconde vérité à
 * tenir à jour, et la première à mentir.
 */
const SURFACES: Record<UsageMedia, string> = {
  vignette: "Caisse",
  carte: "Vitrine",
  fiche: "Fiche du plat",
  bandeau: "Écran de salle",
};

const borne = (v: number) => Math.min(1, Math.max(0, v));
const pourcent = (v: number) => Math.round(v * 100);

export function CadragePhoto({
  media,
  repliAlt,
  onFerme,
  onEnregistre,
}: {
  media: MediaVue;
  /** Le nom du plat — ce que lit un lecteur d'écran si l'alt reste vide. */
  repliAlt: string;
  onFerme: () => void;
  /** Le média décrit, tel que l'API le rend — la liste s'en resert. */
  onEnregistre: (media: MediaVue) => void;
}) {
  const [alt, setAlt] = useState(media.alt);
  const [point, setPoint] = useState<PointInteret>(media.point);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /**
   * Le rapport de l'image, mesuré si l'en-tête ne l'a pas livré.
   *
   * Il n'est pas décoratif : la zone cliquable doit avoir EXACTEMENT le
   * rapport de la photo, sinon `object-contain` la centre entre deux bandes et
   * le clic tombe à côté du pixel désigné. `null` tant qu'on ne sait pas — la
   * boîte prend alors un 4:3 provisoire, corrigé au chargement de l'image.
   */
  const [rapport, setRapport] = useState<number | null>(
    media.largeur && media.hauteur ? media.largeur / media.hauteur : null,
  );

  const modifie = alt !== media.alt || point.x !== media.point.x || point.y !== media.point.y;
  const description = texteAlternatif(alt, repliAlt);

  function poserAuClic(e: MouseEvent<HTMLButtonElement>) {
    const boite = e.currentTarget.getBoundingClientRect();
    if (boite.width === 0 || boite.height === 0) return;
    setPoint({
      x: borne((e.clientX - boite.left) / boite.width),
      y: borne((e.clientY - boite.top) / boite.height),
    });
  }

  /**
   * Les flèches déplacent le point de 2 % — 10 % avec Majuscule.
   *
   * Un point d'intérêt qui ne se poserait qu'à la souris serait inatteignable
   * au clavier, et le geste est ici la seule façon de régler le cadrage.
   * `preventDefault` évite que la page défile sous la modale pendant le
   * réglage.
   */
  function poserAuClavier(e: KeyboardEvent<HTMLButtonElement>) {
    const pas = e.shiftKey ? 0.1 : 0.02;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-pas, 0],
      ArrowRight: [pas, 0],
      ArrowUp: [0, -pas],
      ArrowDown: [0, pas],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    setPoint((p) => ({ x: borne(p.x + delta[0]), y: borne(p.y + delta[1]) }));
  }

  async function enregistrer() {
    setBusy(true);
    setErreur(null);
    try {
      /*
       * ON N'ENVOIE QUE CE QUI A CHANGÉ.
       *
       * `MediaDescribeSchema` n'a délibérément aucun `.default()` : renvoyer
       * un champ qu'on n'a pas touché le réécrirait. Le gérant qui déplace le
       * point ne doit pas perdre le texte alternatif saisi la veille depuis
       * un autre poste.
       */
      const corps: { alt?: string; point?: PointInteret } = {};
      if (alt !== media.alt) corps.alt = alt;
      if (point.x !== media.point.x || point.y !== media.point.y) corps.point = point;
      onEnregistre(await api.patch<MediaVue>(`/medias/${media.id}`, corps));
      onFerme();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Cadrage non enregistré — réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFerme}
      width={640}
      title="Cadrer la photo"
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onFerme} disabled={busy}>
            Annuler
          </Btn>
          <Btn size="sm" icon="check" onClick={() => void enregistrer()} disabled={busy || !modifie}>
            {busy ? "Enregistrement…" : "Enregistrer le cadrage"}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[13px] text-mut">
            Touchez le plat sur la photo : c&apos;est le point que chaque écran gardera au
            centre de son recadrage.
          </p>
          {media.utilisePar > 1 && (
            // Un média appartient au RESTAURANT, pas au plat : le dire évite
            // la surprise de voir trois cartes bouger d'un seul réglage.
            <p className="mt-1 text-[13px] text-prept">
              Cette photo sert à {media.utilisePar} plats — le cadrage vaut pour tous.
            </p>
          )}
        </div>

        {/* ── La photo, cliquable ── */}
        <button
          type="button"
          onClick={poserAuClic}
          onKeyDown={poserAuClavier}
          aria-label="Poser le point d'intérêt sur la photo — flèches du clavier pour l'ajuster"
          style={{ aspectRatio: rapport ?? 4 / 3 }}
          className="relative w-full cursor-crosshair overflow-hidden rounded-card border border-line bg-surface2 outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- l'image vient de notre API (ou du paquet web pour les photos du pilote) : next/image n'a rien à optimiser, et son recadrage nous échapperait. */}
          <img
            src={media.urls.fiche}
            alt=""
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setRapport(img.naturalWidth / img.naturalHeight);
              }
            }}
            className="size-full object-contain"
          />
          {/* Le repère : disque d'accent cerclé de son encre — le couple que
              le masque garantit lisible, sur une photo claire comme sombre. */}
          <span
            aria-hidden
            style={{ left: `${pourcent(point.x)}%`, top: `${pourcent(point.y)}%` }}
            className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-onaccent bg-accent shadow-deep"
          />
        </button>

        <p aria-live="polite" className="text-xs text-mut">
          Point d&apos;intérêt : {pourcent(point.x)} % depuis la gauche, {pourcent(point.y)} %
          depuis le haut.
          {(point.x !== 0.5 || point.y !== 0.5) && (
            <button
              type="button"
              onClick={() => setPoint({ x: 0.5, y: 0.5 })}
              className="ml-2 font-bold text-ink underline underline-offset-2"
            >
              Recentrer
            </button>
          )}
        </p>

        {/* ── Les quatre recadrages RÉELS ── */}
        <div>
          <span className="mb-2 block text-[12px] font-bold uppercase tracking-[.04em] text-mut">
            Ce que vos écrans afficheront
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {USAGES.map((usage) => (
              <div key={usage} className="flex min-w-0 flex-col gap-1.5">
                <div
                  style={{ aspectRatio: USAGES_MEDIA[usage].ratio }}
                  className="overflow-hidden rounded-card border border-line bg-surface2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- même motif : image d'API, recadrée par `object-position`. */}
                  <img
                    src={media.urls[usage]}
                    alt={`Aperçu ${SURFACES[usage]} — ${description}`}
                    style={{ objectPosition: cadrageCss(point) }}
                    className="size-full object-cover"
                  />
                </div>
                <span className="truncate text-[11px] font-semibold text-mut">
                  {SURFACES[usage]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Le texte alternatif — il ne bloque rien ── */}
        <Field
          label="Texte alternatif"
          htmlFor={`alt-${media.id}`}
          hint={
            alt.trim() === ""
              ? `Laissé vide, les lecteurs d'écran annoncent « ${repliAlt} » — le nom du plat suffit presque toujours.`
              : undefined
          }
        >
          <Input
            id={`alt-${media.id}`}
            value={alt}
            maxLength={MEDIA_ALT_MAX}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={repliAlt}
            className="py-2"
          />
        </Field>

        {erreur && (
          <p role="alert" className="text-xs text-alertt">
            {erreur}
          </p>
        )}
      </div>
    </Modal>
  );
}
