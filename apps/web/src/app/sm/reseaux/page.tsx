"use client";

/**
 * RÉSEAUX SOCIAUX DE LA VITRINE — back-office INTERNE Snack Manager.
 *
 * Quatre champs, un par réseau, et une seule question à laquelle l'écran doit
 * répondre en partant : « qu'est-ce qui est PUBLIC en ce moment ? ». Ce qui
 * est enregistré ici part sur la page d'accueil de l'entreprise sans
 * relecture ; le formulaire n'est donc pas un formulaire de réglages ordinaire,
 * c'est une mise en ligne.
 *
 * Trois choix d'usage en découlent.
 *
 * 1. UN CHAMP VIDE SE VOIT SANS QU'ON LISE L'URL. Le pictogramme du réseau
 *    s'allume au laiton de la maison quand le compte est publié et reste gris
 *    quand il ne l'est pas, et une pastille le dit en toutes lettres. Sur
 *    quatre lignes qui se ressemblent, l'œil doit trancher avant la lecture.
 *
 * 2. L'ERREUR SE LIT À CÔTÉ DU CHAMP FAUTIF. Un bandeau en haut de page
 *    obligerait à chercher lequel des quatre est en cause — et le message le
 *    plus fréquent (« cette adresse mène à TikTok, pas à Instagram ») ne veut
 *    rien dire loin de son champ.
 *
 * 3. APRÈS ENREGISTREMENT, L'ÉCRAN DIT CE QUI EST DÉSORMAIS PUBLIC. C'est la
 *    seule chose à savoir en quittant la page : la liste des pictogrammes que
 *    le visiteur verra, avec les adresses réellement en ligne.
 *
 * Le composant `Reseaux` de la vitrine n'est PAS touché ici : il continue de
 * ne rien afficher tant qu'aucune adresse n'est renseignée. Seule la SOURCE
 * des URL change, et son branchement est un chantier distinct.
 */

import { useCallback, useEffect, useState } from "react";
import {
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_DOMAINS,
  SOCIAL_NETWORK_LABELS,
  EMPTY_SOCIAL_LINKS,
  type PlatformSocialLinks,
  type SocialNetwork,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Btn, Card, Field, Input, Panel, Pill, Skeleton, useToast } from "@/components/ui";
// Le MÊME pictogramme que la vitrine, pris à sa source plutôt que recopié :
// l'écran qui décide de l'affichage doit montrer exactement ce que le visiteur
// verra. Une copie locale finirait par diverger, et c'est le CRM qui mentirait.
import { RESEAU_ICONS } from "@/components/marketing/icons";
import { fmtDay } from "../crm";
import {
  hasChanged,
  platformApi,
  readApiErrors,
  toDraft,
  validate,
  type SocialErrors,
} from "./data";

