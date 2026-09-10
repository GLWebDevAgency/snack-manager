"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHOISIR UNE IMAGE — un emplacement, une image, et la possibilité d'en déposer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ─── POURQUOI CE N'EST PAS LA MODALE DE `PhotosDuPlat` ─────────────────────
 *
 * Celle-là attache PLUSIEURS médias à un plat (trois au plus), porte le
 * recadrage, porte le retrait de la médiathèque avec sa confirmation à 409, et
 * son vocabulaire est celui d'un produit (« Principale », « sur 4 plats »).
 * L'éditeur de marque, lui, remplit UN emplacement : une image, ou aucune.
 *
 * Les paramétrer en une seule modale aurait demandé de rendre optionnels la
 * cardinalité, le recadrage, la suppression et la moitié des libellés — un
 * composant qui prend huit drapeaux pour servir deux écrans est plus dur à
 * lire que les deux écrans. Ce qui est vraiment commun a été extrait, et
 * seulement ça : les règles de dépôt et de quota (`photos.ts`) et le bouton de
 * dépôt avec son champ de fichier (`BoutonDepot.tsx`), tous deux partagés.
 *
 * ─── CE QU'IL SAIT DE SES APPELANTS : RIEN ─────────────────────────────────
 *
 * `admissible` et `note` sont fournis par l'appelant. C'est lui qui sait qu'un
 * logo doit avoir une adresse absolue et qu'une marque de 64 px sera molle ;
 * cette modale ne fait que montrer ce qu'on lui dit de montrer.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cadrageCss, estPublic, type MediaVue, type QuotaMedias } from "@sm/contracts";
import { ApiError, envoiFichier } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, EmptyState, Icon, Modal, Skeleton } from "@/components/ui";
import { BoutonDepot } from "./BoutonDepot";
import { etatDuQuota, poids, reduirePourEnvoi, type Mediatheque } from "./photos";

/** Ce que rend `POST /medias` — le média, le quota d'après, et le dédoublonnage. */
type Depot = { media: MediaVue; quota: QuotaMedias; deduplique: boolean };

type Props = {
  titre: string;
  /** Une phrase qui dit à quoi cette image va servir, dans SA page. */
  aide?: string;
  /** L'adresse actuellement posée dans l'emplacement — pour la coche. */
  posee: string | null;
  /** L'adresse d'un média, telle qu'elle sera stockée. */
  adresseDe: (media: MediaVue) => string;
  /** Ce média peut-il tenir CET emplacement ? Un refus est expliqué, pas caché. */
  admissible: (media: MediaVue) => boolean;
  /** Le mot sous une vignette — cotes trop petites, format inattendu. */
  note?: (media: MediaVue) => string | null;
  onChoisir: (media: MediaVue) => void;
  onFerme: () => void;
  /** La médiathèque, mutualisée par l'écran : cinq emplacements, une requête. */
  chargerMediatheque: (forcer?: boolean) => Promise<Mediatheque>;
  /** Autorité de l'écran source, vérifiée après les préparations asynchrones. */
  canAct?: () => boolean;
};

