import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CAPACITES,
  CAPACITES_PAR_FORMULE,
  CAPACITES_SANS_GARDE,
  type Capacite,
} from "@sm/contracts";
import {
  HREF_ABONNEMENT,
  MOBILE_HREFS,
  NAV,
  NAV_GROUPES,
  barreMobile,
  groupesMobileRestants,
  groupesVisibles,
  navActive,
  accesPage,
  accueilAdmin,
  type ContexteNav,
} from "./navigation";

/** Tout souscrit — la formule la plus complète de la grille. */
const TOUT: readonly Capacite[] = CAPACITES;

/** Un propriétaire, compte en règle, tout souscrit : il voit tout. */
const OWNER: ContexteNav = { role: "owner", suspendu: false, capacites: TOUT };
/** La tablette du comptoir. */
const CAISSE: ContexteNav = { role: "caisse", suspendu: false, capacites: TOUT };
/** Le cogérant : tout l'opérationnel, ni l'abonnement ni l'encaissement. */
const COGERANT: ContexteNav = { role: "cogerant", suspendu: false, capacites: TOUT };
/** Le comptable : lecture seule sur l'argent, rien d'autre. */
const COMPTABLE: ContexteNav = { role: "comptable", suspendu: false, capacites: TOUT };
/** La démonstration : aucun jeton, donc ni rôle ni capacités connus. */
const DEMO: ContexteNav = { role: null, suspendu: false, capacites: null };

const hrefs = (groupes: readonly { items: readonly { href: string }[] }[]) =>
  groupes.flatMap((g) => g.items.map((i) => i.href));

/** Les entrées verrouillées — visibles, mais fermées faute d'abonnement. */
const verrous = (groupes: readonly { items: readonly { href: string; verrouille: boolean }[] }[]) =>
  groupes.flatMap((g) => g.items.filter((i) => i.verrouille).map((i) => i.href));

/**
 * Ces règles sont celles qu'un œil ne rattrape pas en revue : un écran livré
 * sans lien entrant, une icône réemployée, un nom qui diverge entre la barre et
 * le titre, une entrée proposée à qui recevra un refus. Toutes se sont
 * réellement produites sur cette barre.
 */
