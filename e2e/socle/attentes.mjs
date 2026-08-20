/**
 * LES ATTENTES — LA SEULE CHOSE QUI SÉPARE UN TEST UTILE D'UN TEST QUI CLIGNOTE.
 *
 * ─── LA RÈGLE ───
 *
 * ON N'ATTEND JAMAIS UNE DURÉE. On attend un ÉTAT DE L'ÉCRAN.
 *
 * `await page.waitForTimeout(1500)` n'apparaît dans AUCUN scénario, et ce n'est
 * pas une préférence de style. Une durée fixe est fausse dans les deux sens :
 * trop courte, elle rougit un jour où le routeur réveille un conteneur — et ce
 * rouge-là ne désigne aucune panne, il apprend seulement à relancer sans lire ;
 * trop longue, elle fait payer l'attente à chaque exécution, y compris aux
 * milliers qui n'en avaient pas besoin.
 *
 * Une attente d'état n'a aucun de ces deux défauts : elle rend la main dès que
 * l'écran dit ce qu'on cherchait, et elle ne tombe que si l'écran ne le dit
 * jamais — c'est-à-dire quand quelque chose est réellement cassé.
 *
 * ─── LES DEUX SEULES EXCEPTIONS, ET ELLES SONT ICI ───
 *
 * Elles existent parce que, dans ces deux cas précis, IL N'Y A PAS D'ÉTAT À
 * ATTENDRE — l'écran ne peut pas dire ce qu'on voudrait savoir :
 *
 *   · `cliquerJusqua` — pendant l'hydratation d'une page Next.js, rien ne
 *     distingue un bouton interactif d'un bouton qui ne l'est pas encore. On
 *     réessaie donc le geste jusqu'à ce qu'il produise son EFFET : la condition
 *     d'arrêt reste « l'écran a changé », jamais « le temps a passé ».
 *   · `rechargerJusqua` — un cache serveur de 60 s ne s'annonce pas au
 *     navigateur ; seule une nouvelle requête découvre qu'il a expiré. C'est le
 *     seul `waitForTimeout` du dossier, et il sépare deux sondes.
 *
 * Toutes les autres fonctions attendent quelque chose de VISIBLE.
 */

/**
 * Ajoute une explication à une erreur — DANS LE MESSAGE ET DANS LA PILE.
 *
 * Les deux, et c'est le piège : le rapporteur de `node:test` affiche la PILE,
 * pas le message. Une explication ajoutée au seul `message` — le réflexe — est
 * calculée, stockée, et jamais lue par personne. On a vérifié : elle
 * n'apparaissait nulle part dans la sortie du test en échec.
 */
export function enrichir(erreur, ajout) {
  erreur.message = `${erreur.message}\n${ajout}`;
  if (typeof erreur.stack === 'string') erreur.stack = `${erreur.stack}\n\n${ajout}`;
  return erreur;
}

/**
 * Le bloc qui porte une étiquette — pour lire la valeur posée à côté d'elle.
 *
 * La caisse affiche ses montants en deux nœuds voisins : « À RENDRE » d'un
 * côté, « 10,10 € » de l'autre. Chercher « 10,10 € » seul dans la page serait
 * faux — trois montants peuvent valoir 10,10 € au même instant, et le test
 * passerait en désignant le mauvais. On remonte donc au parent commun, et on
 * cherche le montant DEDANS.
 *
 * Remarque qui a son importance : Playwright compare le `textContent`, pas le
 * texte rendu. Une étiquette mise en capitales par CSS (`À RENDRE`) se cherche
 * donc telle qu'elle est écrite dans le code — « À rendre ».
 */
export function bloc(portee, etiquette) {
  return portee.getByText(etiquette, { exact: true }).first().locator('xpath=..');
}

/**
 * Attend qu'une étiquette porte EXACTEMENT ce montant.
 *
 * C'est l'assertion centrale de tout ce dossier : elle ne vérifie pas
 * « l'absence d'erreur », elle vérifie LE CHIFFRE. Un supplément oublié dans le
 * calcul, une variante mal résolue, une remise appliquée deux fois : le montant
 * change, l'attente ne se dénoue jamais, le test tombe en nommant l'écart.
 */
