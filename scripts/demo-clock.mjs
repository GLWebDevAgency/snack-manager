/**
 * Décale l'horloge d'un processus Node, sans toucher au code de l'application.
 *
 * Sert UNIQUEMENT à la vitrine : le Menu Board n'affiche la carte que pendant
 * un service, et une capture faite entre midi et le soir montrerait « Fermé ».
 * On lance donc une seconde instance de l'API (même code, même base) dont
 * l'horloge tombe en plein service, et on ne lui demande que le contenu de
 * l'écran. Rien n'est inventé : la carte, les prix et la marque sont les vrais.
 *
 *   SM_CLOCK_SHIFT_MS=16200000 PORT=3009 \
 *     node --import ../../scripts/demo-clock.mjs dist/main.js
 */
const SHIFT_MS = Number(process.env.SM_CLOCK_SHIFT_MS ?? 0);

if (Number.isFinite(SHIFT_MS) && SHIFT_MS !== 0) {
  const RealDate = Date;

  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + SHIFT_MS);
      else super(...args);
    }
    static now() {
      return RealDate.now() + SHIFT_MS;
    }
  }

  // Mongoose identifie les types de schéma PAR LE NOM du constructeur
  // (`type: Date`) : une sous-classe nommée « ShiftedDate » ferait échouer le
  // chargement des modèles avant même la première requête.
  Object.defineProperty(ShiftedDate, 'name', { value: 'Date', configurable: true });

  globalThis.Date = ShiftedDate;
  // eslint-disable-next-line no-console
  console.log(`[demo-clock] horloge décalée de ${SHIFT_MS} ms → ${new ShiftedDate().toISOString()}`);
}