export default function ReseauxPage() {
  const toast = useToast();

  const [saved, setSaved] = useState<PlatformSocialLinks | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState(toDraft(EMPTY_SOCIAL_LINKS));
  const [errors, setErrors] = useState<SocialErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    platformApi
      .settings()
      .then((s) => {
        setSaved(s.social);
        setUpdatedAt(s.updatedAt);
        setDraft(toDraft(s.social));
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  function edit(network: SocialNetwork, value: string) {
    setDraft((d) => ({ ...d, [network]: value }));
    // L'erreur disparaît dès qu'on retouche le champ : la laisser sous un
    // champ qu'on est en train de corriger fait douter de la correction.
    setErrors((e) => (e[network] ? { ...e, [network]: undefined } : e));
    setGlobalError(null);
  }

  async function save() {
    if (!saved) return;
    const { errors: found, body } = validate(draft, saved);
    if (!body) {
      setErrors(found);
      return;
    }
    // Rien n'a bougé : pas de requête, pas de ligne de journal, pas de toast
    // qui féliciterait d'un geste qui n'a rien fait.
    if (Object.keys(body).length === 0) return;

    setSaving(true);
    setErrors({});
    setGlobalError(null);
    try {
      const next = await platformApi.save(body);
      setSaved(next.social);
      setUpdatedAt(next.updatedAt);
      setDraft(toDraft(next.social));
      toast("Vitrine mise à jour", { icon: "check" });
    } catch (error) {
      const read = readApiErrors(error);
      setErrors(read.errors);
      setGlobalError(read.global);
    } finally {
      setSaving(false);
    }
  }

  if (loadFailed) {
    return (
      <div className="p-[26px] max-md:p-4">
        <Panel
          title="Réglages injoignables"
          sub="Les liens actuellement en ligne n’ont pas pu être lus."
          actions={
            <Btn variant="ghost" size="sm" icon="arrow" onClick={load}>
              Réessayer
            </Btn>
          }
        >
          <p className="text-[13px] text-mut">
            La vitrine, elle, continue d’afficher ce qui a été enregistré la
            dernière fois : elle ne dépend pas de cet écran pour fonctionner.
          </p>
        </Panel>
      </div>
    );
  }

  if (!saved) {
    return (
      <div className="flex flex-col gap-4 p-[26px] max-md:p-4">
        <Skeleton className="h-[92px]" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  const dirty = hasChanged(draft, saved);
  const publies = SOCIAL_NETWORKS.filter((n) => saved[n] !== null);

  return (
    <div className="flex max-w-[860px] flex-col gap-4 p-[26px] max-md:p-4">
      {/* ── Ce qui est PUBLIC en ce moment : la première chose lue, la dernière retenue ── */}
      <EnLigne links={saved} updatedAt={updatedAt} count={publies.length} />

      <Panel
        title="Comptes de la vitrine"
        sub="Collez l’adresse complète du profil. Un champ vide retire le pictogramme de la page d’accueil."
        actions={
          <Btn icon="check" onClick={save} disabled={!dirty || saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Btn>
        }
        bodyClassName="flex flex-col gap-3.5"
      >
        {SOCIAL_NETWORKS.map((network) => (
          <LigneReseau
            key={network}
            network={network}
            value={draft[network]}
            error={errors[network]}
            onChange={(value) => edit(network, value)}
          />
        ))}

        {/*
          Le seul message GLOBAL de l'écran, et il ne parle jamais d'un champ :
          un refus de droits ou une API injoignable ne se corrigent pas dans le
          formulaire, les poser sous un champ serait un contresens.
        */}
        {globalError && (
          <p className="rounded-ctrl border border-alert/40 bg-alert/8 px-3.5 py-3 text-[13px] font-semibold text-alertt" role="alert">
            {globalError}
          </p>
        )}
      </Panel>
    </div>
  );
}

/**
 * ═══ « QU'EST-CE QUI EST PUBLIC ? » ═══
 *
 * En haut parce que c'est l'état, pas le résultat d'un geste : on doit le lire
 * en arrivant comme en repartant. Les adresses sont CELLES DE LA BASE (`saved`)
 * et non celles du formulaire — un champ à moitié tapé ne doit jamais compter
 * comme publié, sinon ce bloc dirait le contraire de la vérité au pire moment.
 */
function EnLigne({
  links,
  updatedAt,
  count,
}: {
  links: PlatformSocialLinks;
  updatedAt: string | null;
  count: number;
}) {
  return (
    <Card className="p-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
          Sur la page d’accueil en ce moment
        </h2>
        {updatedAt && (
          <p className="text-[13px] text-mut">Dernière modification le {fmtDay(updatedAt)}</p>
        )}
      </div>

      {count === 0 ? (
        <p className="mt-2.5 text-[13px] text-mut">
          Aucun réseau publié — la vitrine n’affiche{" "}
          <strong className="font-semibold text-ink">aucun pictogramme</strong>. C’est
          l’état voulu tant qu’un compte n’est pas ouvert : mieux vaut rien qu’un lien
          mort.
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[13px] text-mut">
            {count === 1
              ? "Un pictogramme est visible par les visiteurs :"
              : `${count} pictogrammes sont visibles par les visiteurs :`}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {SOCIAL_NETWORKS.filter((n) => links[n] !== null).map((network) => {
              const Picto = RESEAU_ICONS[network];
              return (
                <li key={network} className="flex min-w-0 items-center gap-2.5">
                  <span className="shrink-0 text-accent" aria-hidden>
                    <Picto size={16} />
                  </span>
                  <span className="shrink-0 text-[13px] font-bold text-ink">
                    {SOCIAL_NETWORK_LABELS[network]}
                  </span>
                  {/*
                    Le lien est CLIQUABLE : la seule vérification qui vaille est
                    de l'ouvrir. `rel="noreferrer"` parce qu'on envoie chez un
                    tiers depuis un back-office interne.
                  */}
                  <a
                    href={links[network]!}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-[13px] text-mut underline decoration-white/20 underline-offset-2 hover:text-white hover:decoration-white/50"
                  >
                    {links[network]}
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/**
 * Une ligne de saisie : pictogramme, libellé, état, champ.
 *
 * L'ÉTAT SE LIT AVANT L'URL. Le pictogramme au laiton et la pastille
 * « Publié » disent en un coup d'œil ce qu'il faudrait sinon déduire de la
 * présence d'un texte dans un champ — sur quatre lignes identiques, c'est la
 * différence entre voir et vérifier.
 *
 * L'état affiché suit la SAISIE en cours (`value`), pas la base : quand on
 * vide un champ, la ligne passe aussitôt à « Non publié », ce qui annonce
 * l'effet de l'enregistrement avant qu'il ait lieu. Le bloc du haut, lui,
 * continue de dire l'état réellement en ligne — les deux ne se contredisent
 * pas, ils répondent à deux questions différentes.
 */
function LigneReseau({
  network,
  value,
  error,
  onChange,
}: {
  network: SocialNetwork;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const Picto = RESEAU_ICONS[network];
  const rempli = value.trim() !== "";
  const id = `reseau-${network}`;

  return (
    <div className="flex items-start gap-3">
      {/* Pictogramme : allumé = publié, éteint = pas de compte. */}
      <span
        className={cx(
          "mt-[26px] grid size-10 shrink-0 place-items-center rounded-ctrl border transition-colors duration-200 ease-sm",
          rempli
            ? "border-accent/45 bg-accent/12 text-accent"
            : "border-white/8 bg-white/4 text-mut/60",
        )}
        aria-hidden
      >
        <Picto size={19} />
      </span>

      <Field
        className="min-w-0 flex-1"
        label={SOCIAL_NETWORK_LABELS[network]}
        htmlFor={id}
        error={error}
        hint={
          rempli
            ? undefined
            : `Non publié — laissez vide tant que le compte ${SOCIAL_NETWORK_LABELS[network]} n’existe pas.`
        }
      >
        <div className="flex items-center gap-2.5">
          <Input
            id={id}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`https://${SOCIAL_NETWORK_DOMAINS[network][0]}/snackmanager`}
            aria-invalid={error ? true : undefined}
            className={cx(
              "min-w-0 flex-1",
              // Le champ rempli porte le filet laiton : la ligne publiée se
              // distingue de la ligne vide même quand l'URL est tronquée.
              rempli && !error && "border-accent/35 bg-white/8",
              error && "border-alert/60",
            )}
          />
          <Pill
            variant={rempli ? "solid" : "out"}
            className={cx("shrink-0", rempli && "border-accent/45 bg-accent/12 text-accent")}
          >
            {rempli ? "Publié" : "Vide"}
          </Pill>
        </div>
      </Field>
    </div>
  );
}
