import { z } from 'zod';
import type { Brand, RepliMarque } from './marque';
import type { CapaciteEffective } from './capacites';

// ─────────────────────────────────────────────────────────────
// Administration client — le socle du back-office interne « /sm ».
//
// Cette surface est TRANS-TENANT (elle agit sur n'importe quel restaurant du
// parc) et donc réservée au rôle `sm_admin`. Elle porte trois choses :
//
//  1. le STATUT DE COMPTE d'un établissement (essai, actif, suspendu, parti) ;
//  2. la RÉVOCATION d'un appareil de terrain (tablette perdue ou volée) ;
//  3. le JOURNAL d'administration, append-only, qui trace chaque geste.
//
// RESPECT DES CLIENTS DE NOS CLIENTS — aucun type de ce fichier ne porte le
// nom, le téléphone ou l'e-mail d'un consommateur final. Le fichier client
// d'un restaurateur lui appartient : le détenir nous rendrait responsables de
// sa protection sans qu'aucune décision d'administration ne l'exige. Ce qui
// remonte ici, ce sont des états de compte et des agrégats.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Statut de compte ───

/**
 * Le cycle de vie commercial d'un établissement.
 *
 *  - `trial`     : période d'essai, il travaille, on ne facture pas encore ;
 *  - `active`    : client payant ;
 *  - `suspended` : accès COUPÉ (impayé, litige) — les données restent ;
 *  - `churned`   : il est parti. On garde tout, on ne coupe rien de force.
 */
export const TENANT_ACCOUNT_STATUSES = ['trial', 'active', 'suspended', 'churned'] as const;
export const TenantAccountStatusSchema = z.enum(TENANT_ACCOUNT_STATUSES);
export type TenantAccountStatus = z.infer<typeof TenantAccountStatusSchema>;

export const TENANT_ACCOUNT_STATUS_LABELS: Record<TenantAccountStatus, string> = {
  trial: 'Essai',
  active: 'Actif',
  suspended: 'Suspendu',
  churned: 'Parti',
};

/**
 * Statut d'un établissement dont le champ n'a jamais été écrit.
 *
 * Il en existe : tous les tenants créés avant ce module. Le défaut doit donc
 * être le statut le plus PERMISSIF possible — un champ absent ne peut pas
 * fermer la porte d'un restaurant en plein service.
 */
export const DEFAULT_TENANT_ACCOUNT_STATUS: TenantAccountStatus = 'trial';

/**
 * Le seul statut qui coupe l'accès est `suspended`.
 *
 * `churned` n'en fait PAS partie, et c'est délibéré : un client qui nous quitte
 * n'est pas un client à qui l'on claque la porte au nez. Fermer l'accès est un
 * geste explicite, motivé, journalisé — pas un effet de bord du départ. La
 * suspension reste disponible si le dossier l'exige.
 */
export const isAccessBlocked = (status: TenantAccountStatus | null | undefined): boolean =>
  status === 'suspended';

/**
 * UN COMPTE FACTURABLE — actif, ou suspendu.
 *
 * Un compte en essai ne se facture pas, un compte parti non plus. Un compte
 * SUSPENDU, si : c'est justement parce qu'il doit de l'argent qu'il est
 * suspendu, et arrêter de facturer un impayé reviendrait à l'effacer.
 *
 * Vit ICI, à côté d'`isAccessBlocked`, et non dans le service de facturation
 * où elle est née : elle y était recopiée à l'identique par la surface du
 * gérant (`my-billing.service`), c'est-à-dire écrite deux fois pour le même
 * client. Le jour où l'une des deux bougerait, un restaurateur lirait
 * « prochain prélèvement : aucun » sur l'écran même où nous lui préparons une
 * facture.
 */
export const isBillable = (status: TenantAccountStatus | null | undefined): boolean =>
  status === 'active' || status === 'suspended';

// ─── Le terme de l'essai ───

/**
 * CE QUE LE CALCUL LIT DU COMPTE — deux champs, et rien de plus.
 *
 * Les valeurs sont `unknown` volontairement, comme `SouscriptionLue`
 * (`capacites.ts`) : cette lecture est nourrie par un document Mongo `.lean()`
 * qui ne matérialise pas les défauts de schéma et porte le parc historique. Un
 * champ absent, `null`, ou d'un type inattendu doit produire un résultat,
 * jamais une exception — c'est ce calcul qui décide si l'on facture.
 */
export type CompteLu = {
  /** Le statut STOCKÉ. Absent sur les tenants d'avant le champ `account`. */
  status?: unknown;
  /** Le terme de l'essai, posé à la conversion. `null` : rien à dériver. */
  trialEndsAt?: unknown;
};

/** Le statut tel qu'il DORT en base, valeur inconnue ramenée au défaut. */
const statutStocke = (compte: CompteLu | null | undefined): TenantAccountStatus =>
  TENANT_ACCOUNT_STATUSES.find((s) => s === compte?.status) ?? DEFAULT_TENANT_ACCOUNT_STATUS;

