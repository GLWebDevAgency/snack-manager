"use client";

/** Briques de l'écran « Votre site web » : copie, badge d'état, fiche DNS. */

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { Btn, Icon, useToast } from "@/components/ui";
import { dnsZoneOf, type DnsInstruction, type DomainStatus } from "./types";

// ─────────────────────────────────────────────────────────────
// Copie
// ─────────────────────────────────────────────────────────────

/**
 * Bouton « Copier ». Recopier un CNAME à la main est la première source
 * d'erreur de l'installation — un caractère oublié et le domaine reste en
 * attente pendant des jours sans que personne comprenne pourquoi.
 */
export function CopyBtn({
  value,
  what,
  compact = false,
}: {
  value: string;
  /** Ce qui est copié, pour le toast et le lecteur d'écran : « la valeur CNAME ». */
  what: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
      toast(`${what} copié`, { icon: "check" });
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on le dit
      // plutôt que de laisser croire à une copie réussie.
      toast("Copie impossible — sélectionnez le texte à la main");
    }
  }

  return (
    <Btn
      variant="ghost"
      size="sm"
      icon={done ? "check" : "grid"}
      aria-label={`Copier ${what}`}
      onClick={() => void copy()}
      className={cx("min-h-11", compact && "px-3 py-[7px]", done && "text-okt")}
    >
      {done ? "Copié" : "Copier"}
    </Btn>
  );
}

// ─────────────────────────────────────────────────────────────
// État d'un domaine
// ─────────────────────────────────────────────────────────────

/**
 * Couleurs FONCTIONNELLES, jamais l'accent de marque (direction artistique §3) :
 * ambre = attente, vert = opérationnel, rouge = échec. L'attente DNS est en
 * contour et l'émission du certificat en aplat — la seconde signifie que le
 * client a fait sa part et qu'il n'a plus qu'à patienter.
 */
const STATUS: Record<DomainStatus, string> = {
  pending_dns: "border-[1.5px] border-prep bg-transparent text-prept",
  issuing_certificate: "bg-prep text-[#1C1612]",
  active: "bg-ok text-white",
  failed: "bg-alert text-white",
};

export function DomainStatusBadge({
  status,
  label,
}: {
  status: DomainStatus;
  label: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[9px] font-bold uppercase tracking-[0.06em]",
        STATUS[status],
      )}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Fiche DNS
// ─────────────────────────────────────────────────────────────

function DnsRow({
  label,
  value,
  hint,
  copy,
}: {
  label: string;
  value: string;
  hint?: string;
  copy?: string;
}) {
  return (
    // Sur téléphone, la valeur entière passe sous l'étiquette. Aucune largeur
    // minimale forcée dans cette fiche imbriquée : elle tient aussi à 320 px.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line2 py-2.5 first:border-t-0 first:pt-0">
      <div className="w-[92px] shrink-0 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
        {label}
      </div>
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <div className="break-all font-mono text-[15px] font-bold text-ink">
          {value}
        </div>
        {hint && <div className="mt-0.5 break-words text-xs text-mut">{hint}</div>}
      </div>
      {copy && <CopyBtn value={value} what={copy} compact />}
    </div>
  );
}

/**
 * L'écran le plus pédagogique du back-office : le restaurateur doit pouvoir
 * recopier ces quatre lignes dans un panneau qu'il n'a jamais ouvert. On donne
 * l'étiquette courte ET le nom complet parce que les hébergeurs ne demandent
 * pas la même chose, et on nomme les menus exacts des trois plus courants.
 */
export function DnsInstructionCard({ dns }: { dns: DnsInstruction }) {
  const zone = dnsZoneOf(dns);
  return (
    <div className="rounded-card border border-line2 bg-surface2 p-3.5">
      <div className="mb-3 flex items-start gap-2.5">
        <Icon name="gear" size={16} className="mt-0.5 shrink-0 text-gold" />
        <p className="text-[13px] text-mut">
          Connectez-vous chez l&apos;hébergeur de{" "}
          <span className="font-semibold text-ink">{zone}</span>, ouvrez la zone
          DNS et créez cet enregistrement — puis revenez cliquer sur «&nbsp;Vérifier
          maintenant&nbsp;».
        </p>
      </div>

      <div className="rounded-ctrl border border-line2 bg-surface px-3.5 py-2.5">
        <DnsRow label="Type" value={dns.type} />
        <DnsRow
          label="Nom"
          value={dns.name}
          hint={`Si votre hébergeur réclame le nom complet, saisissez « ${dns.fullName} ».`}
          copy="Le nom"
        />
        <DnsRow label="Valeur" value={dns.value} copy="La valeur CNAME" />
        <DnsRow
          label="TTL"
          value={String(dns.ttl)}
          hint="Laissez la valeur par défaut si le champ n'est pas modifiable."
        />
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-mut">
        Où coller&nbsp;? Chez <span className="font-semibold text-ink">OVH</span>{" "}
        dans «&nbsp;Noms de domaine → {zone} → Zone DNS → Ajouter une
        entrée&nbsp;», chez <span className="font-semibold text-ink">Gandi</span>{" "}
        dans «&nbsp;Domaine → Enregistrements DNS → Ajouter&nbsp;», chez{" "}
        <span className="font-semibold text-ink">Ionos</span> dans
        «&nbsp;Domaines &amp; SSL → {zone} → DNS → Ajouter un
        enregistrement&nbsp;».
      </p>
      <p className="mt-1.5 text-[13px] text-mut">
        La propagation prend de quelques minutes à quelques heures&nbsp;; le
        certificat HTTPS est ensuite émis automatiquement.
      </p>
    </div>
  );
}
