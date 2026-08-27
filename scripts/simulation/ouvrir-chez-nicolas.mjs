/**
 * Ouvrir « Chez Nicolas » — un établissement réaliste, par les routes du front
 *
 *     node scripts/simulation/ouvrir-chez-nicolas.mjs staging
 *
 * ── Pourquoi ce script existe ───────────────────────────────────────────────
 *
 * Le dépôt savait déjà fabriquer un restaurant : `packages/db/src/seed.ts`
 * écrit directement dans Mongo. C'est rapide, et ça ne prouve rien — aucune
 * validation Zod, aucun calcul serveur, aucune règle métier traversée. Une base
 * peut être pleine d'établissements qu'aucune route n'aurait jamais acceptés.
 *
 * Ici, tout passe par HTTP, dans l'ordre exact où un vrai client naît :
 * l'équipe Snack Manager crée un lead, lui attache une proposition, signe ; le
 * gérant reçoit ses accès et remplit sa maison. Chaque étape est celle qu'un
 * humain ferait, avec le même jeton et les mêmes droits.
 *
 * ── L'ordre n'est pas décoratif ─────────────────────────────────────────────
 *
 *  · `billing.email` DOIT être posé avant le raccordement Stripe : le compte
 *    Connect du restaurant est pré-rempli avec cette adresse, et un compte créé
 *    avant naît sans e-mail — le restaurateur ne reçoit alors aucune
 *    notification de Stripe, et rien ne le lui dit.
 *  · Les catégories AVANT les produits : `POST /products` relit `categoryId`
 *    et rend 404 sinon.
 *  · L'équipe AVANT les PIN : sans staff, `/auth/pin` répond « PIN invalide »
 *    et la caisse ne peut pas ouvrir.
 *
 * ── Ce qui ne se rattrape pas ───────────────────────────────────────────────
 *
 *  · Le mot de passe du gérant est GÉNÉRÉ par le serveur et rendu UNE SEULE
 *    FOIS, dans la réponse de conversion. Aucune route ne le relit. Ce script
 *    l'écrit donc immédiatement dans `.simulation/`, qui est hors git.
 *  · Il n'existe AUCUN `@Delete` dans tout le module CRM : un établissement
 *    créé par erreur ne peut être que suspendu ou marqué parti. Le slug et
 *    l'e-mail se choisissent du premier coup.
 *
 * Le script est IDEMPOTENT : relancé, il reprend là où il s'était arrêté
 * plutôt que de tout refaire — un second `convert` répondrait 409, un second
 * produit du même nom ferait un doublon.
 */
import {
  appel,
  cadence,
  dire,
  exigerSucces,
  jetonUtilisateur,
  lireEnv,
  ouvrirJournal,
  resoudreCible,
} from './socle.mjs';
import { CATEGORIES, EQUIPE, ETABLISSEMENT, HORAIRES, PRODUITS } from './carte-chez-nicolas.mjs';

const cible = resoudreCible(process.argv[2] ?? 'staging');
const env = lireEnv();
const journal = ouvrirJournal('chez-nicolas-ouverture');

/** Ce que le script a déjà fait, relu du journal : c'est ce qui le rend idempotent. */
const dejaFait = new Map(journal.lire().map((e) => [e.etape, e]));
const noter = (etape, donnees) => {
  journal.ecrire({ etape, ...donnees });
  dejaFait.set(etape, donnees);
};

async function etape(nom, action) {
  if (dejaFait.has(nom)) {
    dire.ignore(`${nom} — déjà fait`);
    return dejaFait.get(nom);
  }
  dire.etape(nom);
  const resultat = await action();
  noter(nom, resultat);
  dire.ok(`${nom} — ${resultat.resume ?? 'fait'}`);
  return resultat;
}

// ─── 1. L'équipe Snack Manager signe le client ───────────────────────────────

async function jetonAdmin() {
  const motDePasse = process.env.SM_ADMIN_PASSWORD ?? env.SM_ADMIN_PASSWORD;
  if (!motDePasse) {
    throw new Error(
      'Mot de passe sm_admin absent. Posez SM_ADMIN_PASSWORD dans l’environnement ' +
        'ou dans le .env racine — jamais en argument de ligne de commande, qui reste ' +
        'dans l’historique du terminal et dans la liste des processus.',
    );
  }
  return jetonUtilisateur(cible, 'admin@snackmanager.fr', motDePasse);
}

