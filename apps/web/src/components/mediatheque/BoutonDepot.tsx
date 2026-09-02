"use client";

import { useRef, type ReactNode } from "react";
import { MEDIA_FORMATS_ADMIS } from "@sm/contracts";
import { Btn } from "@/components/ui";

/**
 * LE BOUTON DE DÉPÔT ET SON CHAMP DE FICHIER — les deux voyagent ensemble.
 *
 * Un champ resté dans la page pendant qu'une modale est ouverte est rendu
 * `inert` par la pile de dialogues : le clic programmatique n'ouvre alors
 * AUCUN sélecteur, sans le moindre message. Chaque bouton porte donc le sien,
 * là où il est — dans la page, dans la médiathèque, dans l'éditeur de marque.
 *
 * Partagé, et pas recopié : les photos de plats et l'éditeur de marque
 * déposent dans la même médiathèque, avec les mêmes formats admis. Le jour où
 * `MEDIA_FORMATS_ADMIS` bouge, il n'y a qu'un `accept` à suivre.
 */
export function BoutonDepot({
  envoi,
  disabled = false,
  titre,
  onFichier,
  children,
}: {
  envoi: boolean;
  disabled?: boolean;
  titre?: string;
  onFichier: (fichier: File) => void;
  children: ReactNode;
}) {
  const champ = useRef<HTMLInputElement>(null);
  return (
    <>
      <Btn
        variant="ghost"
        size="sm"
        icon="plus"
        disabled={envoi || disabled}
        title={titre}
        onClick={() => champ.current?.click()}
      >
        {envoi ? "Envoi…" : children}
      </Btn>
      <input
        ref={champ}
        type="file"
        accept={MEDIA_FORMATS_ADMIS.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // re-choisir le même fichier doit re-déclencher
          if (f) onFichier(f);
        }}
      />
    </>
  );
}