export function ChoixDeMedia({
  titre,
  aide,
  posee,
  adresseDe,
  admissible,
  note,
  onChoisir,
  onFerme,
  chargerMediatheque,
  canAct,
}: Props) {
  const alive = useRef(false), canActRef = useRef(canAct), uploading = useRef(false);
  useLayoutEffect(() => { canActRef.current = canAct; }, [canAct]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && (canActRef.current?.() ?? true);
  const [bib, setBib] = useState<Mediatheque | null>(null);
  const [etat, setEtat] = useState<"chargement" | "prete" | "erreur">("chargement");
  const [envoi, setEnvoi] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);

  const charger = useCallback(
    async (forcer = false) => {
      if (!forcer) setEtat("chargement");
      try {
        setBib(await chargerMediatheque(forcer));
        setEtat("prete");
      } catch {
        setEtat("erreur");
      }
    },
    [chargerMediatheque],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : sans lui la modale ne connaît aucune image à proposer. Le résultat est mutualisé au niveau de l'éditeur — ouvrir cinq emplacements ne relance pas la requête.
    void charger();
  }, [charger]);

  /** Les PHOTOS, jamais les documents — un document n'est pas une image. */
  const images = useMemo(
    () => (bib?.medias ?? []).filter((m) => estPublic(m.genre)),
    [bib],
  );
  const quota = bib ? etatDuQuota(bib.quota) : null;

  /**
   * LE DÉPÔT — réduction D'ABORD, envoi ensuite. Même geste que les photos de
   * plats, et pour la même raison : un cliché de téléphone pèse trois à huit
   * mégaoctets et serait refusé tel quel par l'API.
   */
  async function deposer(fichier: File) {
    if (!current() || uploading.current) return;
    uploading.current = true;
    setEnvoi(true);
    setRefus(null);
    setAvis(null);
    try {
      const reduction = await reduirePourEnvoi(fichier);
      if (!current()) return;
      if (!reduction.ok) {
        setRefus(reduction.message);
        return;
      }
      const depot = await envoiFichier<Depot>("POST", "/medias", reduction.fichier);
      if (!current()) return;
      setBib((b) => ({
        medias: [depot.media, ...(b?.medias ?? []).filter((m) => m.id !== depot.media.id)],
        quota: depot.quota,
      }));
      setEtat("prete");
      if (!admissible(depot.media)) {
        // Déposée quand même — elle rejoint la médiathèque — mais elle ne peut
        // pas tenir CET emplacement, et le taire ferait chercher pourquoi rien
        // ne s'est passé.
        setAvis("Cette image est bien dans votre médiathèque, mais elle ne convient pas à cet emplacement.");
        return;
      }
      onChoisir(depot.media);
    } catch (e) {
      if (!current()) return;
      setRefus(
        e instanceof ApiError
          ? e.status === 413
            ? "Image trop lourde pour l'hébergement — réessayez, la réduction n'a peut-être pas abouti."
            : e.message
          : "Envoi impossible — réessayez.",
      );
    } finally {
      uploading.current = false;
      if (current()) setEnvoi(false);
    }
  }

  return (
    <Modal
      open
      onClose={onFerme}
      width={720}
      title={titre}
      footer={
        <>
          <span className="mr-auto text-[12px] text-mut">{quota?.phrase ?? ""}</span>
          <BoutonDepot envoi={envoi} onFichier={(f) => void deposer(f)}>
            Déposer une image
          </BoutonDepot>
          <Btn size="sm" icon="check" onClick={onFerme}>
            Terminé
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {aide && <p className="text-[13px] text-mut">{aide}</p>}

        {etat === "chargement" && <Skeleton className="h-[180px] w-full" />}

        {etat === "erreur" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-alertt">Impossible de charger votre médiathèque.</p>
            <Btn variant="ghost" size="sm" onClick={() => void charger(true)}>
              Réessayer
            </Btn>
          </div>
        )}

        {etat === "prete" &&
          (images.length === 0 ? (
            <EmptyState
              icon="grid"
              title="Aucune image pour l'instant"
              hint="Déposez votre logo ou une photo de votre salle : elle restera dans votre médiathèque."
              action={
                <BoutonDepot envoi={envoi} onFichier={(f) => void deposer(f)}>
                  Déposer une image
                </BoutonDepot>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((media, i) => {
                const url = adresseDe(media);
                const ok = admissible(media);
                const choisie = posee !== null && url === posee;
                const mot = note?.(media) ?? null;
                /*
                 * Le repli est un RANG, jamais un nom emprunté : une image de
                 * la bibliothèque n'appartient à aucun emplacement, et lui
                 * coller le nom de celui qu'on remplit mentirait à qui
                 * l'écoute au lieu de le renseigner.
                 */
                const nom = media.alt.trim() || `Image ${i + 1}`;
                return (
                  <div key={media.id}>
                    <button
                      type="button"
                      aria-pressed={choisie}
                      disabled={!ok}
                      onClick={() => onChoisir(media)}
                      title={
                        ok
                          ? choisie
                            ? "Cette image est déjà à cet emplacement"
                            : "Poser cette image ici"
                          : "Cette image ne peut pas servir ici — voir la note sous la vignette."
                      }
                      className={cx(
                        "cf-press relative block w-full overflow-hidden rounded-card border-2",
                        choisie ? "border-accent" : "border-line hover:border-mut",
                        !ok && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {/* `contain` et non `cover` : un logo recadré n'est plus
                          un logo. Le fond est le niveau « élément » de
                          l'admin — c'est la VIGNETTE de la bibliothèque, pas
                          l'épreuve : celle-ci est dans l'emplacement lui-même,
                          où chaque déclinaison se juge sur SON fond. */}
                      <span className="block aspect-square overflow-hidden bg-surface2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- image servie par notre API : next/image n'a rien à y optimiser, et le cadrage est le nôtre. */}
                        <img
                          src={media.urls.vignette}
                          alt={nom}
                          style={{ objectPosition: cadrageCss(media.point) }}
                          className="size-full object-contain p-2"
                        />
                      </span>
                      <span className="flex items-center justify-between gap-1.5 px-2 py-1.5 text-[11px] text-mut">
                        <span className="truncate">{poids(media.octets)}</span>
                        {media.largeur !== null && media.hauteur !== null && (
                          <span className="cf-fig shrink-0">
                            {media.largeur} × {media.hauteur}
                          </span>
                        )}
                      </span>
                      {choisie && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-2 top-2 grid size-6 place-items-center rounded-pill bg-accent text-onaccent"
                        >
                          <Icon name="check" size={14} />
                        </span>
                      )}
                    </button>
                    {mot && <p className="mt-1 text-[11px] leading-snug text-prept">{mot}</p>}
                  </div>
                );
              })}
            </div>
          ))}

        {quota?.serre && (
          <p className="rounded-ctrl border border-prep/40 px-3 py-2 text-[12.5px] text-prept">
            Médiathèque presque pleine ({quota.phrase}). Retirez depuis « Carte » les images que
            vous n&apos;utilisez plus — ou appelez-nous, on agrandit.
          </p>
        )}

        {avis && <p className="text-[12.5px] text-prept">{avis}</p>}
        {refus && (
          <p role="alert" className="text-xs text-alertt">
            {refus}
          </p>
        )}
      </div>
    </Modal>
  );
}