async function creerLead(admin) {
  const charge = exigerSucces(
    await appel(cible, 'POST', '/crm/leads', {
      jeton: admin,
      corps: {
        restaurantName: ETABLISSEMENT.name,
        contact: {
          name: ETABLISSEMENT.gerant.nom,
          phone: ETABLISSEMENT.gerant.telephone,
          email: ETABLISSEMENT.gerant.email,
        },
        stage: 'demo',
        sequence: 'A',
        notes: 'Rouen rive droite, 45 couverts le soir. Veut la caisse et la commande en ligne avant les fêtes.',
        founderSeatReserved: true,
      },
    }),
    'création du lead',
  );
  // Le nom du tenant est repris du LEAD, jamais du corps de conversion.
  return { leadId: charge._id, resume: `lead ${charge._id}` };
}

const PROPOSITION = {
  plan: 'complet',
  onlineOrdering: true,
  billing: 'mensuel',
  services: {
    siteVitrine: true,
    refonteSite: false,
    identiteVisuelle: true,
    integrationCommande: false,
    presenceInternet: true,
    reseauxSociaux: 'hebdo',
  },
};

async function attacherProposition(admin, leadId) {
  const charge = exigerSucces(
    await appel(cible, 'PATCH', `/crm/leads/${leadId}`, {
      jeton: admin,
      corps: { proposal: { ...PROPOSITION, note: 'Signe après validation de son associé.' } },
    }),
    'proposition',
  );
  return { resume: `proposée le ${charge.proposal?.at ?? '?'}` };
}

async function signer(admin, leadId) {
  const charge = exigerSucces(
    await appel(cible, 'POST', `/crm/leads/${leadId}/convert`, {
      jeton: admin,
      corps: {
        slug: ETABLISSEMENT.slug,
        ownerEmail: ETABLISSEMENT.gerant.email,
        ownerName: ETABLISSEMENT.gerant.nom,
        founderSeat: true,
        ...PROPOSITION,
      },
    }),
    'signature',
  );
  // Le mot de passe n'existera plus nulle part après cette ligne.
  return {
    tenantId: charge.tenantId,
    ownerEmail: charge.ownerEmail,
    motDePasse: charge.password,
    trialEndsAt: charge.trialEndsAt,
    resume: `tenant ${charge.tenantId} · essai jusqu’au ${String(charge.trialEndsAt).slice(0, 10)}`,
  };
}

// ─── 2. Le gérant remplit sa maison ──────────────────────────────────────────

async function configurer(owner) {
  await etape('identité', async () => {
    exigerSucces(
      await appel(cible, 'PATCH', '/tenants/me/identity', {
        jeton: owner,
        corps: {
          name: ETABLISSEMENT.name,
          brandColor: ETABLISSEMENT.couleur,
          address: ETABLISSEMENT.adresse,
          phones: ETABLISSEMENT.telephones,
        },
      }),
      'identité',
    );
    return { resume: ETABLISSEMENT.adresse };
  });

  await etape('horaires', async () => {
    // ⚠️ REMPLACEMENT INTÉGRAL : le tableau écrase les sept jours d'un coup.
    const charge = exigerSucces(
      await appel(cible, 'PATCH', '/tenants/me/hours', { jeton: owner, corps: { hours: HORAIRES } }),
      'horaires',
    );
    return { resume: `${charge.hours?.length ?? 0} jours` };
  });

  await etape('réglages', async () => {
    exigerSucces(
      await appel(cible, 'PATCH', '/tenants/me/settings', {
        jeton: owner,
        corps: {
          slotIntervalMin: 10,
          slotCapacity: 4,
          onlineOrderingPaused: false,
          pauseMessage: 'Victimes de notre succès — la commande en ligne rouvre très vite.',
        },
      }),
      'réglages',
    );
    return { resume: 'créneaux de 10 min, 4 commandes par créneau' };
  });

  // ⏱ AVANT le raccordement Stripe : le compte Connect est pré-rempli avec
  // cette adresse. Posée après, elle n'y sera jamais.
  await etape('facturation', async () => {
    const charge = exigerSucces(
      await appel(cible, 'PUT', '/billing/me/identity', { jeton: owner, corps: ETABLISSEMENT.facturation }),
      'identité de facturation',
    );
    return { resume: charge.email ?? ETABLISSEMENT.facturation.email };
  });
}

