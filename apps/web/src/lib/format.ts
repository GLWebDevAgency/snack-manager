/**
 * Formatage fr-FR partagé du back-office. Tous les montants circulent en
 * CENTIMES (int) — la conversion en euros n'existe qu'à l'affichage.
 */

/** 129000 (centimes) → « 1 290,00 € » ; null/NaN → « — ». */
export function fmtEuro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return (
    (cents / 100)
      .toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      // espace insécable étroite → insécable classique (rendu plus sûr)
      .replace(/ /g, " ") + " €"
  );
}

/** Date longue française, première lettre capitalisée : « Mardi 18 août 2026 ». */
export function fmtDateFr(d: Date | string | number = new Date()): string {
  const s = new Date(d).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Ancienneté relative : « à l'instant », « il y a 12 min », puis heures
 * arrondies à 0,5 h près (« il y a 1,5 h »), enfin jours (« il y a 3 j »).
 */
export function timeAgo(d: Date | string | number): string {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return "à l'instant";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(ms / 1_800_000) / 2; // arrondi à la demi-heure
  if (hours < 24) return `il y a ${String(hours).replace(".", ",")} h`;
  return `il y a ${Math.floor(ms / 86_400_000)} j`;
}
