"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LES PHOTOS D'UN PLAT — choisir, déposer, ordonner, cadrer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La médiathèque était livrée côté serveur (routes, quota, dédoublonnage,
 * point d'intérêt) et AUCUN écran ne savait s'en servir : un restaurateur ne
 * pouvait ni voir ses photos, ni en déposer une. Cette section est la surface
 * qui manquait.
 *
 * ─── TROIS CHOSES QUI NE SONT PAS DES DÉTAILS ──────────────────────────────
 *
 * 1. LA PREMIÈRE PHOTO EST LA PRINCIPALE. Ce n'est pas une convention
 *    d'affichage : `photoUrlDe` prend la première référence résolue, et c'est
 *    elle qui part sur la caisse, la vitrine, le téléviseur et les données
 *    structurées. Réordonner EST donc le geste qui change la photo du plat —
 *    d'où l'étiquette « Principale », qui dit ce que l'ordre signifie.
 *
 * 2. LES PHOTOS NE PASSENT PAS PAR LE CORRECTIF DU PRODUIT. Elles ont leur
 *    propre route (`PUT /products/:id/medias`), qui attache ET réordonne d'un
 *    seul geste. Cette section ne fait donc que TENIR la liste ; c'est
 *    `EditPanel` qui l'envoie à l'enregistrement, à côté du correctif et
 *    jamais dedans (cf. le commentaire de `save()` sur le groupe réservé).
 *
 * 3. UN MÉDIA APPARTIENT AU RESTAURANT, PAS AU PLAT. Détacher (croix) retire
 *    la photo DE CE PLAT ; retirer (corbeille, dans la médiathèque) la
 *    supprime pour tout le monde. Deux gestes, deux icônes, deux portées —
 *    les confondre ferait disparaître d'une carte entière une photo qu'on
 *    croyait enlever d'un seul plat.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MEDIAS_PAR_PRODUIT_MAX,
  cadrageCss,
  estPublic,
  texteAlternatif,
  type MediaVue,
  type QuotaMedias,
} from "@sm/contracts";
import { ApiError, api, envoiFichier } from "@/lib/api";
import { cx } from "@/lib/cx";
import { Btn, EmptyState, Icon, IconBtn, Modal, Pill, Skeleton } from "@/components/ui";
import { CadragePhoto } from "./CadragePhoto";
import { etatDuQuota, poids, reduirePourEnvoi } from "@/components/mediatheque/photos";
import { BoutonDepot } from "@/components/mediatheque/BoutonDepot";
import { BibliothequeIllustrations } from "@/components/mediatheque/BibliothequeIllustrations";
import { deplacer } from "./photos";
import type { Mediatheque } from "./types";

/** Ce que rend `POST /medias` — le média, le quota d'après, et le dédoublonnage. */
type Depot = { media: MediaVue; quota: QuotaMedias; deduplique: boolean };

type Props = {
  /** Le nom du plat — repli du texte alternatif, et rien d'autre. */
  produitNom: string;
  /** Les identifiants attachés, DANS L'ORDRE. La première est la principale. */
  photos: string[];
  onChange: (ids: string[]) => void;
  /** La médiathèque du restaurant, chargée (et mise en cache) par la page. */
  chargerMediatheque: (forcer?: boolean) => Promise<Mediatheque>;
};

