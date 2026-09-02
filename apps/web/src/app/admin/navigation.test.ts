import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HREF_ABONNEMENT,
  MOBILE_HREFS,
  NAV,
  NAV_GROUPES,
  barreMobile,
  groupesMobileRestants,
  groupesVisibles,
  navActive,
  type ContexteNav,
} from "./navigation";

/** Un propriétaire, compte en règle : il voit tout. */
const OWNER: ContexteNav = { role: "owner", suspendu: false };
/** La tablette du comptoir. */
const CAISSE: ContexteNav = { role: "caisse", suspendu: false };
/** La démonstration : aucun jeton, donc aucun rôle connu. */
const DEMO: ContexteNav = { role: null, suspendu: false };

const hrefs = (groupes: readonly { items: readonly { href: string }[] }[]) =>
  groupes.flatMap((g) => g.items.map((i) => i.href));

/**
 * Ces règles sont celles qu'un œil ne rattrape pas en revue : un écran livré
 * sans lien entrant, une icône réemployée, un nom qui diverge entre la barre et
 * le titre, une entrée proposée à qui recevra un refus. Toutes se sont
 * réellement produites sur cette barre.
 */
describe("navigation du back-office restaurateur", () => {
  it("range les dix-sept écrans en sept groupes", () => {
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
      expect(hrefs(groupesVisibles({ role: "cuisine", suspendu: false }))).not.toContain(href);
      expect(hrefs(groupesVisibles({ role: "gerant", suspendu: false }))).not.toContain(href);
    }
    // Le planning reste visible pour tous : l'écran retient les montants tout
    // seul, et c'est la seule page qui dit à un équipier quand il travaille.
    expect(hrefs(groupesVisibles(CAISSE))).toContain("/admin/planning");
  });

  it("montre la barre COMPLÈTE quand le rôle est inconnu", () => {
    // En démonstration le jeton est `null` par conception : masquer des
    // entrées montrerait un logiciel vide à qui vient le regarder.
    expect(hrefs(groupesVisibles(DEMO))).toEqual(NAV.map((n) => n.href));
  });

  it("ne laisse qu’« Abonnement » à un compte suspendu", () => {
    const suspendu = groupesVisibles({ role: "owner", suspendu: true });
    expect(hrefs(suspendu)).toEqual([HREF_ABONNEMENT]);
    // Le groupe survit seul, avec son intitulé : les six autres disparaissent
    // plutôt que d'afficher un titre sans entrée.
    expect(suspendu.map((g) => g.titre)).toEqual(["Réglages"]);
    // Et la barre basse n'a plus aucune case directe : les trois gestes
    // quotidiens sont fermés par la suspension.
    expect(barreMobile({ role: "owner", suspendu: true })).toHaveLength(0);
  });

  it("ne propose rien à une session de comptoir sur un compte suspendu", () => {
    // Exact, et c'est le but : l'abonnement lui est fermé aussi. Une entrée de
    // plus ne serait qu'un refus de plus.
    expect(groupesVisibles({ role: "caisse", suspendu: true })).toEqual([]);
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

  it("applique les mêmes règles au pouce qu’au bureau", () => {
    const visibles = new Set(hrefs(groupesVisibles(CAISSE)));
    const mobile = [
      ...barreMobile(CAISSE).map((n) => n.href),
      ...hrefs(groupesMobileRestants(CAISSE)),
    ];
    expect(new Set(mobile)).toEqual(visibles);
  });
});