/** Une date lisible, ou `null` — une date invalide vaut une absence. */
function dateLue(valeur: unknown): Date | null {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  if (typeof valeur !== 'string' || valeur.trim() === '') return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * LE TERME D'UN ESSAI DÉJÀ PASSÉ, ou `null`.
 *
 * Rend la DATE et non un booléen : c'est elle qui devient le `since` du statut
 * actif — le compte est devenu payant au terme convenu, pas le jour où une
 * lecture s'en est aperçue. Sans cela, la fiche client verrait sa date « actif
 * depuis » sauter au moment où la passe mensuelle réconcilie la base, pour un
 * fait qui, lui, n'a pas bougé.
 *
 * Trois cas rendent `null`, et chacun est une décision :
 *  · le compte n'est pas en essai — un compte SUSPENDU ou PARTI dont l'essai
 *    est échu ne redevient pas actif : sa suspension a été décidée par un
 *    humain avec un motif, son départ acté de même, et une date qui passe
 *    n'annule ni l'une ni l'autre ;
 *  · le terme n'est pas en base (`null`) — c'est le cas de tout le parc
 *    d'avant `trialEndsAt`. Un essai sans terme écrit ne peut pas s'achever
 *    tout seul : on ne devine pas une échéance contractuelle ;
 *  · le terme n'est pas encore atteint.
 */
export function essaiEchuLe(
  compte: CompteLu | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (statutStocke(compte) !== 'trial') return null;
  const terme = dateLue(compte?.trialEndsAt);
  if (terme === null || terme.getTime() > now.getTime()) return null;
  return terme;
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LE STATUT EFFECTIF D'UN COMPTE — un essai dont le terme est passé vaut  ║
 * ║  `active`. C'est la seule lecture de statut qui fasse foi.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── LE DÉFAUT QUE CETTE FONCTION FERME ───
 *
 * `trialEndsAt` était écrit à la conversion, lu par un seul signal du CRM, et
 * par AUCUNE garde. Aucun planificateur ne closait l'essai — le dépôt n'en a
 * aucun, et n'en veut pas (cf. `BillingRunSchema`). Les seules écritures de
 * statut étaient suspendre, réactiver et acter un départ, toutes manuelles. Or
 * `isBillable` exclut `trial` : un restaurant signé que personne ne basculait à
 * la main gardait donc un accès complet, gratuit et PERMANENT.
 *
 * ─── L'ARBITRAGE : ON FACTURE, ON NE FERME RIEN ───
 *
 * Au terme, le compte devient FACTURABLE, et rien ne se ferme. Le contrat est
 * signé à la conversion : la formule, l'engagement et la remise y sont déjà
 * figés (`ConversionService`), l'essai est un premier mois offert et non une
 * évaluation. Couper l'accès d'un restaurant en plein service parce qu'une date
 * est passée serait une faute ; le facturer est ce que les deux parties ont
 * convenu. C'est aussi pourquoi cette dérivation ne peut RIEN casser :
 * `isAccessBlocked` répond faux à `trial` comme à `active`.
 *
 * ─── LA FORME : DÉRIVER, PAS STOCKER ───
 *
 * Même idiome que `marqueEffective` (un adaptateur de lecture unique qui dérive
 * au lieu de stocker) et que `remiseFondateurDue` (qui rend zéro hors période,
 * donc s'éteint d'elle-même sans que personne ne l'éteigne). La vérité est
 * immédiate partout, sans écriture sur un chemin de lecture, et sans automate à
 * surveiller. La valeur STOCKÉE, elle, se réconcilie au seul endroit qui
 * parcourt déjà tout le parc et où cela compte : la passe mensuelle de
 * facturation (`BillingService.runMensuel`).
 */
export function statutEffectif(
  compte: CompteLu | null | undefined,
  now: Date = new Date(),
): TenantAccountStatus {
  return essaiEchuLe(compte, now) !== null ? 'active' : statutStocke(compte);
}

/**
 * Le motif inscrit sur le compte ET au journal quand l'essai s'achève.
 *
 * Écrit ici parce que la phrase appartient à la RÈGLE, pas à la passe de
 * facturation qui se trouve l'appliquer : elle dit ce qui s'est produit (un
 * terme atteint) et ce que ça change (le compte entre en facturation), sans
 * jamais laisser croire à une sanction. La date, elle, est déjà portée par le
 * `since` du compte — la répéter dans la phrase donnerait deux vérités à
 * maintenir.
 */
export const TRIAL_ENDED_REASON =
  'Fin de la période d’essai — le compte devient facturable, l’accès reste ouvert.';

/**
 * CE QU'UNE SUSPENSION FERME, ET CE QU'ELLE LAISSE OUVERT.
 *
 * La règle tient en une phrase : **on ferme ce qui encaisse, on laisse ouvert
 * ce qui affiche.** Elle est écrite ici parce qu'elle se décide une fois et
 * s'applique à six endroits ; sans elle, chaque surface tranche à sa manière.
 *
 * FERMÉ — les surfaces qui prennent de l'argent ou pilotent le service :
 *  · le back-office du gérant (guard global, à chaque requête) ;
 *  · l'ouverture de service au PIN, sur tablette appairée COMME par slug —
 *    une caisse s'authentifie par son jeton d'appareil, hors du guard, et
 *    l'oublier laisserait tout le parc déjà installé encaisser librement ;
 *  · la prise de commande en ligne.
 *
 * OUVERT — les surfaces que voit le CLIENT FINAL du restaurant :
 *  · la carte, les horaires et les avis du site public ;
 *  · l'écran de menu accroché en salle.
 *
 * Le consommateur n'est pour rien dans un impayé. Éteindre la télé du mur
 * au-dessus d'une file d'attente n'accélère aucun règlement : ça humilie le
 * restaurateur devant ses clients et ça donne de NOUS l'image d'un logiciel
 * qui tombe en panne. La pression s'exerce là où le gérant travaille, pas
 * dans sa salle.
 *
 * Cas particulier de l'écran de salle, à ne pas « corriger » sans y penser :
 * la clé HDMI interprète tout 401/403 comme un dépairage et bascule sur son
 * écran de saisie de code. Lui refuser son contenu afficherait donc un
 * formulaire d'appairage en grand format devant les convives — et le code que
 * le gérant y saisirait ne marcherait pas davantage.
 */

/** Message rendu au gérant dont le compte est suspendu — jamais une erreur technique. */
export const ACCOUNT_SUSPENDED_MESSAGE = 'Accès suspendu — contactez Snack Manager';

/**
 * Code machine accompagnant le 403.
 *
 * Le web s'en sert pour afficher l'écran « compte suspendu » plutôt que de
 * renvoyer le gérant vers l'écran de connexion : ses identifiants sont bons,
 * c'est son abonnement qui ne l'est pas. Comparer le libellé français serait
 * un couplage à une chaîne qu'on voudra retoucher.
 */
export const ACCOUNT_SUSPENDED_CODE = 'tenant_suspended';

/**
 * Message affiché au CONSOMMATEUR sur le site de commande d'un restaurant
 * suspendu.
 *
 * Le client final n'a rien à voir avec le litige commercial qui nous oppose au
 * restaurateur : il ne doit lire ni « suspendu », ni « impayé », ni une erreur
 * technique. Il lit qu'on ne prend pas de commande en ligne à cet instant, et
 * on lui laisse le téléphone du restaurant — la porte reste ouverte.
 */
export const PUBLIC_ORDERING_SUSPENDED_MESSAGE =
  'La commande en ligne est momentanément indisponible. Merci d’appeler directement le restaurant.';

/**
 * Message affiché au CONSOMMATEUR quand le restaurant n'a pas SOUSCRIT la
 * commande en ligne.
 *
 * Voisin du précédent, et pourtant distinct mot pour mot : « momentanément
 * indisponible » promet un retour, ce qui est vrai d'une suspension (elle se
 * lève quand la facture est réglée) et faux d'une fonction jamais achetée. Le
 * client reviendrait chaque semaine sur une page qui ne changera pas.
 *
 * Il n'y a ici NI reproche NI mention d'abonnement : le mangeur n'a pas à
 * savoir ce que son restaurateur nous paie. Il lit que ce restaurant ne prend
 * pas les commandes en ligne, et on lui laisse le téléphone.
 */
export const PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE =
  'Ce restaurant ne prend pas les commandes en ligne. Merci de l’appeler directement.';

/** L'état de compte tel qu'il circule dans les réponses d'API (dates ISO). */
export type TenantAccount = {
  /**
   * Le statut EFFECTIF (`statutEffectif`), jamais la colonne brute : un essai
   * dont le terme est passé sort d'ici en « Actif », que la base ait été
   * réconciliée ou non. Les deux écrans de l'équipe et celui du gérant lisent
   * donc la même chose le même jour.
   */
  status: TenantAccountStatus;
  /**
   * Début du statut COURANT — remis à jour à chaque changement.
   *
   * Sur un essai échu que la base n'a pas encore rattrapé, c'est le TERME de
   * l'essai et non la date de signature : le compte est devenu payant au jour
   * convenu, pas au jour où on l'a regardé. C'est aussi exactement ce que la
   * réconciliation écrira, si bien que la date ne bouge pas quand elle passe.
   */
  since: string;
  /** Motif du dernier changement de statut, saisi par l'équipe SM. */
  reason: string;
  /** Horodatage de la suspension en cours (`null` dès la réactivation). */
  suspendedAt: string | null;
};

/**
 * Fermeture propre du site public de commande.
 *
 * Un établissement suspendu ne doit pas voir sa page tomber en erreur : elle
 * se ferme comme une pause de service ordinaire — même forme de réponse, même
 * bandeau, autre message. Le menu, les horaires et les avis restent affichés :
 * on suspend un ACCÈS, on n'efface pas un restaurant d'Internet.
 *
 * Fonction pure et partagée pour que la règle ne soit écrite qu'une fois :
 * l'API la pose sur la page publique, le web peut la rejouer pour son rendu.
 *
 * ─── LA CAPACITÉ SUIT LE MÊME CHEMIN QUE LA SUSPENSION ───
 *
 * Une commande en ligne NON SOUSCRITE ne lève pas d'exception et ne rend pas
 * un 403 : elle se ferme comme une pause, par la même porte. La raison est la
 * même que pour la suspension, et elle est plus forte encore — la souscription
 * peut cesser un mardi midi, et la page ne doit pas tomber en plein service
 * devant des clients qui n'y sont pour rien. Le menu, les horaires et les avis
 * restent affichés : on ferme un guichet, on n'efface pas un restaurant.
 *
 * `souscrite` est un paramètre OBLIGATOIRE, et c'était le choix à faire : une
 * valeur par défaut à `true` aurait laissé chaque nouvel appelant ouvrir la
 * porte en oubliant de poser la question. Ici le compilateur la pose pour lui.
 *
 * L'ordre compte. La non-souscription passe AVANT la suspension et avant la
 * pause du gérant : elle est le fait le plus durable, elle ne doit pas
 * emprunter le « momentanément » de la suspension, et surtout elle ne doit pas
 * laisser sortir le message de pause du restaurateur — « de retour à 18 h » ne
 * doit pas s'afficher sur une fonction qui ne reviendra pas.
 */
export function publicOrderingState(
  account: { status?: TenantAccountStatus | null } | null | undefined,
  settings: { paused: boolean; message: string | null },
  souscrite: boolean,
): { paused: boolean; message: string | null } {
  if (!souscrite) {
    return { paused: true, message: PUBLIC_ORDERING_UNSUBSCRIBED_MESSAGE };
  }
  if (isAccessBlocked(account?.status)) {
    return { paused: true, message: PUBLIC_ORDERING_SUSPENDED_MESSAGE };
  }
  return settings.paused
    ? { paused: true, message: settings.message }
    : { paused: false, message: null };
}

// ─── Formules ───

/**
 * Les trois formules, redéclarées ici plutôt qu'importées de `./index`.
 *
 * `index.ts` fait `export * from './admin'` : importer `PlanSchema` depuis
 * l'index créerait un cycle de modules. `crm.ts` a fait le même choix pour la
 * même raison. Les valeurs sont vérifiées par un test de cohérence.
 */
export const ADMIN_PLANS = ['essentiel', 'complet', 'boost'] as const;
export type AdminPlan = (typeof ADMIN_PLANS)[number];

// ─── Révocation d'appareil ───

/**
 * Pourquoi on coupe une tablette. Quatre motifs, pas de texte libre : le
 * journal doit rester comptable (« combien de vols ce trimestre ? »), et un
 * champ libre finit toujours par contenir « rien » ou « cf. mail ».
 */
export const DEVICE_REVOKE_REASONS = ['perte', 'vol', 'panne', 'remplacement'] as const;
export const DeviceRevokeReasonSchema = z.enum(DEVICE_REVOKE_REASONS);
export type DeviceRevokeReason = z.infer<typeof DeviceRevokeReasonSchema>;

export const DEVICE_REVOKE_REASON_LABELS: Record<DeviceRevokeReason, string> = {
  perte: 'Perte',
  vol: 'Vol',
  panne: 'Panne',
  remplacement: 'Remplacement',
};

/** Nature de l'appareil révoqué — tablette de terrain ou téléviseur de salle. */
export const REVOCABLE_DEVICE_KINDS = ['pos', 'kds', 'screen'] as const;
export type RevocableDeviceKind = (typeof REVOCABLE_DEVICE_KINDS)[number];

export const REVOCABLE_DEVICE_KIND_LABELS: Record<RevocableDeviceKind, string> = {
  pos: 'Caisse',
  kds: 'Écran cuisine',
  screen: 'Écran de salle',
};

// ─── Journal d'administration ───

/**
 * Les gestes tracés. Nous agissons sur l'OUTIL DE TRAVAIL d'un commerçant :
 * chaque action, y compris la simple consultation d'une fiche détaillée, doit
 * pouvoir être reconstituée six mois plus tard.
 */
export const ADMIN_LOG_ACTIONS = [
  'tenant.create',
  'tenant.suspend',
  'tenant.reactivate',
  // Le DÉPART d'un client — il nous quitte, on garde tout, on ne coupe rien.
  'tenant.churn',
  'tenant.plan_change',
  // L'essai qui s'achève de lui-même : la réconciliation de `statutEffectif`
  // par la passe mensuelle. Sous son PROPRE nom, et non `tenant.reactivate` —
  // personne n'a réactivé quoi que ce soit, un terme est arrivé.
  'tenant.trial_end',
  // Une capacité ouverte ou fermée HORS formule — le geste commercial tracé.
  // Distinct de `tenant.plan_change`, qui ne parle que de ce qui est vendu :
  // une dérogation est précisément ce qui s'écarte de la grille.
  'tenant.capacite_change',
  'tenant.note',
  'tenant.detail_view',
  'tenant.owner_reset',
  // Le masque d'identité posé depuis la fiche client — même geste que la route
  // du restaurateur, tracé sous son propre nom plutôt que noyé dans
  // `tenant.plan_change`, qui ne parle que de formule.
  'tenant.brand_change',
  'device.revoke',
  'screen.revoke',
  'invoice.issue',
  'invoice.send',
  'invoice.remind',
  'invoice.pay',
  'invoice.cancel',
  'invoice.credit',
  // Réglage de PLATEFORME : il ne vise aucun établissement. Voir
  // `PLATFORM_LOG_ACTIONS` ci-dessous pour ce que ce préfixe implique.
  'platform.social_change',
] as const;
export const AdminLogActionSchema = z.enum(ADMIN_LOG_ACTIONS);
export type AdminLogAction = z.infer<typeof AdminLogActionSchema>;

export const ADMIN_LOG_ACTION_LABELS: Record<AdminLogAction, string> = {
  'tenant.create': 'Création du restaurant',
  'tenant.suspend': 'Suspension du compte',
  'tenant.reactivate': 'Réactivation du compte',
  'tenant.churn': 'Départ du client',
  'tenant.plan_change': 'Changement de formule',
  'tenant.trial_end': 'Fin de la période d’essai',
  'tenant.capacite_change': 'Dérogation de capacité',
  'tenant.note': 'Note interne',
  'tenant.detail_view': 'Consultation de la fiche',
  'tenant.owner_reset': 'Réinitialisation du mot de passe gérant',
  'tenant.brand_change': 'Masque d’identité modifié',
  // Apostrophe TYPOGRAPHIQUE (’) et non droite : ces libellés s'affichent tels
  // quels dans la fiche d'un client, à côté de phrases qui l'emploient déjà.
  'device.revoke': 'Révocation d’un appareil',
  'screen.revoke': 'Révocation d’un écran',
  'invoice.issue': 'Émission d’une facture',
  'invoice.send': 'Envoi d’un brouillon de facture',
  'invoice.remind': 'Relance d’une facture',
  'invoice.pay': 'Encaissement d’une facture',
  'invoice.cancel': 'Annulation d’une facture',
  'invoice.credit': 'Émission d’un avoir',
  // Ce qui change ici part sur NOTRE page d'accueil, sans relecture : le
  // libellé nomme donc la conséquence (la vitrine), pas le formulaire.
  'platform.social_change': 'Réseaux sociaux de la vitrine',
};

/**
 * ═══ DEUX FAMILLES D'ACTIONS DANS UN SEUL JOURNAL ═══
 *
 * Toutes les actions ci-dessus visaient jusqu'ici un ÉTABLISSEMENT : suspendre
 * un compte, couper une tablette, encaisser une facture. `platform.*` est
 * d'une autre nature — elle porte sur Snack Manager elle-même (les liens
 * affichés sur notre vitrine), et n'a donc aucun `tenantId` à porter.
 *
 * POURQUOI LE MÊME JOURNAL, ALORS. Parce que c'est le même registre qui
 * répond à la même question : « qui, dans l'équipe, a changé quoi, et quand ».
 * Un second journal parallèle obligerait à ouvrir deux écrans pour reconstituer
 * une matinée de travail, et le second — celui qu'on regarde une fois par
 * trimestre — serait le premier à cesser d'être alimenté.
 *
 * CE QUE LE PRÉFIXE COMMANDE, concrètement :
 *   · `adminLogs.tenantId` n'est exigé que pour les actions NON préfixées
 *     `platform.` (packages/db/src/schemas.ts) — une suspension sans
 *     établissement reste refusée à l'écriture ;
 *   · `GET /crm/tenants/:id/logs` filtre par tenant : une ligne de plateforme
 *     n'apparaît donc jamais dans le journal d'un client, ce qui est juste —
 *     elle ne le concerne pas. Elle se lit dans le journal du parc
 *     (`GET /crm/admin-logs`).
 */
export const PLATFORM_LOG_ACTION_PREFIX = 'platform.';

export const PLATFORM_LOG_ACTIONS = [
  'platform.social_change',
] as const satisfies readonly AdminLogAction[];
export type PlatformLogAction = (typeof PLATFORM_LOG_ACTIONS)[number];

/**
 * Cette action porte-t-elle sur la plateforme plutôt que sur un client ?
 *
 * Testé sur le PRÉFIXE et non sur l'appartenance à `PLATFORM_LOG_ACTIONS` :
 * la règle doit valoir pour l'action de plateforme qu'on ajoutera demain sans
 * penser à l'inscrire dans une seconde liste. Accepte `unknown` parce que le
 * modèle Mongoose l'appelle sur un champ non encore validé.
 */
export const isPlatformLogAction = (action: unknown): boolean =>
  typeof action === 'string' && action.startsWith(PLATFORM_LOG_ACTION_PREFIX);

/** Les actions qui visent un établissement — le journal d'un client. */
export const TENANT_LOG_ACTIONS = ADMIN_LOG_ACTIONS.filter(
  (action) => !isPlatformLogAction(action),
);

/**
 * LES GESTES DE FACTURATION, tracés sous leur vrai nom.
 *
 * Ils partagent le journal des suspensions et des révocations — c'est la même
 * histoire qui se raconte, et « relancé le 3, facture émise le 5, encaissée le
 * 12, suspendu le 20 » ne se lit que dans un fil unique. Mais ils ont désormais
 * leur PROPRE action : un encaissement de 139 € journalisé sous `tenant.note`
 * s'affiche « Note interne », c'est-à-dire comme un commentaire libre. Un
 * journal qui se trompe sur la NATURE du geste est exactement ce qu'on regarde
 * en cas de litige, et c'est le moment où il ne doit pas mentir.
 *
 * Trois conséquences concrètes, toutes acquises par ces valeurs :
 *  · le filtre `?action=` de `GET /crm/tenants/:id/logs` isole les gestes
 *    comptables des commentaires d'équipe ;
 *  · `targetId` porte l'identifiant de la PIÈCE, ce qu'une note ne portait pas ;
 *  · `meta` porte le numéro, le montant et le moyen de règlement, relisibles
 *    par une machine — la phrase française, elle, reste dans `reason`.
 *
 * La RELANCE (`invoice.remind`) en fait partie au même titre : elle ne change
 * pas le statut de la pièce, mais c'est bien un geste de facturation rattaché à
 * une facture précise — « relancé le 3 » doit se relire dans le même fil et sous
 * le même `targetId` que « encaissée le 12 ». Tout ce qui passe par
 * `recordInvoiceGesture` porte une action de cette liste.
 */
export const INVOICE_LOG_ACTIONS = [
  'invoice.issue',
  'invoice.send',
  'invoice.remind',
  'invoice.pay',
  'invoice.cancel',
  'invoice.credit',
] as const satisfies readonly AdminLogAction[];
export type InvoiceLogAction = (typeof INVOICE_LOG_ACTIONS)[number];

/**
 * Le CONTEXTE MACHINE d'une ligne de facturation.
 *
 * La phrase rédigée (`BILLING_JOURNAL`, @sm/contracts) reste dans `reason` : un
 * journal se lit d'abord avec des yeux. Ces champs-là existent pour tout ce que
 * la phrase ne permet pas — recompter une année d'encaissements, retrouver une
 * pièce par son numéro, vérifier un moyen de règlement sans analyser du texte.
 *
 * Les types restent PRIMITIFS à dessein : `billing.ts` importe `admin.ts`, donc
 * `admin.ts` ne peut pas importer `InvoiceKind` sans créer un cycle de modules.
 * La valeur écrite est celle de la facture, sans traduction.
 */
export type AdminInvoiceLogMeta = {
  /** Numéro de pièce — « SM-2026-0007 ». */
  number: string;
  /** Nature : `abonnement`, `mise_en_place`, `option`… */
  kind: string;
  /** Période facturée, clé « AAAA-MM ». */
  period: string;
  /** Montant en CENTIMES. */
  amountCents: number;
  /** Échéance (ISO) — émission. */
  dueAt?: string;
  /** Statut STOCKÉ à l'émission : `brouillon` ou `envoyee`. */
  storedStatus?: string;
  /** Moyen de règlement — encaissement. */
  method?: string;
  /** Date de règlement (ISO) — encaissement. */
  paidAt?: string;
  /** Motif — annulation. */
  cancelReason?: string;
  /** Canal de relance (`appel`, `sms`…) — relance. */
  channel?: string;
  /**
   * Numéro de la facture d'ORIGINE — avoir. C'est ce champ qui lie l'avoir à la
   * pièce qu'il corrige : la ligne de journal doit permettre de remonter du
   * « SM-2026-0009 » négatif au « SM-2026-0004 » réglé qu'il rembourse.
   */
  originNumber?: string;
};

/**
 * Ce que la facturation demande au journal d'écrire.
 *
 * `summary` est la phrase déjà rédigée par `BILLING_JOURNAL` : le journal ne
 * réécrit pas les mots de la facturation, il les enregistre.
 */
export type AdminInvoiceGesture = {
  action: InvoiceLogAction;
  /** Identifiant de la facture concernée — devient le `targetId` de la ligne. */
  invoiceId: string;
  /** La phrase française, telle qu'elle se lira dans le journal. */
  summary: string;
  meta: AdminInvoiceLogMeta;
};

/**
 * Une ligne du journal.
 *
 * `actor.email` est DÉNORMALISÉ à l'écriture : un journal qui se relit à
 * travers une jointure change de contenu quand un compte d'équipe est renommé
 * ou supprimé. Ce qui est écrit reste écrit.
 */
export type AdminLogEntry = {
  _id: string;
  at: string;
  actor: { id: string; email: string };
  action: AdminLogAction;
  actionLabel: string;
  /**
   * L'établissement visé — `null` pour une action de PLATEFORME
   * (`platform.*`), qui n'en vise aucun. Le distinguer d'une chaîne vide n'est
   * pas de la coquetterie : `''` se lit « identifiant manquant », `null` se lit
   * « cette action ne concerne pas un client », et seule la seconde est vraie.
   */
  tenantId: string | null;
  /** Cible secondaire : identifiant d'appareil ou d'écran, sinon `null`. */
  targetId: string | null;
  reason: string;
  /** Contexte de l'action (ancienne et nouvelle formule, motif de révocation…). */
  meta: Record<string, unknown> | null;
};

// ─── Entrées d'API (validées par zod) ───

/**
 * Suspendre exige un motif. C'est la seule action qui ferme la porte d'un
 * commerçant : « pourquoi ? » doit se lire dans le journal, pas se retrouver
 * dans une conversation Slack.
 */
export const TenantSuspendSchema = z.object({
  reason: z.string().trim().min(3, 'Indiquez le motif de la suspension').max(500),
});
export type TenantSuspend = z.infer<typeof TenantSuspendSchema>;

/** Réactiver est un geste de réparation : le motif aide, il n'est pas exigé. */
export const TenantReactivateSchema = z.object({
  reason: z.string().trim().max(500).default(''),
});
export type TenantReactivate = z.infer<typeof TenantReactivateSchema>;

/**
 * Acter le DÉPART d'un client exige un motif, comme la suspension : « pourquoi
 * nous a-t-il quittés ? » est la question qu'on se posera à chaque bilan, et la
 * réponse doit se lire dans le journal — pas se reconstituer de mémoire. Le
 * départ ne coupe pas l'accès (cf. `isAccessBlocked`) : ce n'est pas une
 * sanction, c'est un constat.
 */
/**
 * POURQUOI UN CLIENT PART — la donnée la plus précieuse d'un SaaS naissant.
 *
 * Le motif était un texte libre, et un texte libre ne s'agrège pas : six
 * départs donnent six phrases différentes, et aucun tableau. Or c'est
 * exactement la question qu'un éditeur doit pouvoir se poser au bout d'un an —
 * « est-ce le prix, la complexité, ou une fonction qui manque ? » — et elle ne
 * se répond qu'avec une cause structurée.
 *
 * La liste est COURTE et exclusive, parce qu'un menu de quinze causes se remplit
 * au hasard. Chacune appelle une réponse différente de l'éditeur : le prix se
 * négocie, la complexité se corrige, un concurrent s'analyse, une fermeture ne
 * se rattrape pas.
 *
 * Le détail libre reste : c'est lui qui porte le cas particulier, et c'est lui
 * qu'on relit avant d'appeler pour tenter de récupérer le client.
 */
export const CHURN_CAUSES = [
  'prix',
  'fermeture',
  'concurrent',
  'usage',
  'manque',
  'impaye',
  'autre',
] as const;
export type ChurnCause = (typeof CHURN_CAUSES)[number];

/**
 * Le libellé d'une cause — COURT, parce qu'il vit dans une puce.
 *
 * Une phrase entière y déborde, et sept phrases dans une modale étroite
 * produisent un pavé qu'on ne lit plus. Ce qui explique la cause vit dans
 * `CHURN_CAUSE_HINTS`, affiché sous le choix retenu — un seul à la fois, et
 * seulement quand il sert.
 */
export const CHURN_CAUSE_LABELS: Record<ChurnCause, string> = {
  prix: 'Trop cher',
  fermeture: 'Ferme ou vendu',
  concurrent: 'Concurrent',
  usage: 'Ne s’en servait pas',
  manque: 'Fonction manquante',
  impaye: 'Impayé',
  autre: 'Autre',
};

/** Ce que l'éditeur peut faire de chaque cause — affiché sous le choix. */
export const CHURN_CAUSE_HINTS: Record<ChurnCause, string> = {
  prix: 'Trop cher pour lui — à recouper avec sa formule et son volume de commandes.',
  fermeture: 'Le restaurant ferme ou change de mains : à sortir des pertes évitables.',
  concurrent: 'Parti ailleurs — notez lequel dans le détail, c’est ce qui se compare.',
  usage: 'Ne s’en servait pas, ou trop compliqué : le signal le plus actionnable.',
  manque: 'Une fonction essentielle manquait — notez laquelle, trois fois la même fait une feuille de route.',
  impaye: 'Perdu sur un impayé : vérifiez que la relance a bien été faite avant de conclure.',
  autre: 'Décrivez : si « autre » revient souvent, la liste est à revoir.',
};

export const TenantChurnSchema = z.object({
  /** La cause, pour l'agrégation. */
  cause: z.enum(CHURN_CAUSES),
  /** Le détail, pour le cas particulier — et pour la tentative de reprise. */
  reason: z.string().trim().min(3, 'Indiquez le motif du départ').max(500),
});
export type TenantChurn = z.infer<typeof TenantChurnSchema>;

export const TenantPlanChangeSchema = z.object({
  plan: z.enum(ADMIN_PLANS),
  reason: z.string().trim().max(500).default(''),
});
export type TenantPlanChange = z.infer<typeof TenantPlanChangeSchema>;

export const TenantNoteSchema = z.object({
  note: z.string().trim().min(1, 'Une note vide ne trace rien').max(2_000),
});
export type TenantNote = z.infer<typeof TenantNoteSchema>;

export const DeviceRevokeSchema = z.object({
  reason: DeviceRevokeReasonSchema,
  /** Précision libre — « oubliée dans le taxi », numéro de dossier assurance… */
  note: z.string().trim().max(500).default(''),
});
export type DeviceRevoke = z.infer<typeof DeviceRevokeSchema>;

export const AdminLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: AdminLogActionSchema.optional(),
});
export type AdminLogQuery = z.infer<typeof AdminLogQuerySchema>;

// ─── Sorties d'API ───

/** Fiche « compte » d'un établissement : ce qui décide de son accès. */
/**
 * L'Atelier signé d'un client — les services vendus avec l'abonnement, datés
 * de la signature. `null` : rien de vendu (les clients d'avant l'Atelier
 * comme ceux qui n'ont pris que le logiciel).
 */
export type AdminTenantAtelier = import('./crm').LeadServices & { signedAt: string };

export type AdminTenantAccount = {
  tenantId: string;
  name: string;
  slug: string;
  /** `null` = client Atelier seul — aucun abonnement logiciel. */
  plan: AdminPlan | null;
  /** Le module de commande en ligne — vendu à part de la formule, 79 €/mois. */
  onlineOrdering: boolean;
  /** L'engagement signé : au mois, ou à l'année avec deux mois offerts. */
  billingCycle: 'mensuel' | 'annuel';
  founderSeat: boolean;
  /** Fin de la remise fondateur, ou `null` — un booléen ne peut pas expirer. */
  founderUntil: string | null;
  /**
   * La remise MENSUELLE figée au contrat signé, ou `null`.
   *
   * Un montant et non un taux : c'est ce qui rend vraie la règle vendue — la
   * moitié sur ce qui a été signé, plein tarif sur ce qui s'ajoute après. Les
   * écrans qui chiffrent une offre en ont besoin pour ne pas annoncer le tarif
   * public à côté d'un montant remisé.
   */
  founderDiscountCents: number | null;
  /**
   * Le contact du GÉRANT — celui qu'on appelle, pas le numéro public du
   * restaurant. Recueilli à la prospection, il était perdu à la signature :
   * la fiche client affichait un bouton « Appeler » qui ne s'affichait jamais.
   */
  contact: { name: string; phone: string; email: string };
  account: TenantAccount;
  /** Résultat de la règle d'accès, calculé une fois côté API. */
  accessBlocked: boolean;
  statusLabel: string;
  atelier: AdminTenantAtelier | null;
  /**
   * Le masque d'identité effectif — dérivé (`lireMarque`), jamais un champ
   * stocké à part. Porté par la fiche client pour le futur éditeur CRM
   * (plan B) : la même vérité que la vitrine publique du restaurant.
   */
  brand: Brand;
  /**
   * POURQUOI CE MASQUE N'EST PAS CELUI DE LA BASE.
   *
   * `null` : c'en est bien un. `absent` : l'établissement n'a pas encore été
   * repris (`backfill:brand`) — normal, et attendu tant que la reprise n'a pas
   * tourné. `invalide` : la base porte un masque que le contrat REFUSE, et le
   * restaurant s'affiche donc en Nuit sur toutes ses surfaces clientes, sur un
   * 200.
   *
   * Ce dernier cas était INVISIBLE : le repli était muet, et la fiche client
   * montrait un Nuit indiscernable d'un Nuit choisi. Le drapeau existe pour
   * qu'un humain sache quels établissements sont concernés sans ouvrir les
   * journaux du serveur.
   */
  brandRepli: RepliMarque;
  /**
   * LES ONZE CAPACITÉS, avec ce qui les donne ou les refuse.
   *
   * Calculées côté API (`detailCapacites`), jamais rejouées par le front : la
   * règle d'or du catalogue veut que le conditionnement se lise à un seul
   * endroit, et un back-office qui refait le calcul en aurait sa propre copie.
   *
   * Portées par la fiche COMPTE et non par une route à part parce que c'est la
   * même question que `plan` et `onlineOrdering` juste au-dessus — « qu'a-t-il
   * acheté ? » — et que le panneau qui les affiche vit sur cet écran-là.
   */
  capacites: readonly CapaciteEffective[];
};

/**
 * Un appareil qui vient d'être révoqué.
 *
 * Le nouveau code d'appairage est renvoyé À DESSEIN : l'équipe SM est au
 * téléphone avec le restaurateur au moment où elle coupe la tablette volée, et
 * c'est ce code qu'elle lui dicte pour remettre la caisse de secours en
 * service dans la minute. Le JETON, lui, ne sort jamais — il est détruit.
 */
export type AdminRevokedDevice = {
  id: string;
  tenantId: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  /** Toujours `false` : l'appareil repart en attente d'appairage. */
  paired: boolean;
  revokedAt: string;
  revokedReason: DeviceRevokeReason;
  revokedReasonLabel: string;
  pairing: { code: string; expiresAt: string };
};
