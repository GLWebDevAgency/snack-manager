import {
  AUDIT_AUTHOR_MEANS_LABELS,
  type AuditEntryView,
} from "@sm/contracts";
// Chemin RELATIF et non l'alias `@/` : ce module est couvert par des tests
// unitaires, qui tournent hors de la résolution d'alias de Next. Même choix
// que `admin/fidelite/data.ts`, pour la même raison.
import { fmtEuro } from "../../../lib/format";

/**
 * LE REGISTRE, EN FRANÇAIS.
 *
 * Le panneau du journal ne savait raconter que trois gestes — annulation,
 * remise, changement de prix — parce que le produit n'en écrivait que trois.
 * Il en écrit dix-huit désormais, et une ligne dont le `meta` n'est pas
 * traduit s'affiche muette : le libellé de l'action, une date, et rien entre
 * les deux. Un registre à moitié lisible est celui qu'on n'ouvre pas.
 *
 * Ces deux fonctions sont pures et testées : ce sont les seules phrases que le
 * gérant lira le jour où il devra justifier une matinée de travail.
 */

const texte = (v: unknown): string => (typeof v === "string" ? v : "");
const nombre = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** « 12 kg », « 4,5 L » — la quantité avec son unité, sans zéro inutile. */
const quantite = (valeur: unknown, unite: unknown): string => {
  const n = nombre(valeur);
  if (n === null) return "";
  const u = texte(unite);
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}${u ? ` ${u}` : ""}`;
};

/** Les trois natures de mouvement, dites comme le gérant les nomme. */
const MOUVEMENT: Record<string, string> = {
  purchase: "réception",
  waste: "perte",
  count: "inventaire",
};

/**
 * LA PHRASE DU GESTE, tirée du `meta`.
 *
 * Les montants sortent en EUROS, jamais en centimes : le registre est lu par
 * un commerçant, pas par une machine. Une action sans phrase rend une chaîne
 * vide — l'écran affiche alors le libellé et la date, ce qui reste juste.
 */
export function phraseDuGeste(e: AuditEntryView): string {
  const m = e.meta;
  const nom = texte(m.name);

  switch (e.action) {
    case "price.change": {
      const de = nombre(m.fromCents);
      const vers = nombre(m.toCents);
      // Un supplément part de « gratuit » quand il n'avait pas de prix : le
      // dire vaut mieux qu'un tiret que chacun interprète.
      const depuis = de === null ? "gratuit" : fmtEuro(de);
      const jusqua = vers === null ? "gratuit" : fmtEuro(vers);
      const variante = texte(m.variantName);
      const quoi = m.supplement === true ? `supplément ${nom}` : nom;
      return `${quoi}${variante ? ` (${variante})` : ""} : ${depuis} → ${jusqua}`;
    }

    case "order.discount": {
      const montant = nombre(m.amount);
      return `${montant === null ? "" : fmtEuro(montant)}${m.reason ? ` — ${texte(m.reason)}` : ""}`;
    }

    case "order.cancel":
      return `${m.number ? `commande n° ${String(m.number)}` : ""}${m.reason ? ` — ${texte(m.reason)}` : ""}`;

    case "product.create":
      return `${nom} à ${fmtEuro(nombre(m.priceCents))}${m.categoryName ? ` — ${texte(m.categoryName)}` : ""}`;

    case "product.delete":
      return `${nom}${m.priceCents == null ? "" : ` (dernier prix ${fmtEuro(nombre(m.priceCents))})`}`;

    case "product.stock":
      return `${nom} — ${m.outOfStock === true ? "en rupture" : "de retour"}`;

    case "category.delete": {
      const detaches = nombre(m.detached) ?? 0;
      return `${nom}${detaches > 0 ? ` — ${detaches} produit${detaches > 1 ? "s" : ""} détaché${detaches > 1 ? "s" : ""}` : ""}`;
    }

    case "stock.movement": {
      const nature = MOUVEMENT[texte(m.type)] ?? texte(m.type);
      const ecart = quantite(m.qty, m.unit);
      const solde = `${quantite(m.de, m.unit)} → ${quantite(m.vers, m.unit)}`;
      return `${nom} — ${nature} de ${ecart} (${solde})${m.note ? ` — ${texte(m.note)}` : ""}`;
    }

    case "stock.adjust":
      return `${nom} : ${quantite(m.de, m.unit)} → ${quantite(m.vers, m.unit)}`;

    case "ingredient.out": {
      const coupes = nombre(m.productsUpdated) ?? 0;
      const etat = m.isOut === true ? "en rupture" : "de retour";
      // L'AMPLEUR est ce qu'un gérant cherche quand sa carte s'est vidée : un
      // seul tap peut couper sept plats.
      return `${nom} ${etat}${coupes > 0 ? ` — ${coupes} produit${coupes > 1 ? "s" : ""} concerné${coupes > 1 ? "s" : ""}` : ""}`;
    }

    case "ingredient.delete":
      return `${nom}${m.stock == null ? "" : ` — ${quantite(m.stock, m.unit)} en stock au retrait`}`;

    case "tenant.identity": {
      const champs = [
        m.name !== undefined && "nom",
        m.address !== undefined && "adresse",
        m.phones !== undefined && "téléphones",
        m.brandColor !== undefined && "couleur",
      ].filter(Boolean) as string[];
      return champs.join(", ");
    }

    case "tenant.hours": {
      const jours = nombre(m.joursServis) ?? 0;
      const fermetures = nombre(m.fermetures);
      return `${jours} jour${jours > 1 ? "s" : ""} servi${jours > 1 ? "s" : ""}${
        fermetures === null ? "" : `, ${fermetures} fermeture${fermetures > 1 ? "s" : ""}`
      }`;
    }

    case "tenant.settings": {
      // La pause de la commande en ligne est le seul réglage qui FERME la
      // vente : elle se lit en toutes lettres, les autres par leur nom.
      if (m.onlineOrderingPaused === true) return "commande en ligne mise en pause";
      if (m.onlineOrderingPaused === false) return "commande en ligne rouverte";
      const reglages = Array.isArray(m.reglages) ? (m.reglages as unknown[]).map(texte) : [];
      return reglages.filter(Boolean).join(", ");
    }

    case "tenant.brand":
      return `accent ${texte(m.accent)}${m.mode ? ` — ${m.mode === "dark" ? "fond sombre" : "fond clair"}` : ""}`;

    case "tenant.logo":
      return m.pose === true ? "nouveau logo déposé" : "logo retiré";

    case "tenant.billing_identity": {
      const avant = (m.avant ?? {}) as Record<string, unknown>;
      const apres = (m.apres ?? {}) as Record<string, unknown>;
      const changes = Object.keys(apres).filter((k) => texte(avant[k]) !== texte(apres[k]));
      return changes.length ? `champs modifiés : ${changes.join(", ")}` : "enregistrée sans changement";
    }

    default:
      return "";
  }
}

/**
 * QUI A FAIT LE GESTE — nom, rôle, et par quel moyen.
 *
 * L'écran n'affichait que le nom de l'équipier dont le PIN validait une
 * annulation, donc rien du tout sur les gestes de back-office. « Karim
 * Belkacem (propriétaire, depuis le back-office) » répond aux trois questions
 * d'un coup ; un nom seul laisse ouverte la seule qui compte au litige.
 *
 * Les lignes ANTÉRIEURES à l'auteur retombent sur le nom résolu par jointure
 * (`staffName`) : elles existent, le registre ne se réécrit pas, et elles ne
 * doivent pas s'afficher anonymes.
 */
const ROLE_LABELS: Record<string, string> = {
  owner: "propriétaire",
  gerant: "gérant",
  caisse: "caisse",
  cuisine: "cuisine",
  sm_admin: "équipe Snack Manager",
};

export function signatureDeLAuteur(e: AuditEntryView): string {
  if (!e.author) return e.staffName ? `par ${e.staffName}` : "";
  const nom = e.author.name.trim() || "auteur sans nom";
  const precisions = [
    ROLE_LABELS[e.author.role] ?? e.author.role,
    AUDIT_AUTHOR_MEANS_LABELS[e.author.means],
  ].filter(Boolean);
  return `par ${nom} (${precisions.join(", ")})`;
}