async function poserCarte(owner) {
  const ids = dejaFait.get('catégories')?.ids ?? {};
  await etape('catégories', async () => {
    const crees = { ...ids };
    for (const categorie of CATEGORIES) {
      if (crees[categorie.key]) continue;
      const charge = exigerSucces(
        await appel(cible, 'POST', '/categories', {
          jeton: owner,
          corps: { name: categorie.name, order: categorie.order, active: true },
        }),
        `catégorie ${categorie.name}`,
      );
      crees[categorie.key] = charge._id;
    }
    return { ids: crees, resume: `${Object.keys(crees).length} catégories` };
  });

  const categorieIds = dejaFait.get('catégories').ids;
  const dejaCrees = new Set(dejaFait.get('produits')?.noms ?? []);

  await etape('produits', async () => {
    const noms = [...dejaCrees];
    for (const produit of PRODUITS) {
      if (dejaCrees.has(produit.name)) continue;
      const { categorie, ...reste } = produit;
      exigerSucces(
        await appel(cible, 'POST', '/products', {
          jeton: owner,
          corps: { categoryId: categorieIds[categorie], ...reste },
        }),
        `produit ${produit.name}`,
      );
      noms.push(produit.name);
      await cadence(150);
    }
    return { noms, resume: `${noms.length} produits` };
  });
}

async function poserEquipe(owner) {
  await etape('équipe', async () => {
    const crees = [];
    for (const membre of EQUIPE) {
      const reponse = await appel(cible, 'POST', '/staff', {
        jeton: owner,
        corps: { name: membre.name, role: membre.role, pin: membre.pin },
      });
      if (reponse.statut === 409) {
        crees.push(`${membre.name} (existait)`);
        continue;
      }
      exigerSucces(reponse, `équipier ${membre.name}`);
      crees.push(membre.name);
    }
    return { crees, resume: crees.join(', ') };
  });
}

// ─── Le déroulé ──────────────────────────────────────────────────────────────

async function principal() {
  dire.titre(`Ouverture de « ${ETABLISSEMENT.name} » sur ${cible.nom} — ${cible.api}`);

  const admin = await jetonAdmin();
  dire.ok('jeton équipe Snack Manager obtenu');

  const { leadId } = await etape('lead', () => creerLead(admin));
  await etape('proposition', () => attacherProposition(admin, leadId));
  const signature = await etape('signature', () => signer(admin, leadId));

  dire.titre('Accès du gérant');
  dire.ok(`${signature.ownerEmail} — mot de passe conservé dans ${journal.chemin}`);
  dire.ignore('Ce mot de passe n’est rendu qu’une fois : aucune route ne le relit.');

  const owner = await jetonUtilisateur(cible, signature.ownerEmail, signature.motDePasse);
  dire.ok('jeton gérant obtenu');

  dire.titre('Configuration');
  await configurer(owner);
  await poserCarte(owner);
  await poserEquipe(owner);

  dire.titre('Contrôle par la vitrine publique');
  const carte = await appel(cible, 'GET', `/public/tenants/${ETABLISSEMENT.slug}/menu`);
  const categories = carte.charge?.categories ?? [];
  const produits = categories.reduce((n, c) => n + (c.products?.length ?? 0), 0);
  dire.ok(`${categories.length} catégories · ${produits} produits servis publiquement`);

  const creneaux = await appel(cible, 'GET', `/public/tenants/${ETABLISSEMENT.slug}/slots`);
  const libres = (creneaux.charge?.slots ?? []).filter((s) => !s.full);
  dire.ok(`${libres.length} créneaux de retrait libres aujourd’hui`);

  dire.titre('Reste à faire à la main, une seule fois');
  dire.ignore('Raccorder Stripe : POST /encaissement/me/raccordement puis remplir la page Stripe.');
  dire.ignore('C’est le seul point du parcours qui exige un navigateur — Stripe interdit');
  dire.ignore('de compléter un compte Standard par API, et c’est délibéré de leur part.');
}

principal().catch((erreur) => {
  dire.echec(String(erreur?.message ?? erreur));
  process.exitCode = 1;
});