export async function attendreMontant(portee, etiquette, montant) {
  const cible = bloc(portee, etiquette).getByText(montant, { exact: true }).first();
  try {
    await cible.waitFor({ state: 'visible' });
  } catch (erreur) {
    const vu = await bloc(portee, etiquette)
      .textContent()
      .catch(() => null);
    throw enrichir(
      erreur,
      `« ${etiquette} » n’a jamais affiché ${montant}. Bloc lu à la place : ${JSON.stringify(vu)}`,
    );
  }
}

/** Attend qu'un texte apparaisse quelque part dans la portée. */
export async function attendreTexte(portee, texte) {
  await portee
    .getByText(texte, { exact: false })
    .first()
    .waitFor({ state: 'visible' });
}

/**
 * Lit un entier affiché à côté d'une étiquette (numéro de retrait, compteur).
 *
 * On attend d'abord qu'un chiffre soit là — l'écran affiche un tiret ou un
 * squelette avant d'avoir la valeur — puis on lit. Sans cette attente, on
 * lirait le squelette et on comparerait `NaN`.
 */
export async function entierAffiche(portee, etiquette) {
  const cible = bloc(portee, etiquette);
  await cible.getByText(/^\d+$/).first().waitFor({ state: 'visible' });
  const brut = await cible.getByText(/^\d+$/).first().textContent();
  const valeur = Number.parseInt((brut ?? '').trim(), 10);
  if (!Number.isInteger(valeur)) {
    throw new Error(`« ${etiquette} » n’affiche pas un entier lisible (lu : ${JSON.stringify(brut)}).`);
  }
  return valeur;
}

/**
 * Clique jusqu'à ce que le geste PRODUISE son effet.
 *
 * La seule entorse au principe « on n'attend que des états », et elle a une
 * raison précise : les pages Next.js du site public sont rendues côté serveur
 * puis hydratées. Entre les deux, le bouton EXISTE, il est visible, il est
 * cliquable au sens de Playwright — mais son gestionnaire n'est pas encore
 * posé. Le clic part dans le vide, et rien dans l'écran ne permet de distinguer
 * cet instant du suivant : il n'y a pas d'état à attendre.
 *
 * On réessaie donc le clic tant que son EFFET ne s'est pas produit. C'est une
 * attente d'état déguisée : la condition d'arrêt reste « l'écran a changé »,
 * jamais « le temps a passé ».
 *
 * ⚠️ À N'UTILISER QUE POUR OUVRIR quelque chose. Sur une bascule, un second
 * clic annulerait le premier.
 */
export async function cliquerJusqua(cible, apparait, { delai = 25_000, palier = 1_500 } = {}) {
  const fin = Date.now() + delai;
  for (;;) {
    await cible.click();
    try {
      await apparait.waitFor({ state: 'visible', timeout: palier });
      return;
    } catch (erreur) {
      if (Date.now() >= fin) throw erreur;
    }
  }
}

/**
 * Recharge une page jusqu'à ce qu'elle dise ce qu'on attend — ou abandonne.
 *
 * Réservé à UNE situation : la propagation d'une écriture serveur jusqu'à la
 * vitrine publique, que Next.js sert avec un cache de 60 s. Aucun état du
 * navigateur ne peut annoncer la fin de ce cache ; seule une nouvelle requête
 * le découvre. On sonde donc, et on dit combien de temps ça a pris — cette
 * durée est une mesure du produit, pas du test.
 */
export async function rechargerJusqua(page, url, present, { delai, pas = 4_000 } = {}) {
  const depart = Date.now();
  for (;;) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await present(page)) return Date.now() - depart;
    if (Date.now() - depart > delai) {
      throw new Error(
        `${url} n’a jamais affiché l’état attendu en ${Math.round(delai / 1000)} s ` +
          `(cache de la vitrine : 60 s — voir SITE_TTL dans components/order/api.ts).`,
      );
    }
    await page.waitForTimeout(pas); // sonde d'un cache serveur : la seule durée légitime du dossier
  }
}

/** Le document déborde-t-il horizontalement ? Sur un téléphone, c'est un défaut. */
export async function deborde(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}