describe("navigation du back-office restaurateur", () => {
  it("accueille sur une fonction souscrite et autorisée", () => {
    expect(accueilAdmin(OWNER)).toBe('/admin/dashboard');
    expect(accueilAdmin({ ...OWNER, capacites: ['loyalty'] })).toBe('/admin/fidelite');
    expect(accueilAdmin({ ...OWNER, capacites: [] })).toBe('/admin/site');
    expect(accueilAdmin({ ...OWNER, capacites: ['online', 'menu', 'loyalty'] })).toBe('/admin/dashboard');
    expect(accueilAdmin(COMPTABLE)).toBe('/admin/stats');
    expect(accueilAdmin({ ...OWNER, suspendu: true })).toBe(HREF_ABONNEMENT);
    expect(accueilAdmin({ ...CAISSE, suspendu: true })).toBeNull();
  });
  it("protège une URL directe et distingue abonnement et rôle", () => {
    const web = { ...OWNER, capacites: ['online', 'menu', 'loyalty'] as Capacite[] };
    expect(accesPage('/admin/orders', web)).toBe('allowed');
    expect(accesPage('/admin/orders/abc', web)).toBe('allowed');
    expect(accesPage('/admin/planning', web)).toBe('locked');
    expect(accesPage('/admin/devices', web)).toBe('locked');
    expect(accesPage('/admin/encaissement', { ...web, role: 'caisse' })).toBe('forbidden');
  });
  it("range les dix-huit écrans en sept groupes", () => {
    expect(NAV_GROUPES.map((g) => g.titre)).toEqual([
      "Service",
      "Carte",
      "Clients",
      "Équipe",
      "Analyse",
      "Présence",
      "Réglages",
    ]);
    expect(NAV.map((n) => n.href)).toEqual([
      "/admin/dashboard",
      "/admin/orders",
      "/admin/livraison",
      "/admin/menu",
      "/admin/ingredients",
      "/admin/fidelite",
      "/admin/promos",
      "/admin/reviews",
      "/admin/team",
      "/admin/planning",
      "/admin/stats",
      "/admin/site",
      "/admin/screens",
      "/admin/encaissement",
      "/admin/settings",
      "/admin/hours",
      "/admin/devices",
      "/admin/abonnement",
    ]);
  });

  it.each([
    { capacites: ['loyalty'] as Capacite[], directs: ['/admin/fidelite', '/admin/promos', '/admin/site'] },
    { capacites: [] as Capacite[], directs: ['/admin/site', '/admin/settings', HREF_ABONNEMENT] },
  ])("met les fonctions de l'offre autonome sous le pouce sans perdre les autres", ({ capacites, directs }) => {
    const context = { ...OWNER, capacites };
    expect(barreMobile(context).map((item) => item.href)).toEqual(directs);
    expect(barreMobile(context).every((item) => !item.verrouille)).toBe(true);
    const routes = [...directs, ...hrefs(groupesMobileRestants(context))];
    expect(new Set(routes)).toEqual(new Set(NAV.map((item) => item.href)));
    expect(routes).toHaveLength(NAV.length);
  });

  /**
   * LE DÉFAUT D'ORIGINE, ET LE SEUL QUE LE CODE PEUT SURVEILLER SEUL : onze
   * écrans livrés n'avaient aucun lien entrant, et les paramètres n'étaient
   * dans aucune liste. Le dossier fait foi — un écran ajouté demain sans entrée
   * ici fait rougir cette ligne le jour même.
   */
  it("n’oublie aucun écran livré sous /admin", () => {
    const dossier = fileURLToPath(new URL(".", import.meta.url));
    const ecrans = readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dossier, e.name, "page.tsx")))
      .map((e) => `/admin/${e.name}`)
      // La connexion est hors coque : `layout.tsx` rend ses enfants nus, sans
      // barre ni en-tête. Une entrée « Connexion » dans la barre d'un gérant
      // déjà connecté n'aurait aucun sens.
      .filter((href) => href !== "/admin/login");

    expect(new Set(NAV.map((n) => n.href))).toEqual(new Set(ecrans));
  });

  it("n’emploie jamais deux fois la même icône", () => {
    // Trois collisions vivaient dans la barre : `home` (tableau de bord et site
    // web), `clock` (horaires et planning), `euro` (encaissement et
    // abonnement). Sur le rail replié à 66 px, l'icône est le SEUL repère.
    const icones = NAV.map((n) => n.icon);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it("garde le rouage pour les réglages, et pour eux seuls", () => {
    const rouage = NAV.filter((n) => n.icon === "gear");
    expect(rouage.map((n) => n.href)).toEqual(["/admin/settings"]);
  });

  it("désigne l’écran le plus précis, et ne titre jamais « Back-office »", () => {
    expect(navActive("/admin/dashboard").label).toBe("Aujourd’hui");
    expect(navActive("/admin/fidelite").label).toBe("Fidélité");
    expect(navActive("/admin/fidelite/clients").label).toBe("Fidélité");
    expect(navActive("/admin/orders/abc123").label).toBe("Commandes");
    // L'écran qui n'avait pas de nom en a un.
    expect(navActive("/admin/settings").label).toBe("Établissement");
    // Aucun chemin, même inconnu, ne rend une entrée vide : la barre de titre
    // n'a plus de raison d'inventer « Back-office ».
    expect(navActive("/admin/inconnue").label).toBe("Aujourd’hui");
    for (const item of NAV) expect(item.label.trim()).not.toBe("");
  });

  it("réserve au propriétaire ce que l’API réserve au propriétaire", () => {
    // `EncaissementController` porte `@Roles('owner')` sur sa classe, et
    // l'abonnement passe par un garde qui exige `kind: 'user'` + `owner`.
    const reserve = ["/admin/encaissement", HREF_ABONNEMENT];
    expect(hrefs(groupesVisibles(OWNER))).toEqual(NAV.map((n) => n.href));
    for (const href of reserve) {
      expect(hrefs(groupesVisibles(CAISSE))).not.toContain(href);
      expect(hrefs(groupesVisibles({ role: "cuisine", suspendu: false, capacites: TOUT }))).not.toContain(href);
      expect(hrefs(groupesVisibles({ role: "gerant", suspendu: false, capacites: TOUT }))).not.toContain(href);
    }
    // Le planning reste visible pour tous : l'écran retient les montants tout
    // seul, et c'est la seule page qui dit à un équipier quand il travaille.
    expect(hrefs(groupesVisibles(CAISSE))).toContain("/admin/planning");
  });

  /**
   * LE COGÉRANT VOIT LE SERVICE, PAS L'ARGENT.
   *
   * C'est la traduction, dans la barre, de la subsomption posée côté API : il
   * endosse `gerant`, donc tout ce que le gérant ouvre — et rien des deux
   * surfaces réservées au propriétaire.
   */
  it("ouvre au cogérant tout l’opérationnel, jamais l’abonnement ni l’encaissement", () => {
    const visibles = new Set(hrefs(groupesVisibles(COGERANT)));
    expect(visibles.has("/admin/encaissement")).toBe(false);
    expect(visibles.has(HREF_ABONNEMENT)).toBe(false);
    // Tout le reste, sans exception : carte, stocks, équipe, planning,
    // fidélité, promotions, avis, appareils, écrans, site.
    const attendu = NAV.map((n) => n.href).filter(
      (href) => href !== "/admin/encaissement" && href !== HREF_ABONNEMENT,
    );
    expect([...visibles].sort()).toEqual([...attendu].sort());
  });

  /**
   * LE COMPTABLE NE SE VOIT PROPOSER QUE CE QU'IL PEUT OUVRIR.
   *
   * Deux entrées, exactement les deux surfaces que l'API lui ouvre côté écran :
   * les statistiques (avec leurs exports CSV) et l'abonnement (ses factures).
   * Le défaut « visible » lui en aurait proposé quinze pour quinze refus — une
   * barre qui ment, pas une barre imprécise.
   */
  it("ne propose au comptable que les statistiques et l’abonnement", () => {
    expect(hrefs(groupesVisibles(COMPTABLE))).toEqual(["/admin/stats", HREF_ABONNEMENT]);
  });

  it("laisse au comptable ses factures même sur un compte suspendu", () => {
    // C'est justement le moment où il en a besoin : le numéro de pièce et le
    // montant à virer. `TenantSessionGuard` l'accepte côté API, la barre doit
    // dire la même chose.
    const suspendu = groupesVisibles({ role: "comptable", suspendu: true, capacites: TOUT });
    expect(hrefs(suspendu)).toEqual([HREF_ABONNEMENT]);
  });

  it("montre la barre COMPLÈTE quand le rôle est inconnu", () => {
    // En démonstration le jeton est `null` par conception : masquer des
    // entrées montrerait un logiciel vide à qui vient le regarder.
    expect(hrefs(groupesVisibles(DEMO))).toEqual(NAV.map((n) => n.href));
  });

  it("ne laisse qu’« Abonnement » à un compte suspendu", () => {
    const suspendu = groupesVisibles({ role: "owner", suspendu: true, capacites: TOUT });
    expect(hrefs(suspendu)).toEqual([HREF_ABONNEMENT]);
    // Le groupe survit seul, avec son intitulé : les six autres disparaissent
    // plutôt que d'afficher un titre sans entrée.
    expect(suspendu.map((g) => g.titre)).toEqual(["Réglages"]);
    // Et la barre basse n'a plus aucune case directe : les trois gestes
    // quotidiens sont fermés par la suspension.
    expect(barreMobile({ role: "owner", suspendu: true, capacites: TOUT })).toHaveLength(0);
  });

  it("ne propose rien à une session de comptoir sur un compte suspendu", () => {
    // Exact, et c'est le but : l'abonnement lui est fermé aussi. Une entrée de
    // plus ne serait qu'un refus de plus.
    expect(groupesVisibles({ role: "caisse", suspendu: true, capacites: TOUT })).toEqual([]);
  });

  it("garde quatre cellules sous le pouce et loge le reste dans les MÊMES groupes", () => {
    // Trois cases directes + « Plus » : la quatrième cellule est le bouton.
    expect(MOBILE_HREFS.length).toBeLessThanOrEqual(4);
    expect(barreMobile(OWNER).map((n) => n.label)).toEqual([
      "Aujourd’hui",
      "Commandes",
      "Carte",
    ]);
    // Les noms de la barre basse sont ceux de la table, tels quels : plus
    // aucun libellé court, donc plus aucun nom qui diverge. Ils tiennent dans
    // une cellule de ±97 px à 11 px de corps.
    for (const item of barreMobile(OWNER)) expect(item.label.length).toBeLessThanOrEqual(12);

    // « Plus » montre des GROUPES, pas une liste plate de seize.
    expect(groupesMobileRestants(OWNER).map((g) => g.titre)).toEqual([
      "Service",
      "Carte",
      "Clients",
      "Équipe",
      "Analyse",
      "Présence",
      "Réglages",
    ]);

    // Rien ne se perd et rien ne se double entre la barre et son volet.
    const sousLePouce = [
      ...barreMobile(OWNER).map((n) => n.href),
      ...hrefs(groupesMobileRestants(OWNER)),
    ];
    expect(new Set(sousLePouce)).toEqual(new Set(NAV.map((n) => n.href)));
    expect(sousLePouce).toHaveLength(NAV.length);
  });

  /**
   * ─── LE SECOND AXE : CE QUE L'ÉTABLISSEMENT A PAYÉ ───
   *
   * Il ne se comporte PAS comme le premier, et c'est la décision centrale de
   * cette table : un refus de droit MASQUE, un défaut de souscription
   * VERROUILLE. Masquer un module non souscrit reviendrait à cacher au client
   * ce qu'il vient de lire sur notre propre grille tarifaire.
   */
  it("verrouille sans masquer ce qui n’est pas souscrit", () => {
    // Une formule d'entrée : la grille lui vend « non inclus » le planning, les
    // stocks, la fidélité et la commande en ligne.
    const essentiel = groupesVisibles({
      role: "owner",
      suspendu: false,
      capacites: CAPACITES_PAR_FORMULE.essentiel,
    });
    // RIEN ne disparaît : la barre reste complète, au href près.
    expect(hrefs(essentiel)).toEqual(NAV.map((n) => n.href));
    expect(verrous(essentiel)).toEqual([
      "/admin/livraison",
      "/admin/ingredients",
      "/admin/fidelite",
      "/admin/promos",
      "/admin/planning",
      "/admin/encaissement",
    ]);
  });

  it("ouvre ce que la formule intermédiaire comprend, et ferme le reste", () => {
    const complet = groupesVisibles({
      role: "owner",
      suspendu: false,
      capacites: CAPACITES_PAR_FORMULE.complet,
    });
    // Le planning et les stocks s'ouvrent ; la fidélité et la commande en ligne
    // restent verrouillées — mot pour mot ce que la grille annonce.
    expect(verrous(complet)).toEqual([
      "/admin/livraison",
      "/admin/fidelite",
      "/admin/promos",
      "/admin/encaissement",
    ]);
  });

  it("ne verrouille rien quand tout est souscrit", () => {
    expect(verrous(groupesVisibles(OWNER))).toEqual([]);
  });

  it("ne verrouille rien tant qu’on ne sait pas", () => {
    // `null` : la démonstration, et l'instant qui précède la réponse de
    // `GET /tenants/me`. Un cadenas qui apparaît une seconde après le
    // chargement ferait clignoter la barre d'un client parfaitement en règle.
    expect(verrous(groupesVisibles(DEMO))).toEqual([]);
    expect(barreMobile(DEMO).every((n) => !n.verrouille)).toBe(true);
  });

  it("verrouille aussi sous le pouce, et dans le volet « Plus »", () => {
    // Les trois règles doivent dire la même chose : un écran verrouillé au
    // bureau ne doit pas s'ouvrir depuis le téléphone.
    const sansRien: ContexteNav = { role: "owner", suspendu: false, capacites: [] };
    const auBureau = new Set(verrous(groupesVisibles(sansRien)));
    const auPouce = [
      ...barreMobile(sansRien).filter((n) => n.verrouille).map((n) => n.href),
      ...verrous(groupesMobileRestants(sansRien)),
    ];
    expect(new Set(auPouce)).toEqual(auBureau);
  });

  it("n’adosse aucune entrée à une capacité qui ne garde rien", () => {
    // « Support prioritaire » est un niveau de service HUMAIN : aucun écran ne
    // peut l'ouvrir ou le fermer, et un cadenas dessus serait un contresens.
    const sansGarde = new Set<string>(CAPACITES_SANS_GARDE);
    for (const item of NAV) {
      if (item.capacite) expect(sansGarde.has(item.capacite)).toBe(false);
    }
  });

  it("n’adosse aucune entrée à une capacité inconnue du catalogue", () => {
    const connues = new Set<string>(CAPACITES);
    for (const item of NAV) {
      if (item.capacite) expect(connues.has(item.capacite)).toBe(true);
    }
  });

  it("laisse le socle ouvert à qui n’a souscrit aucune formule", () => {
    // Atelier seul : identité, présence web et factures restent disponibles.
    const socle = groupesVisibles({ role: "owner", suspendu: false, capacites: [] });
    const ouverts = socle.flatMap((g) => g.items.filter((i) => !i.verrouille).map((i) => i.href));
    expect(ouverts).toEqual([
      "/admin/site",
      "/admin/settings",
      HREF_ABONNEMENT,
    ]);
  });

  it("applique les mêmes règles au pouce qu’au bureau", () => {
    const visibles = new Set(hrefs(groupesVisibles(CAISSE)));
    const mobile = [
      ...barreMobile(CAISSE).map((n) => n.href),
      ...hrefs(groupesMobileRestants(CAISSE)),
    ];
    expect(new Set(mobile)).toEqual(visibles);
  });
});