export function PhotosDuPlat({ produitNom, photos, onChange, chargerMediatheque }: Props) {
  const [bib, setBib] = useState<Mediatheque | null>(null);
  const [etat, setEtat] = useState<"chargement" | "prete" | "erreur">("chargement");
  const [bibliothequeOuverte, setBibliothequeOuverte] = useState(false);
  const [cadrage, setCadrage] = useState<MediaVue | null>(null);
  const [envoi, setEnvoi] = useState(false);
  /** Ce que le dépôt vient de faire — « réduite : 3,2 Mo → 380 Ko ». */
  const [note, setNote] = useState<string | null>(null);
  const [refus, setRefus] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement asynchrone : sans lui la section ne connaît ni les adresses des photos attachées, ni l'état du quota, et n'a donc rien à peindre. Le résultat est mutualisé au niveau de la page : rouvrir un panneau ne relance pas la requête.
    void charger();
  }, [charger]);

  const parId = useMemo(() => new Map((bib?.medias ?? []).map((m) => [m.id, m])), [bib]);

  /** La bibliothèque proposée au choix : les PHOTOS, jamais les documents. */
  const choix = useMemo(() => (bib?.medias ?? []).filter((m) => estPublic(m.genre)), [bib]);

  const quota = bib ? etatDuQuota(bib.quota) : null;
  const complet = photos.length >= MEDIAS_PAR_PRODUIT_MAX;

  /** Le média décrit vient de changer (cadrage, texte alternatif) : on le repose. */
  const remplacer = (media: MediaVue) =>
    setBib((b) => (b ? { ...b, medias: b.medias.map((m) => (m.id === media.id ? media : m)) } : b));

  function basculer(media: MediaVue) {
    if (photos.includes(media.id)) {
      onChange(photos.filter((id) => id !== media.id));
      return;
    }
    if (photos.length >= MEDIAS_PAR_PRODUIT_MAX) return;
    onChange([...photos, media.id]);
  }

  /**
   * LE DÉPÔT — réduction D'ABORD, envoi ensuite.
   *
   * Un cliché de téléphone pèse trois à huit mégaoctets et serait refusé tel
   * quel par l'API (deux mégaoctets, parce que rien ne redimensionne côté
   * serveur). `reduirePourEnvoi` le ramène à la largeur du contrat dans un
   * canevas ; ce que le gérant lit ensuite, c'est le poids avant et après —
   * pour qu'il comprenne ce qui vient d'arriver à sa photo plutôt que de
   * soupçonner qu'on la lui a abîmée en douce.
   */
  async function deposer(fichier: File) {
    setEnvoi(true);
    setRefus(null);
    setNote(null);
    try {
      const reduction = await reduirePourEnvoi(fichier);
      if (!reduction.ok) {
        setRefus(reduction.message);
        return;
      }
      const depot = await envoiFichier<Depot>("POST", "/medias", reduction.fichier);
      setBib((b) => ({
        medias: [depot.media, ...(b?.medias ?? []).filter((m) => m.id !== depot.media.id)],
        quota: depot.quota,
      }));
      setEtat("prete");

      const poidsDit = reduction.reduit
        ? `Photo réduite avant l'envoi : ${poids(reduction.octetsAvant)} → ${poids(
            reduction.octetsApres,
          )}${reduction.cotes ? ` (${reduction.cotes.largeur} px de large)` : ""}.`
        : `Photo envoyée telle quelle (${poids(reduction.octetsApres)}) — elle était déjà à la bonne taille.`;

      if (photos.includes(depot.media.id)) {
        // Dédoublonnage par empreinte : le même fichier redéposé retrouve sa
        // ligne. Le dire évite de chercher pourquoi rien ne s'est ajouté.
        setNote("Vous aviez déjà déposé cette photo — elle est déjà sur ce plat.");
      } else if (photos.length >= MEDIAS_PAR_PRODUIT_MAX) {
        setNote(
          `${poidsDit} Elle rejoint votre médiathèque — ce plat porte déjà ${MEDIAS_PAR_PRODUIT_MAX} photos.`,
        );
      } else {
        onChange([...photos, depot.media.id]);
        setNote(poidsDit);
      }
    } catch (e) {
      setRefus(
        e instanceof ApiError && e.status === 413
          ? "Photo trop lourde pour l'hébergement — réessayez, la réduction n'a peut-être pas abouti."
          : e instanceof Error
            ? e.message
            : "Envoi impossible — réessayez.",
      );
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mt-5 border-t border-line2 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-bold text-ink">Photos</div>
        <span className="cf-fig text-[12px] text-mut">
          {photos.length} / {MEDIAS_PAR_PRODUIT_MAX}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-mut">
        La <strong className="text-ink">première</strong> est la photo principale : c&apos;est
        elle qui s&apos;affiche à la caisse, sur votre page de commande et sur l&apos;écran de
        salle.
      </p>

      {etat === "chargement" && <Skeleton className="mt-3 h-[92px] w-full" />}

      {etat === "erreur" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <p className="text-xs text-alertt">Impossible de charger votre médiathèque.</p>
          <Btn variant="ghost" size="sm" onClick={() => void charger(true)}>
            Réessayer
          </Btn>
        </div>
      )}

      {etat === "prete" && (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {photos.length === 0 && (
              <p className="rounded-card border border-dashed border-line px-3.5 py-3 text-[13px] text-mut">
                Aucune photo pour l&apos;instant — ce plat s&apos;affiche avec son nom seul.
              </p>
            )}

            {photos.map((id, i) => {
              const media = parId.get(id);
              const alt = media ? texteAlternatif(media.alt, produitNom) : produitNom;
              return (
                /*
                 * Rangée et non vignette carrée : quatre commandes de 40 px
                 * sous une vignette de 96 ne tiennent pas sur un téléphone.
                 * `flex-wrap` — motif des lignes de recette et de tailles,
                 * déjà éprouvé sur cet écran.
                 */
                <div
                  key={id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-[image:var(--cf-elev-gradient)] p-2.5"
                >
                  <div className="size-[72px] shrink-0 overflow-hidden rounded-ctrl border border-line bg-surface2">
                    {media ? (
                      // eslint-disable-next-line @next/next/no-img-element -- image servie par notre API (ou par le paquet web pour les photos du pilote) : next/image n'a rien à y optimiser.
                      <img
                        src={media.urls.vignette}
                        // Décorative ICI : son texte alternatif est écrit en
                        // toutes lettres juste à côté, et le répéter le ferait
                        // annoncer deux fois de suite.
                        alt=""
                        style={{ objectPosition: cadrageCss(media.point) }}
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center text-mut" aria-hidden>
                        <Icon name="alert" size={18} />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {i === 0 ? (
                        <Pill className="bg-accent text-onaccent">Principale</Pill>
                      ) : (
                        <span className="text-[12px] font-semibold text-mut">Photo {i + 1}</span>
                      )}
                      {media && media.utilisePar > 1 && (
                        <span className="text-[11px] text-mut">sur {media.utilisePar} plats</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-mut">
                      {media
                        ? `${alt} · ${poids(media.octets)}`
                        : "Cette photo a été retirée de la médiathèque — détachez-la."}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Monter / descendre : l'ordre EST la hiérarchie des
                        photos, la première partant sur toutes les surfaces.
                        Le chevron du DS ne pointe qu'à droite — on le pivote
                        plutôt que d'ajouter deux tracés au jeu d'icônes. */}
                    <IconBtn
                      icon="arrow"
                      label={
                        i === 0
                          ? "Cette photo est déjà la principale"
                          : `Monter la photo ${i + 1}${i === 1 ? " — elle deviendra la principale" : ""}`
                      }
                      size={40}
                      iconSize={16}
                      disabled={i === 0}
                      className="[&_svg]:-rotate-90"
                      onClick={() => onChange(deplacer(photos, i, -1))}
                    />
                    <IconBtn
                      icon="arrow"
                      label={`Descendre la photo ${i + 1}`}
                      size={40}
                      iconSize={16}
                      disabled={i === photos.length - 1}
                      className="[&_svg]:rotate-90"
                      onClick={() => onChange(deplacer(photos, i, 1))}
                    />
                    <IconBtn
                      icon="edit"
                      label={`Cadrer la photo ${i + 1}`}
                      size={40}
                      iconSize={16}
                      disabled={!media}
                      onClick={() => media && setCadrage(media)}
                    />
                    <IconBtn
                      icon="close"
                      label={`Détacher la photo ${i + 1} de ce plat`}
                      size={40}
                      iconSize={16}
                      onClick={() => onChange(photos.filter((x) => x !== id))}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Btn variant="ghost" size="sm" icon="grid" onClick={() => setBibliothequeOuverte(true)}>
              Médiathèque{choix.length > 0 ? ` (${choix.length})` : ""}
            </Btn>
            <BoutonDepot
              envoi={envoi}
              // Le dépôt attache aussitôt : sur un plat déjà complet, il n'y a
              // rien à attacher. La médiathèque, elle, reste ouverte au dépôt —
              // c'est la bibliothèque de l'établissement, pas celle du plat.
              disabled={complet}
              titre={
                complet
                  ? `Un plat porte au plus ${MEDIAS_PAR_PRODUIT_MAX} photos — détachez-en une, ou déposez depuis la médiathèque.`
                  : undefined
              }
              onFichier={(f) => void deposer(f)}
            >
              Déposer une photo
            </BoutonDepot>
            {quota?.serre && (
              // Le quota ne s'affiche QUE quand il approche : une jauge
              // permanente demanderait de surveiller une ressource dont le
              // restaurateur n'a rien à faire tant qu'il en reste.
              <span className="text-[12px] text-prept">
                Médiathèque presque pleine — {quota.phrase}
              </span>
            )}
          </div>

          {note && <p className="mt-2 text-[12px] text-mut">{note}</p>}
          {refus && (
            <p role="alert" className="mt-2 text-xs text-alertt">
              {refus}
            </p>
          )}
        </>
      )}

      {bibliothequeOuverte && bib && (
        <ModaleMediatheque
          medias={choix}
          quota={bib.quota}
          photos={photos}
          envoi={envoi}
          onFichier={deposer}
          noteDepot={note}
          refusDepot={refus}
          onBasculer={basculer}
          onCadrer={setCadrage}
          onRetire={(id) => {
            // Un média retiré de l'établissement ne peut plus être attaché :
            // l'API refuserait l'enregistrement de la fiche avec une référence
            // qui n'existe plus. On le détache donc de la saisie en cours.
            onChange(photos.filter((x) => x !== id));
            void charger(true);
          }}
          onFerme={() => setBibliothequeOuverte(false)}
        />
      )}

      {cadrage && (
        <CadragePhoto
          media={cadrage}
          repliAlt={produitNom}
          onFerme={() => setCadrage(null)}
          onEnregistre={remplacer}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// La bibliothèque du restaurant
// ─────────────────────────────────────────────────────────────

function ModaleMediatheque({
  medias,
  quota,
  photos,
  envoi,
  onFichier,
  noteDepot,
  refusDepot,
  onBasculer,
  onCadrer,
  onRetire,
  onFerme,
}: {
  medias: MediaVue[];
  quota: QuotaMedias;
  photos: string[];
  envoi: boolean;
  onFichier: (fichier: File) => Promise<void>;
  noteDepot: string | null;
  refusDepot: string | null;
  onBasculer: (media: MediaVue) => void;
  onCadrer: (media: MediaVue) => void;
  /** Un média a quitté la médiathèque : à détacher, et à recharger (quota compris). */
  onRetire: (id: string) => void;
  onFerme: () => void;
}) {
  const [aRetirer, setARetirer] = useState<{ media: MediaVue; plats: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const etat = etatDuQuota(quota);
  const complet = photos.length >= MEDIAS_PAR_PRODUIT_MAX;

  /**
   * RETIRER DE LA MÉDIATHÈQUE — jamais en silence quand des plats s'en servent.
   *
   * L'API refuse (409) tant qu'un produit l'emploie, et rend le nombre de
   * plats concernés : la mécanique de `DELETE /categories/:id`, déjà comprise
   * de cet écran. On confirme donc avec le chiffre sous les yeux, puis on
   * renvoie `?force=true`.
   */
  async function retirer(media: MediaVue, force: boolean) {
    setBusy(true);
    setErreur(null);
    try {
      await api.del(`/medias/${media.id}${force ? "?force=true" : ""}`);
      setARetirer(null);
      onRetire(media.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const corps = e.body as { attached?: number } | null;
        setARetirer({ media, plats: corps?.attached ?? media.utilisePar });
        return;
      }
      setErreur(e instanceof Error ? e.message : "Retrait impossible — réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onFerme}
        width={720}
        title="Votre médiathèque"
        footer={
          <>
            <span className="mr-auto text-[12px] text-mut">{etat.phrase}</span>
            <BoutonDepot envoi={envoi} onFichier={onFichier}>
              Déposer
            </BoutonDepot>
            <Btn size="sm" icon="check" onClick={onFerme}>
              Terminé
            </Btn>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <BibliothequeIllustrations envoi={envoi || busy} onFichier={onFichier} />
          {noteDepot && <p role="status" className="text-xs text-mut">{noteDepot}</p>}
          {refusDepot && <p role="alert" className="text-xs text-alertt">{refusDepot}</p>}
          <p className="text-[13px] text-mut">
            Vos photos appartiennent à votre établissement : la même sert à plusieurs plats et
            survit au produit qu&apos;on renomme.
            {complet && (
              <>
                {" "}
                Ce plat porte déjà {MEDIAS_PAR_PRODUIT_MAX} photos — détachez-en une pour en
                choisir une autre.
              </>
            )}
          </p>

          {etat.serre && (
            <p className="rounded-ctrl border border-prep/40 px-3 py-2 text-[12.5px] text-prept">
              Médiathèque presque pleine ({etat.phrase}). Retirez les photos que vous
              n&apos;utilisez plus — ou appelez-nous, on agrandit.
            </p>
          )}

          {medias.length === 0 ? (
            <EmptyState
              icon="grid"
              title="Aucune photo pour l'instant"
              hint="Déposez la photo d'un plat : elle restera disponible pour tous vos produits."
              action={
                <BoutonDepot envoi={envoi} onFichier={onFichier}>
                  Déposer une photo
                </BoutonDepot>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {medias.map((media, i) => {
                const choisie = photos.includes(media.id);
                /*
                 * Le repli est un RANG, jamais le nom du plat ouvert : une
                 * photo de la bibliothèque n'appartient pas à ce plat-là, et
                 * annoncer « Kebab Fromage » sur chaque cliché non décrit
                 * mentirait à qui l'écoute au lieu de le renseigner.
                 */
                const nom = media.alt.trim() || `Photo ${i + 1}`;
                return (
                  <div key={media.id} className="relative">
                    <button
                      type="button"
                      aria-pressed={choisie}
                      disabled={!choisie && complet}
                      onClick={() => onBasculer(media)}
                      title={
                        choisie
                          ? "Retirer cette photo du plat"
                          : complet
                            ? `Ce plat porte déjà ${MEDIAS_PAR_PRODUIT_MAX} photos.`
                            : "Ajouter cette photo au plat"
                      }
                      className={cx(
                        "cf-press block w-full overflow-hidden rounded-card border-2 transition-colors duration-fast",
                        choisie ? "border-accent" : "border-line hover:border-mut",
                        !choisie && complet && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <span className="block aspect-square overflow-hidden bg-surface2">
                        {/* eslint-disable-next-line @next/next/no-img-element -- image d'API : rien à optimiser côté Next, et le recadrage est le nôtre. */}
                        <img
                          src={media.urls.vignette}
                          alt={nom}
                          style={{ objectPosition: cadrageCss(media.point) }}
                          className="size-full object-cover"
                        />
                      </span>
                      <span className="flex items-center justify-between gap-1.5 px-2 py-1.5 text-[11px] text-mut">
                        <span className="truncate">{poids(media.octets)}</span>
                        {media.utilisePar > 0 && (
                          <span className="shrink-0">{media.utilisePar} plat(s)</span>
                        )}
                      </span>
                    </button>

                    {choisie && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-2 top-2 grid size-6 place-items-center rounded-pill bg-accent text-onaccent"
                      >
                        <Icon name="check" size={14} />
                      </span>
                    )}

                    {/* Deux gestes, deux portées : la croix d'une rangée
                        détache du plat, cette corbeille retire la photo de
                        l'établissement. */}
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5">
                      <IconBtn
                        icon="edit"
                        label={`Cadrer « ${nom} »`}
                        size={40}
                        iconSize={15}
                        onClick={() => onCadrer(media)}
                      />
                      <IconBtn
                        icon="trash"
                        label={`Retirer « ${nom} » de la médiathèque`}
                        size={40}
                        iconSize={15}
                        disabled={busy}
                        onClick={() => void retirer(media, false)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {erreur && (
            <p role="alert" className="text-xs text-alertt">
              {erreur}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={aRetirer !== null}
        onClose={() => setARetirer(null)}
        destructive
        title="Retirer cette photo ?"
        footer={
          <>
            <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setARetirer(null)}>
              Annuler
            </Btn>
            <Btn
              variant="danger"
              size="sm"
              icon="trash"
              disabled={busy}
              onClick={() => aRetirer && void retirer(aRetirer.media, true)}
            >
              {busy ? "Retrait…" : "Retirer quand même"}
            </Btn>
          </>
        }
      >
        <p className="leading-[1.5] text-mut">
          <b className="cf-fig text-ink">{aRetirer?.plats ?? 0} plat(s)</b> emploient cette
          photo. La retirer la détachera de ces plats — ils s&apos;afficheront avec leur nom
          seul, ou avec leur photo suivante s&apos;ils en ont une.
        </p>
      </Modal>
    </>
  );
}
