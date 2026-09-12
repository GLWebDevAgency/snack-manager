"use client";

/**
 * ÉTABLISSEMENT — l'identité de l'enseigne, éditable par le gérant.
 *
 * Longtemps, le nom, la couleur, l'adresse et les téléphones étaient
 * consommés partout (caisse, cuisine, tickets, vitrine) et éditables nulle
 * part : chaque retouche passait par un appel à Snack Manager (diagnostic
 * quatre casquettes, P2). Cette page ferme cette dépendance.
 *
 * ─── TROIS CHOSES QUI SE SONT DÉPLACÉES, ET POURQUOI ───────────────────────
 *
 * 1. LA COULEUR DE MARQUE N'EST PLUS DANS « L'IDENTITÉ ». Elle y était un
 *    sélecteur d'accent isolé, qui écrivait `brandColor` — lequel se recopie
 *    depuis dans `brand.palette.accent` ET recalcule `onAccent`
 *    (`identiteAvecAccent`, côté API). Deux écrans qui écrivent la même
 *    couleur par deux chemins finissent par se contredire ; l'accent est donc
 *    UN des cinq rôles de l'éditeur de marque, et rien d'autre ne l'écrit.
 *
 * 2. LE LOGO N'A PLUS SON PANNEAU. Il n'y en avait qu'UN (`PUT
 *    /tenants/me/logo`, qui se pose dans `brand.logo.mark.dark`) alors que le
 *    masque en porte QUATRE plus une image d'accueil, et les quatre autres ne
 *    se remplissaient qu'en collant une adresse dans un appel direct.
 *    L'éditeur les tient tous les cinq, choisis dans la médiathèque. Les deux
 *    chemins de dépôt s'appuient sur le MÊME magasin d'objets (`IMAGE_STORE`) :
 *    retirer l'ancien ne ferme donc aucune porte qui serait restée ouverte.
 *
 * 3. LE REGISTRE et « ce qui ne s'édite pas ici » restent en pied de page :
 *    ce sont les deux choses qu'on vient relire, pas celles qu'on vient
 *    changer.
 *
 * API : GET /tenants/me · PATCH /tenants/me/identity · PATCH /tenants/me/marque.
 * Le nom et la couleur repartent vers les tablettes au battement suivant, sans
 * réappairage.
 */

import { useEffect, useState } from "react";
import type { AuditEntryView } from "@sm/contracts";
import { api, type TenantMe } from "@/lib/api";
import { nomAffichable, poserMonNom, useIdentite } from "@/lib/identite";
import { Btn, Field, Input, Panel, Skeleton, useToast } from "@/components/ui";
import { EditeurDeMarque, EditeurDeMarqueEnAttente } from "./EditeurDeMarque";
import { phraseDuGeste, signatureDeLAuteur } from "./journal";
import { Salle } from "./Salle";

export default function SettingsPage() {
  const toast = useToast();
  const [me, setMe] = useState<TenantMe | null>(null);
  const [indisponible, setIndisponible] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phones, setPhones] = useState<string[]>(["", "", ""]);
  const [journal, setJournal] = useState<AuditEntryView[] | null>(null);

  /*
   * ── VOTRE COMPTE : LA PERSONNE, PAS L'ENSEIGNE ──
   *
   * `users.name` n'avait qu'un auteur — la conversion d'un lead, depuis un
   * champ FACULTATIF de la modale du CRM — et aucune route ne le mettait à
   * jour. Laissé vide à la signature, il l'était pour toujours, et se lisait
   * comme un tiret sous la pastille, en pied de barre.
   *
   * POURQUOI SUR CET ÉCRAN, qui porte pourtant l'identité de l'ENSEIGNE. Un
   * nom de personne n'est pas un nom d'établissement, et l'argument de les
   * séparer est réel. Trois faits l'emportent quand même :
   *
   *  · un écran dédié à UN champ coûte une entrée dans la barre — le rail
   *    replié n'a que son icône pour repère, et `navigation.ts` demande une
   *    icône distincte par écran. On ouvrirait une porte de plus pour un
   *    formulaire d'une ligne ;
   *  · « Réglages » est déjà nommé « ce qu'on règle une fois puis presque
   *    jamais » : poser son nom en fait partie, très exactement ;
   *  · c'est le seul écran de réglages ouvert à TOUS les rôles — donc le seul
   *    où la question « où paramètre-t-on son compte ? » se pose à qui la pose.
   *
   * La séparation se tient alors par le PANNEAU, pas par l'écran : titre,
   * sous-titre et libellés disent la personne, à côté d'un panneau qui dit
   * l'enseigne. Le jour où le compte porte plus qu'un nom (mot de passe,
   * courriel, préférences), il méritera son écran — et cette section y
   * déménagera d'un bloc.
   */
  const identite = useIdentite(true);
  const nomActuel = nomAffichable(identite) ?? "";
  /*
   * `null` = « rien n'a été tapé », et c'est ce qui évite un effet de
   * resynchronisation : la valeur affichée retombe alors sur celle du serveur,
   * y compris après l'enregistrement. Le brouillon ne survit pas à ce qu'il a
   * produit.
   */
  const [brouillonNom, setBrouillonNom] = useState<string | null>(null);
  const [busyNom, setBusyNom] = useState(false);
  const nomSaisi = brouillonNom ?? nomActuel;
  const nomDirty = nomSaisi.trim() !== "" && nomSaisi.trim() !== nomActuel;

  async function enregistrerNom() {
    if (busyNom || !nomDirty) return;
    setBusyNom(true);
    try {
      // `poserMonNom` prévient toutes les barres ouvertes : sans cela, la
      // personne enregistrerait son nom et continuerait de lire un tiret
      // au-dessus du bouton de déconnexion.
      await poserMonNom(nomSaisi.trim());
      setBrouillonNom(null);
      toast("Votre nom est enregistré — il s’affiche en bas de la barre", { icon: "check" });
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setBusyNom(false);
    }
  }

  useEffect(() => {
    api
      .get<{ entries: AuditEntryView[] }>("/audit?limit=50")
      .then((r) => setJournal(r.entries))
      .catch(() => setJournal([]));
  }, []);

  useEffect(() => {
    api
      .get<TenantMe>("/tenants/me")
      .then((t) => {
        setMe(t);
        setName(t.name);
        setAddress(t.address ?? "");
        setPhones([t.phones?.[0] ?? "", t.phones?.[1] ?? "", t.phones?.[2] ?? ""]);
      })
      .catch(() => setIndisponible(true));
  }, []);

  const dirty =
    me !== null &&
    (name.trim() !== me.name ||
      address.trim() !== (me.address ?? "") ||
      phones.filter(Boolean).join("|") !== (me.phones ?? []).join("|"));

  async function save() {
    if (!me || busy || !name.trim()) return;
    setBusy(true);
    try {
      // `brandColor` n'est plus envoyé : il appartient à l'éditeur de marque,
      // qui écrit la palette entière. Le champ reste facultatif au contrat —
      // ne pas l'envoyer laisse l'accent strictement inchangé.
      const next = await api.patch<TenantMe>("/tenants/me/identity", {
        name: name.trim(),
        address: address.trim(),
        phones: phones.map((p) => p.trim()).filter(Boolean),
      });
      setMe(next);
      toast("Identité enregistrée — les tablettes suivent au prochain battement", {
        icon: "check",
      });
    } catch {
      toast("Enregistrement impossible — réessayez");
    } finally {
      setBusy(false);
    }
  }

  if (indisponible) {
    return (
      <div className="p-4 md:p-[26px]">
        <Panel title="Établissement">
          <p className="text-[13px] text-mut">
            La fiche de l&apos;établissement n&apos;a pas répondu. Rechargez la page ; si ça
            persiste, appelez-nous.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-[26px]">
      <Salle identite={identite} capacites={me === null ? null : me.capacites ?? []} />
      <Panel
        title="L'identité de l'enseigne"
        sub="Le nom s'applique partout : caisse, cuisine, tickets, page de commande."
        className="max-w-[720px]"
        bodyClassName="flex flex-col gap-4"
      >
        {me === null ? (
          <>
            <Skeleton className="h-[52px]" />
            <Skeleton className="h-[52px]" />
          </>
        ) : (
          <>
            <Field label="Nom de l'enseigne" htmlFor="id-name">
              <Input id="id-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>

            <Field label="Adresse du comptoir" htmlFor="id-address" hint="Telle qu'elle s'imprime sur les tickets.">
              <Input id="id-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>

            <Field label="Téléphones (jusqu'à trois)" htmlFor="id-phone-0">
              <div className="flex flex-col gap-2">
                {phones.map((p, i) => (
                  <Input
                    key={i}
                    id={`id-phone-${i}`}
                    value={p}
                    placeholder={i === 0 ? "02 32 00 00 00" : ""}
                    onChange={(e) =>
                      setPhones((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                ))}
              </div>
            </Field>

            <div className="flex items-center gap-3">
              <Btn
                variant="ink"
                icon="check"
                disabled={!dirty || busy || !name.trim()}
                onClick={() => void save()}
              >
                {busy ? "Enregistrement…" : "Enregistrer"}
              </Btn>
              {!dirty && <span className="text-xs text-mut">Rien à enregistrer.</span>}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Votre compte"
        sub="Le nom de la personne connectée — celui qui s'affiche sous votre pastille, en bas de la barre. Ce n'est pas le nom de l'enseigne."
        className="max-w-[720px]"
        bodyClassName="flex flex-col gap-4"
      >
        {identite === null ? (
          // L'attente et l'échec se ressemblent ici, comme en pied de barre :
          // l'écran ne fabrique pas un nom qu'il n'a pas.
          <Skeleton className="h-[52px]" />
        ) : identite.genre === "staff" ? (
          /*
            UNE SESSION OUVERTE AU CODE N'A PAS DE COMPTE À NOMMER.
            Le nom d'un équipier vit dans l'équipe, pas dans les comptes, et
            c'est le propriétaire ou le gérant qui le pose (l'API réserve les
            routes d'équipe à ces deux rôles). Le laisser se renommer depuis la
            tablette du comptoir donnerait à qui connaît quatre chiffres le
            moyen de réécrire le nom qui signe le registre ci-dessous et les
            pointages. On ne propose donc pas ici une porte qu'on fermerait.
          */
          <p className="text-[13px] leading-relaxed text-mut">
            Vous êtes connecté avec un code, sur une tablette appairée. Votre nom est celui de
            votre fiche d&apos;équipe : il se pose sur l&apos;écran <b className="text-ink">Équipe</b>,
            par le propriétaire ou le gérant.
          </p>
        ) : (
          <>
            <Field
              label="Votre nom"
              htmlFor="compte-nom"
              hint="Tel que vous voulez le lire en bas de la barre. Il ne sort pas du back-office : vos clients ne le voient nulle part."
            >
              <Input
                id="compte-nom"
                value={nomSaisi}
                placeholder="Camille Fournier"
                onChange={(e) => setBrouillonNom(e.target.value)}
                required
              />
            </Field>
            <div className="flex items-center gap-3">
              <Btn
                variant="ink"
                icon="check"
                disabled={!nomDirty || busyNom}
                onClick={() => void enregistrerNom()}
              >
                {busyNom ? "Enregistrement…" : "Enregistrer"}
              </Btn>
              {!nomDirty && (
                <span className="text-xs text-mut">
                  {nomActuel ? "Rien à enregistrer." : "Votre nom n’est pas encore renseigné."}
                </span>
              )}
            </div>
          </>
        )}
      </Panel>

      {/*
        L'ÉDITEUR DE MARQUE — ce que voient VOS clients, et rien de ce que voit
        votre équipe. Le back-office garde sa peau grise : un équipier ne doit
        pas rechercher ses repères parce que le patron a changé sa vitrine.
      */}
      <div>
        <h2 className="mb-1 text-lg font-semibold tracking-[-0.03em] text-ink">
          Votre identité visuelle
        </h2>
        <p className="mb-3 max-w-[720px] text-[13px] leading-relaxed text-mut">
          Elle habille ce que voient vos clients : page de commande, suivi, carte de fidélité,
          écran de salle. Votre back-office, lui, ne change pas — vos équipiers gardent leurs
          repères.
        </p>
        {me === null ? (
          <EditeurDeMarqueEnAttente />
        ) : (
          <EditeurDeMarque
            me={me}
            onEnregistre={(t) => {
              setMe(t);
              toast("Identité visuelle enregistrée — vos clients la verront à leur prochaine visite", {
                icon: "check",
              });
            }}
          />
        )}
      </div>

      {/*
        LE REGISTRE, ENFIN COMPLET.

        Il ne montrait que trois gestes parce que le produit n'en écrivait que
        trois : tout ce qui touchait au stock, aux ruptures, aux horaires ou à
        l'identité passait sans laisser de trace. C'est le seul endroit où ce
        travail devient visible pour le gérant — et la seule page qu'il ouvrira
        le jour d'un contrôle ou d'un désaccord avec un équipier.
      */}
      <Panel
        title="Journal des gestes sensibles"
        sub="Prix, ruptures, stocks, horaires et identité — le registre de votre établissement, inaltérable"
        className="max-w-[1040px]"
        bodyClassName="flex flex-col gap-1.5"
      >
        {journal === null ? (
          <Skeleton className="h-[48px]" />
        ) : journal.length === 0 ? (
          <p className="text-[13px] text-mut">
            Aucun geste sensible enregistré — le registre se remplit au premier changement de
            prix, à la première rupture ou au premier mouvement de stock.
          </p>
        ) : (
          journal.map((e) => (
            <div
              key={e._id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-card border border-line2 bg-ink/3 px-3.5 py-2"
            >
              <span className="text-[13px] font-bold text-ink">{e.actionLabel}</span>
              {/* QUI, à quel titre, par quel moyen — les trois d'un coup. */}
              <span className="text-xs text-mut">{signatureDeLAuteur(e)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-mut">{phraseDuGeste(e)}</span>
              <span className="cf-fig shrink-0 text-xs text-mut">
                {new Date(e.at).toLocaleString("fr-FR")}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Ce qui ne s'édite pas ici" className="max-w-[720px]" bodyClassName="flex flex-col gap-2">
        <p className="text-[13px] leading-relaxed text-mut">
          <b className="text-ink">L&apos;adresse publique</b> ({me ? `${me.slug}.snackmanager.app` : "votre-slug.snackmanager.app"})
          ne se change pas seul : elle casse la fiche Google et les QR imprimés. Un appel, et on
          la migre proprement avec vous.
        </p>
      </Panel>
    </div>
  );
}
